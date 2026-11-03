CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(512) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'auditor',
  first_name VARCHAR(128) NOT NULL DEFAULT '',
  last_name VARCHAR(128) NOT NULL DEFAULT '',
  contractor_id VARCHAR(64),
  notify_email VARCHAR(255),
  notification_settings JSONB DEFAULT '{}',
  google_refresh_token TEXT,
  google_access_token TEXT,
  google_email VARCHAR(255),
  telegram_chat_id VARCHAR(64),
  avatar_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  approval_requested_at TIMESTAMPTZ,
  company VARCHAR(512) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  job_title VARCHAR(256) NOT NULL DEFAULT '',
  object_ids JSONB NOT NULL DEFAULT '[]',
  tutorial_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS registration_pending (
  email VARCHAR(255) PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  first_name VARCHAR(128) NOT NULL DEFAULT '',
  last_name VARCHAR(128) NOT NULL DEFAULT '',
  full_name VARCHAR(255) NOT NULL DEFAULT '',
  company VARCHAR(512) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  job_title VARCHAR(256) NOT NULL DEFAULT '',
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_pending (
  email VARCHAR(255) PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
