CREATE INDEX sessions_started_at ON sessions (started_at, site_id);

CREATE TABLE telegram_alert_state (
  site_id TEXT PRIMARY KEY,
  last_alert_at INTEGER NOT NULL
);
