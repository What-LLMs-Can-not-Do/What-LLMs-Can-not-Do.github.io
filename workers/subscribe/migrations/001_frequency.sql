-- Frequency preferences + digest queue (safe to re-run where possible).
-- D1/SQLite: ADD COLUMN fails if the column already exists — run once per DB.

ALTER TABLE subscribers ADD COLUMN frequency TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE subscribers ADD COLUMN last_digest_at TEXT;

CREATE TABLE IF NOT EXISTS pending_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  pr_url TEXT NOT NULL DEFAULT '',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  field_changes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_events_topic_created
  ON pending_events(topic, created_at);

CREATE INDEX IF NOT EXISTS idx_subscribers_frequency ON subscribers(frequency);
