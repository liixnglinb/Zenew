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
  ADMIN_TOKEN: string
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

/** 余额（已充值 tokens，不随月份清零） */
async function getBalance(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT tokens FROM balances WHERE user_id=?').bind(userId).first<{ tokens: number }>()
  return row?.tokens ?? 0
}

async function addBalance(env: Env, userId: number, tokens: number) {
  await env.DB.prepare(
    `INSERT INTO balances(user_id,tokens,updated_at) VALUES(?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET tokens = tokens + excluded.tokens, updated_at = excluded.updated_at`
  )
    .bind(userId, tokens, nowIso())
    .run()
}

async function deductBalance(env: Env, userId: number, tokens: number) {
  if (tokens <= 0) return
  await env.DB.prepare(
    'UPDATE balances SET tokens = MAX(0, tokens - ?), updated_at=? WHERE user_id=?'
  )
    .bind(tokens, nowIso(), userId)
    .run()
}

/** 是否允许生成：免费额度没用完 或 有充值余额 */
async function quotaAllows(env: Env, userId: number): Promise<boolean> {
  if (!(await checkQuota(env, userId))) return true
  return (await getBalance(env, userId)) > 0
}

/** 生成后结算：本月用量超出免费额度的部分，从余额扣 */
async function settleUsage(env: Env, userId: number, freeUsedBefore: number, usedTokens: number) {
  const freeQuota = parseInt(env.FREE_MONTHLY_TOKENS || '200000', 10)
  const over = freeUsedBefore + usedTokens - freeQuota
  if (over > 0) await deductBalance(env, userId, over)
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

// ---------- 卡片质检 v2（按学习科学规则拒收劣质卡）----------
// 依据：原子性/最小信息（SuperMemo 20 条规则）、P1 提取练习、P5 详细反馈、P6 自我解释、P7 变式迁移
const LIST_WORDS = /哪些|哪几种|包括|列举|有哪|以下|下列.*正确的是/
const VAGUE_WORDS = /请简述|谈谈你的|论述|试述|总结一下|你认为/

function normText(s: string) {
  return s.replace(/[\s，。？?！!、；;：:"'（）()【】\[\]]/g, '').toLowerCase()
}
/** 粗查重：二元组 Jaccard（比字符集更适合中文短句，减少误杀） */
function bigrams(s: string): Set<string> {
  const t = normText(s)
  const out = new Set<string>()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  if (!out.size && t) out.add(t)
  return out
}
function similar(a: string, b: string) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

function lintCards(cards: any[], avoid: string[] = []): { ok: any[]; bad: any[] } {
  const ok: any[] = []
  const bad: any[] = []
  const seen: string[] = [...avoid]
  for (const c of cards) {
    const front = String(c?.front ?? '').trim()
    const back = String(c?.back ?? '').trim()
    const explain = String(c?.explanation ?? '').trim()
    const type = c?.type ?? 'basic'
    const reasons: string[] = []

    // 结构性
    if (!front || !back) reasons.push('空题面或空答案')
    if (!explain) reasons.push('缺少解释（P5：必须给"为什么"）')
    if (front === back) reasons.push('题面与答案相同')

    // 原子性 / 最小信息原则
    if (front.length > 60) reasons.push('题面过长（>60 字，应拆卡）')
    if (back.length > 100) reasons.push('答案过长（>100 字，不是原子卡）')
    if (front.split('？').length - 1 > 1 || front.split('?').length - 1 > 1) reasons.push('一题多问')
    if (LIST_WORDS.test(front) && /[、,，]/.test(back)) reasons.push('列举式卡片（应拆成多张单点卡）')
    if (VAGUE_WORDS.test(front)) reasons.push('开放式题面（无法作为提取线索）')

    // 选择题：选项质量
    if (type === 'choice') {
      const ch: string[] = Array.isArray(c?.choices) ? c!.choices.map((x: any) => String(x)) : []
      if (ch.length !== 4) reasons.push('选择题选项数不为 4')
      if (!Number.isInteger(c?.answer_index) || c.answer_index < 0 || c.answer_index > 3) reasons.push('选择题答案下标无效')
      if (new Set(ch.map((x) => normText(x))).size !== ch.length) reasons.push('选择题选项重复')
      if (ch.length) {
        const lens = ch.map((x) => x.length).filter((n) => n > 0)
        if (lens.length === 4 && Math.max(...lens) / Math.max(1, Math.min(...lens)) > 3.5) reasons.push('选择题选项长度悬殊（答案可被猜出）')
      }
    }

    // 查重：与已存在卡片（或本批已通过卡片）过近（二元组 Jaccard ≥ 0.72）
    const dupOf = seen.find((s) => s && similar(s, front) >= 0.72)
    if (dupOf) reasons.push('与已有卡片重复')

    if (reasons.length) bad.push({ ...c, reject: reasons })
    else {
      ok.push(c)
      seen.push(front)
    }
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
    balance_tokens: await getBalance(c.env, userId),
  })
})

// ---------- 充值：卡密兑换（一次一码，额度充值到余额，不随月份清零） ----------
app.post('/billing/redeem', auth, async (c) => {
  const userId = c.get('userId')
  const email = c.get('email')
  const body: any = await c.req.json().catch(() => ({}))
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!code) return err(c, 400, '请输入兑换码')

  const claimed = await c.env.DB.prepare(
    'UPDATE topup_codes SET used_by_email=?, used_at=? WHERE code=? AND used_by_email IS NULL'
  )
    .bind(email, nowIso(), code)
    .run()
  if (!claimed.meta.changes) {
    const exists = await c.env.DB.prepare('SELECT used_by_email FROM topup_codes WHERE code=?')
      .bind(code)
      .first<{ used_by_email: string | null }>()
    if (!exists) return err(c, 404, '兑换码无效')
    return err(c, 403, `该兑换码已被使用${exists.used_by_email === email ? '（你自己用过了）' : ''}`)
  }

  const row = await c.env.DB.prepare('SELECT tier,tokens,price_cny FROM topup_codes WHERE code=?')
    .bind(code)
    .first<{ tier: number; tokens: number; price_cny: number }>()
  await addBalance(c.env, userId, row?.tokens ?? 0)
  return c.json({
    ok: true,
    tier: row?.tier ?? 0,
    price_cny: row?.price_cny ?? 0,
    added_tokens: row?.tokens ?? 0,
    balance_tokens: await getBalance(c.env, userId),
  })
})

