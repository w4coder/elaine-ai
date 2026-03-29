/**
 * notify_user.skill.js
 *
 * Sends a notification to the user via direct social integrations
 * (Telegram, Slack, Discord, ...).
 *
 * Use this skill to proactively inform the user of task completion, important
 * findings, or any time you need to push information out-of-band without
 * pausing and waiting for a reply.
 *
 * Returns: { sent: true } on success.
 * Returns: { sent: false, reason: string } if no direct integration can deliver.
 */

function userMention(participant) {
  const userId = String(participant?.userId || "").trim();
  const platform = String(participant?.platform || "").trim();
  if (!userId) return "";
  if (platform === "slack") return `<@${userId}>`;
  if (platform === "discord") return `<@${userId}>`;
  return "";
}

function resolveTaskPreferredTarget(task) {
  const socialMeta =
    task?.meta?.social && typeof task.meta.social === "object" ? task.meta.social : null;
  if (socialMeta?.integrationId) {
    return {
      integrationId: String(socialMeta.integrationId || "").trim(),
      chatId: String(socialMeta.chatId || "").trim(),
      platform: String(socialMeta.platform || "").trim(),
      userId: String(socialMeta.userId || "").trim(),
      source: "task_social_meta",
    };
  }

  const notifyMeta =
    task?.meta?.notify && typeof task.meta.notify === "object" ? task.meta.notify : null;
  if (notifyMeta?.integrationId) {
    return {
      integrationId: String(notifyMeta.integrationId || "").trim(),
      chatId: String(notifyMeta.chatId || "").trim(),
      platform: String(notifyMeta.platform || "").trim(),
      userId: String(notifyMeta.userId || "").trim(),
      source: "task_notify_meta",
    };
  }

  return null;
}

export default {
  name: "notify_user",

  description:
    "Send a notification to the user via configured direct social integrations " +
    "(Telegram, Slack, Discord, …). " +
    "Use for task completion alerts, important findings, or any time the user " +
    "should be informed but you do not need a response. " +
    "Returns { sent: true } on success, { sent: false, reason } when no channel is available.",

  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The notification body text to deliver to the user.",
      },
      title: {
        type: "string",
        description: "Optional short title or subject line (max 100 chars).",
      },
      urgency: {
        type: "string",
        enum: ["low", "normal", "high"],
        description: "Urgency hint for social dispatch (default: normal).",
      },
    },
    required: ["message"],
  },

  async execute(input = {}, { task, integrationEngine, taskSocialThreads } = {}) {
    const message = String(input.message || "").trim();
    if (!message) {
      return { sent: false, reason: "message must not be empty." };
    }

    const title = typeof input.title === "string" ? input.title.trim().slice(0, 100) : "";
    const urgency = input.urgency || "normal";
    const fullText = [title ? `${title}` : "", message, urgency === "high" ? "(high urgency)" : ""]
      .filter(Boolean)
      .join("\n");

    const participants = task?.id ? taskSocialThreads?.get(task.id) : null;
    if (participants && participants.size > 0 && integrationEngine) {
      let sentCount = 0;
      const taggedText = task?.id ? `${fullText}\n\nTask ID: ${task.id}` : fullText;

      for (const participant of participants.values()) {
        try {
          const mention = userMention(participant);
          const targetedText = mention ? `${mention} ${taggedText}` : taggedText;
          await integrationEngine.sendMessage(
            participant.integrationId,
            participant.chatId,
            targetedText,
            {
              metadata: {
                type: "notify_user",
                taskId: task?.id,
                taskGoal: task?.goal ? task.goal.slice(0, 200) : undefined,
                title: title || undefined,
                message,
                urgency,
                timestamp: Date.now(),
                userId: participant.userId,
              },
            }
          );
          sentCount += 1;
        } catch {
          // Continue to other participants
        }
      }

      if (sentCount > 0) {
        return { sent: true, via: "integration", sentCount, totalEnabled: participants.size };
      }
    }

    let preferredRouteError = null;
    const preferredTarget = task?.id ? resolveTaskPreferredTarget(task) : null;
    if (preferredTarget?.integrationId && integrationEngine) {
      try {
        const taggedText = `${fullText}\n\nTask ID: ${task.id}`;
        const mention = userMention({
          userId: preferredTarget.userId,
          platform: preferredTarget.platform,
        });
        const targetedText = mention ? `${mention} ${taggedText}` : taggedText;
        await integrationEngine.sendMessage(
          preferredTarget.integrationId,
          preferredTarget.chatId,
          targetedText,
          {
            metadata: {
              type: "notify_user",
              taskId: task?.id,
              taskGoal: task?.goal ? task.goal.slice(0, 200) : undefined,
              title: title || undefined,
              message,
              urgency,
              timestamp: Date.now(),
              routeSource: preferredTarget.source,
            },
          }
        );
        return {
          sent: true,
          via: preferredTarget.source,
          integrationId: preferredTarget.integrationId,
        };
      } catch (err) {
        preferredRouteError = err?.message || "Unknown integration delivery error";
      }
    }

    // If task has no linked social user, optionally fall back to broadcast (non-task notifications).
    if (!task?.id && integrationEngine?.hasEnabledIntegrations?.()) {
      const dispatch = await integrationEngine.broadcastMessage(fullText, {
        metadata: {
          type: "notify_user",
          taskId: null,
          title: title || undefined,
          message,
          urgency,
          timestamp: Date.now(),
        },
      });
      if (dispatch.sentCount > 0)
        return {
          sent: true,
          via: "integration",
          sentCount: dispatch.sentCount,
          totalEnabled: dispatch.totalEnabled,
        };
    }

    return {
      sent: false,
      reason: task?.id
        ? preferredRouteError
          ? `Preferred task integration failed: ${preferredRouteError}`
          : "No linked social participant found for this task and no preferred task integration is configured."
        : "No enabled direct social integration could deliver this notification.",
    };
  },
};
