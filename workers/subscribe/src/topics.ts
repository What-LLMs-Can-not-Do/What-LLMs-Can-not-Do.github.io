export const ALL_TOPICS = ["news", "additions", "changes"] as const;
export type Topic = (typeof ALL_TOPICS)[number];

export function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && (ALL_TOPICS as readonly string[]).includes(value);
}

export function normalizeTopics(raw: unknown): Topic[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Topic>();
  for (const item of raw) {
    if (isTopic(item)) seen.add(item);
  }
  return ALL_TOPICS.filter((t) => seen.has(t));
}

export function parseTopicsJson(raw: string | null | undefined): Topic[] {
  if (!raw) return [];
  try {
    return normalizeTopics(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function topicsJson(topics: Topic[]): string {
  return JSON.stringify(normalizeTopics(topics));
}
