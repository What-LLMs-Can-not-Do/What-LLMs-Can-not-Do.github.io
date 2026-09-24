export const PUBLIC_TOPICS = ["news", "additions", "changes"] as const;
export type PublicTopic = (typeof PUBLIC_TOPICS)[number];

/** Includes hidden internal topics (not offered on the Subscribe form). */
export const ALL_TOPICS = ["news", "additions", "changes", "debug"] as const;
export type Topic = (typeof ALL_TOPICS)[number];

export function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && (ALL_TOPICS as readonly string[]).includes(value);
}

export function isPublicTopic(value: unknown): value is PublicTopic {
  return typeof value === "string" && (PUBLIC_TOPICS as readonly string[]).includes(value);
}

/** Topics a visitor may select via POST /subscribe. */
export function normalizePublicTopics(raw: unknown): PublicTopic[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<PublicTopic>();
  for (const item of raw) {
    if (isPublicTopic(item)) seen.add(item);
  }
  return PUBLIC_TOPICS.filter((t) => seen.has(t));
}

/** Full topic set, including hidden ones like debug (for DB reads / admin). */
export function normalizeTopics(raw: unknown): Topic[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Topic>();
  for (const item of raw) {
    if (isTopic(item)) seen.add(item);
  }
  return ALL_TOPICS.filter((t) => seen.has(t));
}

/** Keep hidden topics (e.g. debug) when a user updates public preferences. */
export function mergePublicTopicsWithInternal(
  publicTopics: PublicTopic[],
  existing: Topic[]
): Topic[] {
  const internal = existing.filter((t) => !isPublicTopic(t));
  return normalizeTopics([...publicTopics, ...internal]);
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
