CREATE TABLE IF NOT EXISTS objects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(512) NOT NULL,
  code VARCHAR(32) NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contractors (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(512) NOT NULL,
  type VARCHAR(8) NOT NULL DEFAULT 'ooo',
  inn VARCHAR(32) NOT NULL DEFAULT '',
  executor VARCHAR(256) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS violations (
  id VARCHAR(64) PRIMARY KEY,
  number VARCHAR(64) NOT NULL,
  object_id VARCHAR(64) REFERENCES objects(id) ON DELETE SET NULL,
  contractor_id VARCHAR(64) REFERENCES contractors(id) ON DELETE SET NULL,
  category_id VARCHAR(32) NOT NULL DEFAULT '',
  severity VARCHAR(32) NOT NULL DEFAULT 'major',
  category_other TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  responsible VARCHAR(256) NOT NULL DEFAULT '',
  media JSONB NOT NULL DEFAULT '[]',
  history JSONB NOT NULL DEFAULT '[]',
  comments JSONB NOT NULL DEFAULT '[]',
  norm_refs JSONB NOT NULL DEFAULT '[]',
  location_gps JSONB,
  deadline_approaching_notified BOOLEAN NOT NULL DEFAULT false,
  deadline_expired_notified BOOLEAN NOT NULL DEFAULT false,
  report_media JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_violations_created ON violations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_violations_object ON violations (object_id);
CREATE INDEX IF NOT EXISTS idx_violations_contractor ON violations (contractor_id);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  violation_id VARCHAR(64),
  channel VARCHAR(32) NOT NULL DEFAULT 'push',
  type VARCHAR(64) NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  telegram_recipients JSONB,
  telegram_sent BOOLEAN,
  delivery_status VARCHAR(32),
  is_read BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seq_counters (
  key VARCHAR(64) PRIMARY KEY,
  value INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id VARCHAR(64) PRIMARY KEY,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS violation_categories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  icon VARCHAR(16) NOT NULL DEFAULT '📋',
  sort_order INT NOT NULL DEFAULT 0
);
