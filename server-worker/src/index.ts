/**
 * 知新 Zenew 云端网关 — Cloudflare Workers 版
 * 与 server/app/main.py（FastAPI）1:1 对齐：账号 / LLM 代理 / 额度计量 / 课程目录
 *
 * 端点：GET /health · GET /courses · POST /auth/register · POST /auth/login ·
 *       GET /me · POST /gen/outline · POST /gen/cards
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { SignJWT, jwtVerify } from 'jose'
import coursesData from './courses.json'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
  LLM_PROVIDER: string
  LLM_BASE_URL: string
  LLM_API_KEY: string
  LLM_MODEL: string
  FREE_MONTHLY_TOKENS: string
  GLOBAL_MONTHLY_TOKENS: string
  RATE_PER_MIN: string
  PBKDF2_ITERATIONS: string
}

type Vars = { userId: number; email: string }
const app = new Hono<{ Bindings: Env; Variables: Vars }>()

// ---------- CORS：Tauri 打包版源是 http(s)://tauri.localhost，dev 是 localhost:5173 ----------
const ALLOW_EXACT = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5199', 'http://127.0.0.1:5199',
  'tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost',
]
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*'
      if (ALLOW_EXACT.includes(origin)) return origin
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
      return ''
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
)

// ---------- 工具 ----------
const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array((s.match(/.{2}/g) || []).map((b) => parseInt(b, 16)))
const nowIso = () => new Date().toISOString()
const monthPrefix = () => nowIso().slice(0, 7)

async function hashPw(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unhex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  )
  return hex(bits)
}

function iterations(env: Env) {
  const n = parseInt(env.PBKDF2_ITERATIONS || '200000', 10)
  return Number.isFinite(n) && n > 0 ? n : 200000
}

async function makeToken(env: Env, userId: number, email: string) {
  return new SignJWT({ sub: String(userId), email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(enc.encode(env.JWT_SECRET))
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const err = (c: any, code: number, detail: string) => c.json({ detail }, code)

// ---------- 鉴权中间件 ----------
const auth = async (c: any, next: any) => {
  const h = c.req.header('Authorization') || ''
  if (!h.startsWith('Bearer ')) return err(c, 401, '未登录')
  try {
    const { payload } = await jwtVerify(h.slice(7), enc.encode(c.env.JWT_SECRET))
    const id = Number(payload.sub)
    const user = await c.env.DB.prepare('SELECT id,email FROM users WHERE id=?').bind(id).first()
    // 必须同时匹配 id 与 email：防止换库/重建后 id 撞车导致串号
    if (!user || (payload.email && payload.email !== user.email)) return err(c, 401, '登录已失效，请重新登录')
    c.set('userId', id)
    c.set('email', user.email as string)
    await next()
  } catch {
    return err(c, 401, '登录已过期')
  }
}

async function usedThisMonth(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(tokens_in+tokens_out),0) AS used FROM usage_log WHERE user_id=? AND created_at LIKE ?'
  )
    .bind(userId, monthPrefix() + '%')
    .first<{ used: number }>()
  return row?.used ?? 0
}

async function checkQuota(env: Env, userId: number) {
  const quota = parseInt(env.FREE_MONTHLY_TOKENS || '200000', 10)
  return (await usedThisMonth(env, userId)) >= quota
}

/** 全局月度预算熔断：保护服务端 LLM key 不被刷爆（0 或未设 = 不限制） */
async function globalBudgetExhausted(env: Env): Promise<boolean> {
  const cap = parseInt(env.GLOBAL_MONTHLY_TOKENS || '0', 10)
  if (!Number.isFinite(cap) || cap <= 0) return false
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(tokens_in+tokens_out),0) AS used FROM usage_log WHERE created_at LIKE ?'
  )
    .bind(monthPrefix() + '%')
    .first<{ used: number }>()
  return (row?.used ?? 0) >= cap
}

/** 限流：近 60 秒内该用户的生成请求数（D1 计数，跨 isolate 有效） */
async function overRate(env: Env, userId: number): Promise<boolean> {
  const limit = parseInt(env.RATE_PER_MIN || '10', 10)
  const since = new Date(Date.now() - 60_000).toISOString()
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_log WHERE user_id=? AND created_at>=?')
    .bind(userId, since)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= limit
}

async function logUsage(env: Env, userId: number, endpoint: string, usage: { prompt_tokens?: number; completion_tokens?: number }) {
  await env.DB.prepare(
    'INSERT INTO usage_log(user_id,endpoint,provider,model,tokens_in,tokens_out,created_at) VALUES(?,?,?,?,?,?,?)'
  )
    .bind(
      userId,
      endpoint,
      env.LLM_PROVIDER,
      env.LLM_PROVIDER === 'mock' ? 'mock' : env.LLM_MODEL,
      usage.prompt_tokens ?? 0,
      usage.completion_tokens ?? 0,
      nowIso()
    )
    .run()
}

