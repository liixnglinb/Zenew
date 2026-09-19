# 知新 Zenew 云端网关 · Cloudflare Workers 版

与 `server/`（本地 FastAPI 版）功能 1:1 对齐的**公网部署版**：账号 / LLM 代理 / 额度计量 / 课程目录。

| 端点 | 说明 |
|---|---|
| `GET /health` | 健康检查，回显当前 provider |
| `GET /courses` | 内置课程目录（打包进 Worker，`src/courses.json`） |
| `POST /auth/register` | 邮箱注册 → 返还 JWT（7 天） |
| `POST /auth/login` | 登录 → 返还 JWT |
| `GET /me` | 当前用户 + 本月已用/总额度 |
| `POST /gen/outline` | 课程大纲生成（限流 + 额度校验 + 计量） |
| `POST /gen/cards` | 知识点卡片生成（含质检门：空题面/缺解释/选项非法/一题多问→拒收） |

技术栈：**Hono**（路由 + CORS）+ **D1**（SQLite 数据库，与 FastAPI 版同结构）+ **jose**（HS256 JWT）+ **Web Crypto**（PBKDF2-SHA256 口令哈希）。LLM 密钥只存在于 Worker Secret，客户端永不接触。

---

## 部署步骤

```bash
cd server-worker

# 1. 授权（浏览器点 Allow）
npx wrangler login
npx wrangler whoami            # 记下 Account ID，填进 wrangler.toml

# 2. 建 D1 数据库，把输出的 database_id 填进 wrangler.toml
npx wrangler d1 create zenew-apac --location apac

# 3. 建表（线上库）
npx wrangler d1 execute zenew-apac --remote --file schema.sql

# 4. 写密钥（交互输入，不落盘）
npx wrangler secret put JWT_SECRET     # 建议 32 字节以上随机串
npx wrangler secret put LLM_API_KEY    # 阿里云百炼 / DeepSeek 的 key

# 5. 切真实模型：把 wrangler.toml 的 LLM_PROVIDER 改为 openai 后部署
npx wrangler deploy
```

部署后会得到 `https://zenew-gateway.<account>.workers.dev` 试用地址，可直接验证：

```bash
curl -s https://zenew-gateway.<account>.workers.dev/health
```

### 绑定自定义域名

`wrangler.toml` 末尾取消注释（域名 DNS 已在 Cloudflare 账户下）：

```toml
[[routes]]
pattern = "zenew-api.lxlrwxs.top"
custom_domain = true
```

再 `npx wrangler deploy`，几分钟后 `https://zenew-api.lxlrwxs.top/health` 生效。

---

## 套餐与 CPU 预算（实测数据）

| 项 | Workers Free | Workers Paid（$5/月） |
|---|---|---|
| 单请求 CPU | 10 ms | 30 s |
| PBKDF2 迭代建议 | **10000**（实测 ≈5 ms） | 200000（实测 ≈30 ms） |
| D1 | 免费额度充足（读 500 万行/天、存 5 GB） | 更高 |
| 说明 | 注册/登录有超时风险，建议先用 10000 | 公开产品推荐；一次 $5 覆盖整个网关 |

> ⚠️ 只调 `PBKDF2_ITERATIONS` 不改代码：它走 `[vars]`，Free/Paid 切换只改这一行。

---

## 客户端对接

桌面端「设置 → 服务地址」填 Worker 地址即可；正式发版时把默认值从 `http://127.0.0.1:8765`
改为 `https://zenew-api.lxlrwxs.top`（`app/src/api.ts` 的默认常量），随 v0.3.0 一起下发（走免安装更新）。

## Key 安全（服务端持有，客户端永不接触）

| 措施 | 说明 |
|---|---|
| 密钥位置 | 仅 `wrangler secret`（加密存储）；代码、仓库、客户端、日志均无 |
| 每账号额度 | `FREE_MONTHLY_TOKENS=200000`（月），用满返回 402 |
| 限流 | `RATE_PER_MIN=10`（D1 计数，跨 isolate 生效），超限 429 |
| **全局熔断** | `GLOBAL_MONTHLY_TOKENS=20000000`（≈¥20/月）；本月所有用户累计超出后全员 503，防止有人刷爆 key |
| 账号绑定 | JWT 同时校验 id + email，避免换库/重建后 id 撞车串号 |
| CORS | 只放行自家源（`tauri.localhost` / 本地开发端口），第三方网页无法直接调用 |

## 注册闸门：邀请码（防他人免费使用）

注册**必须凭邀请码**，一次性使用，与用户绑定（`invite_codes` 表：code / note / created_at / used_by_email / used_at）。

```bash
# 生成邀请码（默认 1 个，可指定数量与备注）
node scripts/mint-invite.mjs 5 "首批"
node scripts/mint-invite.mjs 1 "给朋友的"

# 查询所有码与使用情况
npx wrangler d1 execute zenew-apac --remote --command "SELECT code,note,used_by_email,used_at FROM invite_codes ORDER BY created_at DESC"

# 停用某个未使用的码
npx wrangler d1 execute zenew-apac --remote --command "UPDATE invite_codes SET used_by_email='disabled' WHERE code='ZENEW-XXXX-XXXX'"

# 给某账号重置/续期额度（按邮箱删除本月用量）
npx wrangler d1 execute zenew-apac --remote --command "DELETE FROM usage_log WHERE user_id=(SELECT id FROM users WHERE email='a@b.com')"
```

客户端「注册」页有邀请码输入框（v0.4.0 起），无码/用过的码会分别返回「需要邀请码」「邀请码无效或已被使用」。
建号失败会自动释放邀请码，不会白白消耗。

## 本地开发

```bash
npm install
npx wrangler d1 execute zenew-apac --local --file schema.sql   # 建本地库
npm run dev                                               # http://127.0.0.1:8787，provider=mock
```

`LLM_PROVIDER=mock` 时所有生成端点返回确定性假数据（便于联调，不花钱）。
本地密钥放 `.dev.vars`（已 gitignore）。

## 已知约束

- 限流用 D1 计数（近 60 秒内该用户生成请求数），跨 isolate 有效；高并发下可换 Durable Object
- 额度按自然月统计（`created_at LIKE 'YYYY-MM%'`），与 FastAPI 版一致
- 时区统一 UTC；用户可见的「本月」以 UTC 月为准
