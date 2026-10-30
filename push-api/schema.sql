CREATE TABLE IF NOT EXISTS devices (
  endpoint TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  source TEXT NOT NULL CHECK(source IN ('planner','yahoo')),
  event_id TEXT NOT NULL,
  milestone INTEGER NOT NULL CHECK(milestone IN (1440,60,15)),
  fire_at INTEGER NOT NULL,
  event_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  revision TEXT NOT NULL,
  sent_at INTEGER,
  PRIMARY KEY(source,event_id,milestone)
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders(sent_at,fire_at);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);