// ---------- LLM ----------
type Usage = { prompt_tokens: number; completion_tokens: number }

async function llmChat(env: Env, system: string, user: string): Promise<{ content: string; usage: Usage }> {
  const resp = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`LLM ${resp.status}: ${text.slice(0, 200)}`)
  }
  const data: any = await resp.json()
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
    },
  }
}

function extractJson(text: string): any {
  const m = text.trim().match(/\{[\s\S]*\}/)
  if (!m) throw new Error('模型未返回 JSON')
  return JSON.parse(m[0])
}

// ---------- 卡片质检（与 FastAPI 版规则一致）----------
function lintCards(cards: any[]): { ok: any[]; bad: any[] } {
  const ok: any[] = []
  const bad: any[] = []
  for (const c of cards) {
    const front = String(c?.front ?? '').trim()
    const back = String(c?.back ?? '').trim()
    const type = c?.type ?? 'basic'
    const reasons: string[] = []
    if (!front || !back) reasons.push('空题面或空答案')
    if (!String(c?.explanation ?? '').trim()) reasons.push('缺少解释')
    if (front.length > 100) reasons.push('题面过长（>100 字）')
    if (front === back) reasons.push('题面与答案相同')
    if (type === 'choice') {
      const ch = c?.choices ?? []
      if (!Array.isArray(ch) || ch.length !== 4 || !Number.isInteger(c?.answer_index) || c.answer_index < 0 || c.answer_index > 3) {
        reasons.push('选择题选项/答案无效')
      }
    }
    if (front.split('？').length - 1 > 1) reasons.push('一题多问')
    if (reasons.length) bad.push({ ...c, reject: reasons })
    else ok.push(c)
  }
  return { ok, bad }
}

// ---------- 基础端点 ----------
app.get('/health', (c) => c.json({ ok: true, provider: c.env.LLM_PROVIDER }))

app.get('/courses', (c) => c.json(coursesData))

app.post('/auth/register', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const inviteCode = String(body.invite_code ?? '').trim().toUpperCase()
  if (!EMAIL_RE.test(email)) return err(c, 400, '邮箱格式不正确')
  if (password.length < 8) return err(c, 400, '密码至少 8 位')
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()
  if (exists) return err(c, 400, '该邮箱已注册')

  // 邀请码：注册的唯一入口（防止他人免费使用）
  if (!inviteCode) return err(c, 400, '需要邀请码')
  const claimed = await c.env.DB.prepare(
    'UPDATE invite_codes SET used_by_email=?, used_at=? WHERE code=? AND used_by_email IS NULL'
  )
    .bind(email, nowIso(), inviteCode)
    .run()
  if (!claimed.meta.changes) return err(c, 403, '邀请码无效或已被使用')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = hex(salt.buffer)
  const pwHash = await hashPw(password, saltHex, iterations(c.env))
  let userId: number
  try {
    const res = await c.env.DB.prepare('INSERT INTO users(email,pw_hash,salt,created_at) VALUES(?,?,?,?)')
      .bind(email, pwHash, saltHex, nowIso())
      .run()
    userId = Number(res.meta.last_row_id)
  } catch (e) {
    // 建号失败 → 释放邀请码，避免白白消耗
    await c.env.DB.prepare('UPDATE invite_codes SET used_by_email=NULL, used_at=NULL WHERE code=?').bind(inviteCode).run()
    throw e
  }
  return c.json({ token: await makeToken(c.env, userId, email), email })
})

app.post('/auth/login', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const user = await c.env.DB.prepare('SELECT id,pw_hash,salt FROM users WHERE email=?')
    .bind(email)
    .first<{ id: number; pw_hash: string; salt: string }>()
  if (!user) return err(c, 401, '邮箱或密码错误')
  const attempt = await hashPw(String(body.password ?? ''), user.salt, iterations(c.env))
  if (attempt !== user.pw_hash) return err(c, 401, '邮箱或密码错误')
  return c.json({ token: await makeToken(c.env, user.id, email), email })
})

app.get('/me', auth, async (c) => {
  const userId = c.get('userId')
  return c.json({
    email: c.get('email'),
    used_tokens: await usedThisMonth(c.env, userId),
    quota_tokens: parseInt(c.env.FREE_MONTHLY_TOKENS || '200000', 10),
  })
})

