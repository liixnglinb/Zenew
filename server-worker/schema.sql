-- 知新 Zenew 网关数据库结构（Cloudflare D1）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_log (user_id, created_at);

-- 邀请码：注册必须凭码，一次性使用（防止别人免费使用软件）
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  note TEXT,
  created_at TEXT NOT NULL,
  used_by_email TEXT,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invite_used ON invite_codes (used_by_email);
