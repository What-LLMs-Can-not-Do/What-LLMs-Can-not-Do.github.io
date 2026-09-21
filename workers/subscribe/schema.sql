CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  topics_json TEXT NOT NULL DEFAULT '[]',
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirm_token TEXT NOT NULL,
  unsub_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscribers_confirm_token ON subscribers(confirm_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_unsub_token ON subscribers(unsub_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_confirmed ON subscribers(confirmed);