// ---------- 生成 ----------
app.post('/gen/outline', auth, async (c) => {
  const userId = c.get('userId')
  if (await globalBudgetExhausted(c.env)) return err(c, 503, '服务本月额度已用完，请下月再来')
  if (await overRate(c.env, userId)) return err(c, 429, '请求太频繁，请稍后再试')
  const freeUsedBefore = await usedThisMonth(c.env, userId)
  if (!(await quotaAllows(c.env, userId))) return err(c, 402, '免费额度已用完，请充值后继续')

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
    const system =
      '你是大学课程教学大纲专家。要求覆盖该课程在标准教材中的全部知识点，不遗漏；' +
      '知识点要写成原子粒度（一个概念/一条定理/一种方法），不要用"概述""简介"这类笼统标题。只输出 JSON。'
    const userPrompt =
      `为大学课程《${title}》生成完整教学大纲，共 ${numChapters} 章，按教学先后顺序排列。` +
      '每章给出 4-8 个知识点（宁细勿粗，覆盖该章全部考点）。' +
      '输出 JSON：{"chapters":[{"title":"章标题","topics":["知识点1","知识点2"]}]}'
    const r = await llmChat(c.env, system, userPrompt)
    content = r.content
    usage = r.usage
  }
  await logUsage(c.env, userId, '/gen/outline', usage)
  await settleUsage(c.env, userId, freeUsedBefore, (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0))
  const data = extractJson(content)
  return c.json({ outline: data.chapters ?? [], provider: c.env.LLM_PROVIDER, usage })
})

