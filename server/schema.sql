-- ORI persistence layer — schema
-- Applied idempotently on server boot by db.mjs.
-- Uses WAL for concurrent read performance under many live connections.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Early-access waitlist captured from the hero CTA.
CREATE TABLE IF NOT EXISTS waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE,
  company     TEXT,
  use_case    TEXT,
  region      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  ip_hash     TEXT
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist (created_at);

-- Edge regions rendered on the globe + status board.
CREATE TABLE IF NOT EXISTS regions (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'core',
  status      TEXT NOT NULL DEFAULT 'operational'
);

-- Rolling time-series of synthetic cluster telemetry, broadcast live over WS.
CREATE TABLE IF NOT EXISTS metrics_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL DEFAULT (datetime('now')),
  rps         INTEGER NOT NULL,
  p99_ms      REAL    NOT NULL,
  edge_nodes  INTEGER NOT NULL,
  gpu_util    REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_log (ts);

-- Simple counters (total page loads, concurrent peak, etc.).
CREATE TABLE IF NOT EXISTS counters (
  key         TEXT PRIMARY KEY,
  value       INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO counters (key, value) VALUES
  ('visits', 0),
  ('peak_concurrent', 0),
  ('waitlist_total', 0);
