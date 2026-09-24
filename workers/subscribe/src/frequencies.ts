export const ALL_FREQUENCIES = [
  "immediate",
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;

export type Frequency = (typeof ALL_FREQUENCIES)[number];

export const DEFAULT_FREQUENCY: Frequency = "weekly";

export function isFrequency(value: unknown): value is Frequency {
  return (
    typeof value === "string" &&
    (ALL_FREQUENCIES as readonly string[]).includes(value)
  );
}

export function normalizeFrequency(raw: unknown): Frequency {
  if (typeof raw !== "string") return DEFAULT_FREQUENCY;
  const value = raw.trim().toLowerCase();
  return isFrequency(value) ? value : DEFAULT_FREQUENCY;
}

/** Frequencies whose digest should run on this UTC calendar day. */
export function frequenciesDueOn(now: Date): Frequency[] {
  const due: Frequency[] = ["daily"];
  if (now.getUTCDay() === 1) due.push("weekly");
  if (now.getUTCDate() === 1) due.push("monthly");
  if (now.getUTCMonth() === 0 && now.getUTCDate() === 1) due.push("yearly");
  return due;
}

export function frequencyLabel(frequency: Frequency): string {
  switch (frequency) {
    case "immediate":
      return "Immediate";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "yearly":
      return "Yearly";
  }
}

/** True if last_digest_at is already today (UTC), so cron retries are no-ops. */
export function alreadyDigestedToday(
  lastDigestAt: string | null | undefined,
  now: Date
): boolean {
  if (!lastDigestAt) return false;
  const last = new Date(lastDigestAt);
  if (Number.isNaN(last.getTime())) return false;
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate()
  );
}
