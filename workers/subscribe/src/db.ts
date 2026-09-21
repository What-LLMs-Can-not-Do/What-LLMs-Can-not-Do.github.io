import type { Topic } from "./topics";
import { parseTopicsJson, topicsJson } from "./topics";

export type SubscriberRow = {
  email: string;
  topics_json: string;
  confirmed: number;
  confirm_token: string;
  unsub_token: string;
  created_at: string;
  updated_at: string;
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
    confirmToken: string;
    unsubToken: string;
    confirmed: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO subscribers (email, topics_json, confirmed, confirm_token, unsub_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         topics_json = excluded.topics_json,
         confirmed = CASE
           WHEN subscribers.confirmed = 1 THEN 1
           ELSE excluded.confirmed
         END,
         confirm_token = CASE
           WHEN subscribers.confirmed = 1 THEN subscribers.confirm_token
           ELSE excluded.confirm_token
         END,
         unsub_token = subscribers.unsub_token,
         updated_at = excluded.updated_at`
    )
    .bind(
      options.email,
      topicsJson(options.topics),
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
  await db
    .prepare(
      `UPDATE subscribers SET confirmed = 1, updated_at = ? WHERE confirm_token = ?`
    )
    .bind(now, token)
    .run();
  return { ...row, confirmed: 1, updated_at: now };
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
  topic: Topic
): Promise<SubscriberRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM subscribers WHERE confirmed = 1`)
    .all<SubscriberRow>();
  return (results || []).filter((row) => parseTopicsJson(row.topics_json).includes(topic));
}
