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

-- 充值卡密：用户兑换后获得「余额 tokens」（不随月份清零，先用免费额度再用余额）
CREATE TABLE IF NOT EXISTS topup_codes (
  code TEXT PRIMARY KEY,
  tier INTEGER NOT NULL,
  price_cny REAL NOT NULL,
  tokens INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  used_by_email TEXT,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_topup_used ON topup_codes (used_by_email);

-- 余额（每用户一行；不随月份清零）
CREATE TABLE IF NOT EXISTS balances (
  user_id INTEGER PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 网页下单（收款页）：用户下单 → 转账 → 管理员确认 → 自动发码/充值
CREATE TABLE IF NOT EXISTS orders (
  order_no TEXT PRIMARY KEY,
  tier INTEGER NOT NULL,
  price_cny REAL NOT NULL,
  tokens INTEGER NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | confirming | paid
  code TEXT,                                 -- 确认后签发的兑换码
  credited INTEGER NOT NULL DEFAULT 0,       -- 1=已直接充入账号邮箱对应的账户
  created_at TEXT NOT NULL,
  paid_at TEXT,
  confirming_at TEXT,                        -- 抢占时间（中断恢复用）
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at);

-- 登录/注册/兑换码尝试限流（滑动窗口，bucket 到期自动归零复用）
CREATE TABLE IF NOT EXISTS rate_hits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
