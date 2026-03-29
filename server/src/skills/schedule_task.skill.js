/**
 * schedule_task.skill.js
 * Let the agent create a recurring or one-time scheduled task at runtime.
 *
 * Supported schedule expressions:
 *   "every N seconds/minutes/hours/days"
 *   "daily at HH:MM"
 *   "weekly on WEEKDAY at HH:MM"
 */

export default {
  name: "schedule_task",
  description:
    "Schedule a task to run automatically at a given frequency, or once at a future date. " +
    "Use this when the user wants something done on a recurring basis. " +
    'Supported expressions: "every N minutes/hours/days", "daily at HH:MM", "weekly on WEEKDAY at HH:MM". ' +
    "Use start_date to delay the first run. Use one_time=true for a single future execution. " +
    "Returns a scheduleId that can be used to cancel or pause the schedule later.",
  input_schema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "The task goal that will be submitted on every trigger.",
      },
      schedule: {
        type: "string",
        description:
          'Schedule expression. Examples: "every 30 minutes", "every 1 hour", ' +
          '"every 1 day", "daily at 09:00", "weekly on monday at 08:00".',
      },
      start_date: {
        type: "string",
        description:
          "ISO-8601 date/time string. The first run will not happen before this date. " +
          'Example: "2026-03-01" or "2026-03-01T09:00:00". Omit to start immediately.',
      },
      one_time: {
        type: "boolean",
        description:
          "If true, the task runs exactly once (at the next scheduled occurrence or start_date) " +
          "and the schedule is automatically deleted afterwards. Default: false (recurring).",
      },
      meta: {
        type: "object",
        description: "Optional metadata object passed to the task on each run.",
      },
      priority: {
        type: "number",
        description: "Task priority 1–10 (lower = higher priority). Default: 5.",
      },
    },
    required: ["goal", "schedule"],
  },
  execute(input = {}, { schedulerEngine } = {}) {
    if (!schedulerEngine) return { error: "Scheduler not available in this context." };

    if (typeof input.goal !== "string" || !input.goal.trim()) {
      return { error: "goal must be a non-empty string." };
    }
    if (typeof input.schedule !== "string" || !input.schedule.trim()) {
      return { error: "schedule must be a non-empty string." };
    }

    try {
      const entry = schedulerEngine.create({
        goal: input.goal.trim(),
        schedule: input.schedule.trim(),
        start_date: input.start_date ?? null,
        one_time: Boolean(input.one_time),
        meta: input.meta && typeof input.meta === "object" ? input.meta : {},
        priority: Number.isFinite(input.priority) ? input.priority : 5,
      });

      return {
        scheduled: true,
        scheduleId: entry.id,
        goal: entry.goal,
        schedule: entry.schedule,
        one_time: entry.one_time,
        start_date: entry.start_date,
        nextRun: entry.nextRun ? new Date(entry.nextRun).toISOString() : null,
      };
    } catch (err) {
      return { error: err.message };
    }
  },
};
