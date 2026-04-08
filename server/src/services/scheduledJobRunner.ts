import {
  createNotification,
  getDueScheduledJobs,
  getSettings,
  updateScheduledJob,
} from "../db/repository.js";
import { randomUUID } from "node:crypto";
import { generateAssistantReply } from "./chat-service.js";
import { computeNextRunAt } from "./scheduleParser.js";
import { getToolsForIntent } from "../skills/skillsConfig.js";
import { SCHEDULED_RUN_SYSTEM_PROMPT } from "../utils/constants.js";
import { notificationBus } from "./notification-bus.js";
import type { ScheduledJob } from "../types.js";

export class ScheduledJobRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = getDueScheduledJobs();
      for (const job of jobs) {
        await this.runJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    let generation: Awaited<ReturnType<typeof generateAssistantReply>> | null = null;
    try {
      const settings = getSettings();
      const tools = await getToolsForIntent("task");

      // Each run gets its own fresh conversation tagged as a scheduled run.
      // Title format: "YYYY-MM-DD — <job title>" — set as manual so the title service skips it.
      const runDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const runTitle = `${runDate} — ${job.title}`;

      generation = await generateAssistantReply({
        // No conversationId — creates a new conversation each time
        content: job.userPrompt,
        title: runTitle,
        profileId: job.profileId,
        model: job.model,
        systemPrompt: settings.defaultSystemPrompt,
        conversationType: "scheduled_run",
        tools,
        agentMode: "scheduled",
        agentSystemPrompt: SCHEDULED_RUN_SYSTEM_PROMPT,
      });

      notificationBus.publish({
        type: "schedule_started",
        jobId: job.id,
        jobTitle: job.title,
        conversationId: generation.conversation.id,
      });

      {
        const n = createNotification({
          id: randomUUID(),
          type: "schedule_started",
          title: `Schedule started: ${job.title}`,
          body: "Running now…",
          targetUrl: `/c/${generation.conversation.id}`,
        });
        notificationBus.publish({ type: "notification_created", notification: n });
      }

      let content = "";
      let reasoning = "";
      for await (const chunk of generation.stream) {
        if (chunk.content) content += chunk.content;
        if (chunk.reasoning) reasoning += chunk.reasoning;
        if (chunk.content || chunk.reasoning) {
          notificationBus.publish({
            type: "schedule_step",
            conversationId: generation.conversation.id,
            content: chunk.content,
            reasoning: chunk.reasoning,
          });
        }
      }
      generation.finalize(content, reasoning, [], []);

      const newRunCount = job.runCount + 1;
      const exhausted = job.maxRuns !== null && newRunCount >= job.maxRuns;
      updateScheduledJob(job.id, {
        runCount: newRunCount,
        lastRunAt: new Date().toISOString(),
        lastRunConversationId: generation.conversation.id,
        nextRunAt: computeNextRunAt(job.intervalMs),
        enabled: !exhausted,
      });

      notificationBus.publish({
        type: "schedule_completed",
        jobId: job.id,
        jobTitle: job.title,
        conversationId: generation.conversation.id,
        success: true,
      });

      {
        const n = createNotification({
          id: randomUUID(),
          type: "schedule_completed",
          title: `Schedule completed: ${job.title}`,
          body: "Run finished successfully.",
          targetUrl: `/c/${generation.conversation.id}`,
        });
        notificationBus.publish({ type: "notification_created", notification: n });
      }
    } catch (err) {
      console.error(
        `[ScheduledJobRunner] job ${job.id} failed:`,
        err instanceof Error ? err.message : err
      );
      generation?.fail();
      if (generation) {
        notificationBus.publish({
          type: "schedule_completed",
          jobId: job.id,
          jobTitle: job.title,
          conversationId: generation.conversation.id,
          success: false,
        });
        const n = createNotification({
          id: randomUUID(),
          type: "schedule_failed",
          title: `Schedule failed: ${job.title}`,
          body: "An error occurred during the run.",
          targetUrl: `/c/${generation.conversation.id}`,
        });
        notificationBus.publish({ type: "notification_created", notification: n });
      }
    }
  }
}