app.post('/gen/cards', auth, async (c) => {
  const userId = c.get('userId')
  if (await globalBudgetExhausted(c.env)) return err(c, 503, '服务本月额度已用完，请下月再来')
  if (await overRate(c.env, userId)) return err(c, 429, '请求太频繁，请稍后再试')
  const freeUsedBefore = await usedThisMonth(c.env, userId)
  if (!(await quotaAllows(c.env, userId))) return err(c, 402, '免费额度已用完，请充值后继续')

  const body: any = await c.req.json().catch(() => ({}))
  const topicTitle = String(body.topic_title ?? '').trim()
  if (!topicTitle) return err(c, 400, '缺少知识点标题')
  const n = Math.min(12, Math.max(1, parseInt(body.n ?? 5, 10) || 5))
  const allowed = ['basic', 'why', 'choice']
  const types: string[] = (Array.isArray(body.types) ? body.types : []).filter((t: string) => allowed.includes(t))
  const useTypes = types.length ? types : ['basic']
  const context = typeof body.context === 'string' ? body.context.slice(0, 4000) : ''
  const chapter = typeof body.chapter === 'string' ? body.chapter.slice(0, 120) : ''
  const course = typeof body.course === 'string' ? body.course.slice(0, 120) : ''
  // 已有卡片题面（查重 + 让模型换个角度出题）
  const avoid: string[] = (Array.isArray(body.avoid) ? body.avoid : []).filter((s: any) => typeof s === 'string').slice(0, 40)

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
    // 提示词 v2：按学习科学设计（P1 提取练习 / P5 详细反馈 / P6 自我解释 / P7 变式迁移 + 原子性）
    const system =
      '你是精通学习科学与认知心理学的大学助教，为学生编写"提取练习"卡片。严格遵守：\n' +
      '1) 原子性：每张卡只考一个最小知识点；宁可少出，不许把多个点塞进一张卡。\n' +
      '2) 题面（front）必须是单一、自包含的问句（≤40 字），不能依赖上文、不能出现"下列/以下/上述"。\n' +
      '3) 答案（back）尽量短（≤60 字）；答案长说明这道题该拆成多张卡。\n' +
      '4) 严禁列举式卡（如"有哪些/包括哪些"要求列一串）；应拆成一卡一义。\n' +
      '5) 禁止开放式作文题（"请简述/论述/谈谈"）——那不是提取线索。\n' +
      '6) explanation 必填：说明"为什么"以及"常见错误/易混点"（这是反馈，缺了等于白练）。\n' +
      '7) 类型各有分工：basic=定义/条件/结论本身；why=原理与理由（自我解释）；choice=辨析易混，4 个选项必须是同层次的常见误解，不能有一个明显正确或三个明显荒谬。\n' +
      '8) 数学/计算类知识点要出"做题式"卡（给条件求结果），不要出"背公式"卡。\n' +
      '9) 不出重复卡；若给了"已有卡片"，换角度考同一知识点的另一面。\n' +
      '10) 不出现 emoji、不写客套话。只输出 JSON。'
    const userPrompt =
      (course ? `课程：《${course}》\n` : '') +
      (chapter ? `所在章节：${chapter}\n` : '') +
      `知识点：《${topicTitle}》\n` +
      (context ? `参考材料片段：\n${context}\n` : '') +
      (avoid.length ? `已有卡片（不要重复这些角度）：\n- ${avoid.slice(0, 15).join('\n- ')}\n` : '') +
      `请生成 ${n} 张卡片，类型从 ${useTypes.join('/')} 中选（尽量混合，让用户既考概念也考辨析），choice 卡 4 个选项。\n` +
      '输出 JSON：{"cards":[{"type":"basic|why|choice","front":"单一问句","back":"简短答案","explanation":"为什么+常见错误","choices":["A","B","C","D"],"answer_index":0}]}' +
      '（choices/answer_index 仅 choice 卡需要）'
    const r = await llmChat(c.env, system, userPrompt)
    content = r.content
    usage = r.usage
  }
  await logUsage(c.env, userId, '/gen/cards', usage)
  await settleUsage(c.env, userId, freeUsedBefore, (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0))
  const data = extractJson(content)
  const { ok, bad } = lintCards(Array.isArray(data.cards) ? data.cards : [], avoid)
  return c.json({ cards: ok, rejected: bad, provider: c.env.LLM_PROVIDER, usage })
})

// ---------- 收款下单（网页购买用；无需登录，凭订单号查状态）----------
const TIERS: Record<number, { price: number; tokens: number }> = {
  1: { price: 3.9, tokens: 600_000 },
  2: { price: 9.9, tokens: 1_700_000 },
  3: { price: 19.9, tokens: 3_700_000 },
  4: { price: 39.9, tokens: 7_800_000 },
}

