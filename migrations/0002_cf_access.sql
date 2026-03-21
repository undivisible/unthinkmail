-- Migrate to Cloudflare Access auth: remove password storage
-- Drop and recreate tables cleanly (all existing data is test-only)
DROP TABLE IF EXISTS credentials;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  imap_host_enc TEXT NOT NULL,
  imap_port_enc TEXT NOT NULL,
  imap_user_enc TEXT NOT NULL,
  imap_pass_enc TEXT NOT NULL,
  smtp_host_enc TEXT NOT NULL,
  smtp_port_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
