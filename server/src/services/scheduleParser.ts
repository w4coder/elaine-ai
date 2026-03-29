export const INTERVAL_PRESETS: Record<string, number> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

export function parseIntervalMs(value: string): number {
  const trimmed = value.trim();
  if (trimmed in INTERVAL_PRESETS) {
    return INTERVAL_PRESETS[trimmed];
  }
  // Try numeric ms
  const ms = Number(trimmed);
  if (!isNaN(ms) && ms > 0) return Math.floor(ms);
  throw new Error(
    `Invalid interval value: "${value}". Use one of: ${Object.keys(INTERVAL_PRESETS).join(", ")}`
  );
}

export function computeNextRunAt(
  intervalMs: number,
  from = Date.now(),
  runAtTime?: string,
  runAtDay?: number
): string {
  const base = new Date(from);

  if (runAtTime) {
    const [hh, mm] = runAtTime.split(":").map(Number);
    if (!isNaN(hh) && !isNaN(mm)) {
      const candidate = new Date(base);

      if (runAtDay !== undefined) {
        // Weekly: advance to the next occurrence of runAtDay at runAtTime
        const currentDay = candidate.getDay();
        let daysUntil = (runAtDay - currentDay + 7) % 7;
        candidate.setHours(hh, mm, 0, 0);
        if (daysUntil === 0 && candidate.getTime() <= base.getTime()) {
          daysUntil = 7;
        }
        candidate.setDate(candidate.getDate() + daysUntil);
        candidate.setHours(hh, mm, 0, 0);
      } else {
        // Daily: next occurrence of HH:MM
        candidate.setHours(hh, mm, 0, 0);
        if (candidate.getTime() <= base.getTime()) {
          candidate.setDate(candidate.getDate() + 1);
        }
      }

      return candidate.toISOString();
    }
  }

  return new Date(from + intervalMs).toISOString();
}
