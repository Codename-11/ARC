-- v3 initial schema. Additive-only migrations from here on in minors.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  launch_mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  worktree TEXT,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_profile ON agents(profile);

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_agent_epoch ON agent_events(agent_id, epoch, seq);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  reply_to INTEGER REFERENCES chat_messages(id),
  mentions TEXT,
  body TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_room_ts ON chat_messages(room_id, ts);

CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  worker_profile TEXT NOT NULL,
  verify_profile TEXT,
  verify_check TEXT,
  status TEXT NOT NULL,
  iteration INTEGER DEFAULT 0,
  max_iterations INTEGER,
  max_time_ms INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  archive_path TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  from_agent TEXT,
  to_profile TEXT NOT NULL,
  template_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  label TEXT,
  token_hash TEXT NOT NULL,
  paired_at INTEGER NOT NULL,
  last_seen INTEGER,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
