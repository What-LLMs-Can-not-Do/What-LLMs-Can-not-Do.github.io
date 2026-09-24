import type { Frequency } from "./frequencies";
import { DEFAULT_FREQUENCY, normalizeFrequency } from "./frequencies";
import type { Topic } from "./topics";
import { parseTopicsJson, topicsJson } from "./topics";

export type SubscriberRow = {
  email: string;
  topics_json: string;
  frequency: string;
  confirmed: number;
  confirm_token: string;
  unsub_token: string;
  last_digest_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PendingEventRow = {
  id: number;
  topic: string;
  title: string;
  summary: string;
  pr_url: string;
  highlights_json: string;
  field_changes_json: string;
  created_at: string;
};

export type NotifyEventInput = {
  topic: "additions" | "changes";
  title: string;
  summary: string;
  prUrl: string;
  highlights: { field?: string; value?: string }[];
  fieldChanges: { field?: string; before?: string; after?: string }[];
};

export async function getByEmail(
  db: D1Database,
  email: string
): Promise<SubscriberRow | null> {
  return db
    .prepare("SELECT * FROM subscribers WHERE email = ?")
    .bind(email)
    .first<SubscriberRow>();
}

export async function getByConfirmToken(
  db: D1Database,
  token: string
): Promise<SubscriberRow | null> {
  return db
    .prepare("SELECT * FROM subscribers WHERE confirm_token = ?")
    .bind(token)
    .first<SubscriberRow>();
}

export async function getByUnsubToken(
  db: D1Database,
  token: string
): Promise<SubscriberRow | null> {
  return db
    .prepare("SELECT * FROM subscribers WHERE unsub_token = ?")
    .bind(token)
    .first<SubscriberRow>();
}

export async function upsertSubscription(
  db: D1Database,
  options: {
    email: string;
    topics: Topic[];
    frequency: Frequency;
    confirmToken: string;
    unsubToken: string;
    confirmed: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO subscribers (
         email, topics_json, frequency, confirmed, confirm_token, unsub_token,
         last_digest_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         topics_json = excluded.topics_json,
         frequency = excluded.frequency,
         confirmed = CASE
           WHEN subscribers.confirmed = 1 THEN 1
           ELSE excluded.confirmed
         END,
         confirm_token = CASE
           WHEN subscribers.confirmed = 1 THEN subscribers.confirm_token
           ELSE excluded.confirm_token
         END,
         unsub_token = subscribers.unsub_token,
         last_digest_at = subscribers.last_digest_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      options.email,
      topicsJson(options.topics),
      options.frequency,
      options.confirmed ? 1 : 0,
      options.confirmToken,
      options.unsubToken,
      now,
      now
    )
    .run();
}

export async function confirmSubscription(db: D1Database, token: string): Promise<SubscriberRow | null> {
  const row = await getByConfirmToken(db, token);
  if (!row) return null;
  const now = new Date().toISOString();
  // Start digests from confirmation time so new subscribers skip pre-confirm backlog.
  await db
    .prepare(
      `UPDATE subscribers
       SET confirmed = 1, last_digest_at = COALESCE(last_digest_at, ?), updated_at = ?
       WHERE confirm_token = ?`
    )
    .bind(now, now, token)
    .run();
  return {
    ...row,
    confirmed: 1,
    last_digest_at: row.last_digest_at || now,
    updated_at: now,
  };
}

export async function unsubscribeAll(db: D1Database, token: string): Promise<SubscriberRow | null> {
  const row = await getByUnsubToken(db, token);
  if (!row) return null;
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE subscribers SET topics_json = '[]', confirmed = 0, updated_at = ? WHERE unsub_token = ?`
    )
    .bind(now, token)
    .run();
  return { ...row, topics_json: "[]", confirmed: 0, updated_at: now };
}

export async function listConfirmedForTopic(
  db: D1Database,
  topic: Topic,
  frequency?: Frequency
): Promise<SubscriberRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM subscribers WHERE confirmed = 1`)
    .all<SubscriberRow>();
  return (results || []).filter((row) => {
    if (!parseTopicsJson(row.topics_json).includes(topic)) return false;
    if (!frequency) return true;
    return normalizeFrequency(row.frequency || DEFAULT_FREQUENCY) === frequency;
  });
}

export async function listConfirmedByFrequency(
  db: D1Database,
  frequency: Frequency
): Promise<SubscriberRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM subscribers WHERE confirmed = 1`)
    .all<SubscriberRow>();
  return (results || []).filter(
    (row) => normalizeFrequency(row.frequency || DEFAULT_FREQUENCY) === frequency
  );
}

export async function listAllSubscribers(db: D1Database): Promise<
  Omit<SubscriberRow, "confirm_token" | "unsub_token">[]
> {
  const { results } = await db
    .prepare(
      `SELECT email, topics_json, frequency, confirmed, last_digest_at, created_at, updated_at
       FROM subscribers
       ORDER BY created_at DESC`
    )
    .all<Omit<SubscriberRow, "confirm_token" | "unsub_token">>();
  return results || [];
}

export async function insertPendingEvent(
  db: D1Database,
  event: NotifyEventInput
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO pending_events (
         topic, title, summary, pr_url, highlights_json, field_changes_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      event.topic,
      event.title,
      event.summary,
      event.prUrl,
      JSON.stringify(event.highlights),
      JSON.stringify(event.fieldChanges),
      now
    )
    .run();
  return Number(result.meta.last_row_id || 0);
}

export async function listPendingEventsSince(
  db: D1Database,
  topic: Topic,
  sinceIso: string
): Promise<PendingEventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM pending_events
       WHERE topic = ? AND created_at > ?
       ORDER BY created_at ASC`
    )
    .bind(topic, sinceIso)
    .all<PendingEventRow>();
  return results || [];
}

export async function markDigestSent(
  db: D1Database,
  email: string,
  atIso: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE subscribers SET last_digest_at = ?, updated_at = ? WHERE email = ?`
    )
    .bind(atIso, atIso, email)
    .run();
}

export async function prunePendingEventsOlderThan(
  db: D1Database,
  olderThanIso: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM pending_events WHERE created_at < ?`)
    .bind(olderThanIso)
    .run();
}

export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function subscriberFrequency(row: { frequency?: string | null }): Frequency {
  return normalizeFrequency(row.frequency || DEFAULT_FREQUENCY);
}
