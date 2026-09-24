CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  topics_json TEXT NOT NULL DEFAULT '[]',
  frequency TEXT NOT NULL DEFAULT 'weekly',
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirm_token TEXT NOT NULL,
  unsub_token TEXT NOT NULL,
  last_digest_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscribers_confirm_token ON subscribers(confirm_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_unsub_token ON subscribers(unsub_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_confirmed ON subscribers(confirmed);
CREATE INDEX IF NOT EXISTS idx_subscribers_frequency ON subscribers(frequency);

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