// ---------- 生成 ----------
app.post('/gen/outline', auth, async (c) => {
  const userId = c.get('userId')
  if (await globalBudgetExhausted(c.env)) return err(c, 503, '服务本月额度已用完，请下月再来')
  if (await overRate(c.env, userId)) return err(c, 429, '请求太频繁，请稍后再试')
  if (await checkQuota(c.env, userId)) return err(c, 402, '本月免费额度已用完')

  const body: any = await c.req.json().catch(() => ({}))
  const title = String(body.title ?? '').trim()
  const numChapters = Math.min(12, Math.max(1, parseInt(body.num_chapters ?? 5, 10) || 5))
  if (!title) return err(c, 400, '缺少课程名')

  let content: string
  let usage: Usage
  if (c.env.LLM_PROVIDER === 'mock') {
    const chapters = Array.from({ length: numChapters }, (_, i) => ({
      title: `第${i + 1}章 ${title}基础模块${i + 1}`,
      topics: [1, 2, 3].map((j) => `${title}核心概念${i + 1}-${j}`),
    }))
    content = JSON.stringify({ chapters })
    usage = { prompt_tokens: 100, completion_tokens: 200 }
  } else {
    const system = '你是大学课程大纲专家。只输出 JSON。'
    const userPrompt =
      `为大学课程《${title}》生成教学大纲，${numChapters} 章。` +
      '输出 JSON：{"chapters":[{"title":"章标题","topics":["知识点1","知识点2"]}]}，每章 3-6 个知识点。'
    const r = await llmChat(c.env, system, userPrompt)
    content = r.content
    usage = r.usage
  }
  await logUsage(c.env, userId, '/gen/outline', usage)
  const data = extractJson(content)
  return c.json({ outline: data.chapters ?? [], provider: c.env.LLM_PROVIDER, usage })
})

app.post('/gen/cards', auth, async (c) => {
  const userId = c.get('userId')
  if (await globalBudgetExhausted(c.env)) return err(c, 503, '服务本月额度已用完，请下月再来')
  if (await overRate(c.env, userId)) return err(c, 429, '请求太频繁，请稍后再试')
  if (await checkQuota(c.env, userId)) return err(c, 402, '本月免费额度已用完')

  const body: any = await c.req.json().catch(() => ({}))
  const topicTitle = String(body.topic_title ?? '').trim()
  if (!topicTitle) return err(c, 400, '缺少知识点标题')
  const n = Math.min(12, Math.max(1, parseInt(body.n ?? 5, 10) || 5))
  const allowed = ['basic', 'why', 'choice']
  const types: string[] = (Array.isArray(body.types) ? body.types : []).filter((t: string) => allowed.includes(t))
  const useTypes = types.length ? types : ['basic']
  const context = typeof body.context === 'string' ? body.context.slice(0, 4000) : ''

  let content: string
  let usage: Usage
  if (c.env.LLM_PROVIDER === 'mock') {
    const cards = Array.from({ length: n }, (_, i) => {
      const t = useTypes[i % useTypes.length]
      const card: any = {
        type: t,
        front: `（mock）${topicTitle}的要点${i + 1}是什么？`,
        back: `要点${i + 1}的内容`,
        explanation: 'mock 解释：用于联调',
      }
      if (t === 'choice') {
        card.choices = ['甲', '乙', '丙', '丁']
        card.answer_index = i % 4
      }
      return card
    })
    content = JSON.stringify({ cards })
    usage = { prompt_tokens: 100, completion_tokens: 200 }
  } else {
    const system =
      '你是精通学习科学的大学助教，依据提取练习原理出卡。每张卡只考一个点；' +
      'front 是单一问句；back 简洁；explanation 必填（为什么/常见错误）；不要出现 emoji。只输出 JSON。'
    const userPrompt =
      `知识点：《${topicTitle}》` +
      `\n参考材料片段：\n${context || '（无，凭可靠学科知识生成）'}` +
      `\n生成 ${n} 张卡片，类型从 ${useTypes.join(',')} 中选择，choice 卡需 4 个选项。` +
      '输出 JSON：{"cards":[{"type":"basic|why|choice","front":"...","back":"...","explanation":"...","choices":["A","B","C","D"],"answer_index":0}]}' +
      '（choices/answer_index 仅 choice 卡需要）'
    const r = await llmChat(c.env, system, userPrompt)
    content = r.content
    usage = r.usage
  }
  await logUsage(c.env, userId, '/gen/cards', usage)
  const data = extractJson(content)
  const { ok, bad } = lintCards(Array.isArray(data.cards) ? data.cards : [])
  return c.json({ cards: ok, rejected: bad, provider: c.env.LLM_PROVIDER, usage })
})

app.notFound((c) => c.json({ detail: '接口不存在' }, 404))
app.onError((e, c) => c.json({ detail: String(e?.message ?? e) }, 500))

export default app