function newOrderNo() {
  const d = new Date()
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const rnd = crypto.getRandomValues(new Uint8Array(6))
  let tail = ''
  for (const b of rnd) tail += alphabet[b % alphabet.length]
  return `ZW${ymd}${tail}`
}

function newTopupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const blk = () => {
    const r = crypto.getRandomValues(new Uint8Array(4))
    let s = ''
    for (const b of r) s += alphabet[b % alphabet.length]
    return s
  }
  return `ZC-${blk()}-${blk()}`
}

app.post('/billing/order', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const tier = parseInt(body.tier ?? '', 10)
  if (!TIERS[tier]) return err(c, 400, '档位无效')
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 120)
  const orderNo = newOrderNo()
  const t = TIERS[tier]
  await c.env.DB.prepare(
    'INSERT INTO orders(order_no,tier,price_cny,tokens,email,status,created_at) VALUES(?,?,?,?,?,?,?)'
  )
    .bind(orderNo, tier, t.price, t.tokens, email || null, 'pending', nowIso())
    .run()
  return c.json({
    order_no: orderNo,
    tier,
    price_cny: t.price,
    tokens: t.tokens,
    status: 'pending',
    pay_remark: orderNo,
    expires_hint: '请在 24 小时内完成转账（备注订单号），确认后自动到账',
  })
})

app.get('/billing/order/:no', async (c) => {
  const no = String(c.req.param('no') || '').trim().toUpperCase()
  const row = await c.env.DB.prepare(
    'SELECT order_no,tier,price_cny,tokens,email,status,code,credited,created_at,paid_at FROM orders WHERE order_no=?'
  )
    .bind(no)
    .first<any>()
  if (!row) return err(c, 404, '订单不存在')
  return c.json(row)
})

// ---------- 管理端（x-admin-token，收款确认）----------
async function requireAdmin(c: any): Promise<boolean> {
  const token = c.req.header('x-admin-token') || ''
  const expected = c.env.ADMIN_TOKEN || ''
  return !!expected && token === expected
}

app.get('/admin/orders', async (c) => {
  if (!(await requireAdmin(c))) return err(c, 401, '管理口令无效')
  const status = c.req.query('status') || 'pending'
  const rows = await c.env.DB.prepare(
    'SELECT order_no,tier,price_cny,tokens,email,status,code,credited,created_at,paid_at FROM orders WHERE status=? ORDER BY created_at DESC LIMIT 100'
  )
    .bind(status)
    .all()
  return c.json({ orders: rows.results ?? [] })
})

app.post('/admin/orders/:no/confirm', async (c) => {
  if (!(await requireAdmin(c))) return err(c, 401, '管理口令无效')
  const no = String(c.req.param('no') || '').trim().toUpperCase()
  const body: any = await c.req.json().catch(() => ({}))
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE order_no=?').bind(no).first<any>()
  if (!row) return err(c, 404, '订单不存在')
  if (row.status === 'paid') return c.json({ ok: true, already: true, code: row.code, credited: !!row.credited })

  // 1) 优先直接充入邮箱对应的账号（用户无需手动兑换）
  let credited = 0
  let code: string | null = null
  if (row.email) {
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(row.email).first<{ id: number }>()
    if (user) {
      await addBalance(c.env, user.id, row.tokens)
      credited = 1
    }
  }
  // 2) 没有账号（或未填邮箱）→ 签发兑换码，用户自己在软件里兑换
  if (!credited) {
    code = newTopupCode()
    await c.env.DB.prepare(
      'INSERT INTO topup_codes(code,tier,price_cny,tokens,note,created_at) VALUES(?,?,?,?,?,?)'
    )
      .bind(code, row.tier, row.price_cny, row.tokens, `订单 ${no}`, nowIso())
      .run()
  }
  await c.env.DB.prepare('UPDATE orders SET status=?, paid_at=?, code=?, credited=?, note=? WHERE order_no=?')
    .bind('paid', nowIso(), code, credited, String(body.note ?? '').slice(0, 200), no)
    .run()
  return c.json({ ok: true, order_no: no, credited: !!credited, code })
})

app.notFound((c) => c.json({ detail: '接口不存在' }, 404))
app.onError((e, c) => c.json({ detail: String(e?.message ?? e) }, 500))

export default app
