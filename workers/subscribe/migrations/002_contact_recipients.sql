-- Admin contact inbox recipients (Email Routing fan-out).
CREATE TABLE IF NOT EXISTS contact_recipients (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
