// 线上网关冒烟测试：node scripts/smoke-gateway.mjs <baseUrl>
// 覆盖：health / courses / 注册 / 登录 / me / 大纲 / 卡片（含中文 UTF-8）/ 额度计量 / 鉴权拒绝 / 限流字段
const base = (process.argv[2] || '').replace(/\/$/, '')
if (!base) { console.error('用法: node scripts/smoke-gateway.mjs https://zenew-api.example.com'); process.exit(2) }

const email = `smoke_${Date.now()}@zenew.test`
const password = 'zenew-smoke-2026'
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}
const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await r.json() } catch { /* 非 JSON */ }
  return { status: r.status, json }
}

console.log(`网关冒烟测试 → ${base}\n`)

// 1. health
const health = await call('/health')
ok('GET /health 200', health.status === 200, `provider=${health.json?.provider}`)

// 2. courses
const courses = await call('/courses')
ok('GET /courses 返回课程目录', courses.status === 200 && Array.isArray(courses.json?.courses), `${courses.json?.courses?.length ?? 0} 门课`)

// 3. 注册（中文无关，但验证 UTF-8 与密码哈希链路）
const reg = await call('/auth/register', { method: 'POST', body: { email, password } })
ok('POST /auth/register 注册成功', reg.status === 200 && !!reg.json?.token, reg.json?.detail || '')

// 4. 重复注册应被拒
const dup = await call('/auth/register', { method: 'POST', body: { email, password } })
ok('重复注册被拒（400）', dup.status === 400, dup.json?.detail || '')

// 5. 登录
const login = await call('/auth/login', { method: 'POST', body: { email, password } })
ok('POST /auth/login 登录成功', login.status === 200 && !!login.json?.token)
const token = login.json?.token

// 6. 错密码应被拒
const bad = await call('/auth/login', { method: 'POST', body: { email, password: 'wrong-password-123' } })
ok('错密码被拒（401）', bad.status === 401)

// 7. 无 token 访问 /me 应被拒
const noAuth = await call('/me')
ok('无 token 访问 /me 被拒（401）', noAuth.status === 401)

// 8. /me 额度
const me = await call('/me', { token })
ok('GET /me 返回额度', me.status === 200 && typeof me.json?.quota_tokens === 'number', `used=${me.json?.used_tokens} quota=${me.json?.quota_tokens}`)

// 9. 大纲生成 + 中文 UTF-8 往返（真实模型章数可能不完全等于请求值，只校验非空）
const outline = await call('/gen/outline', { method: 'POST', token, body: { title: '数据结构', num_chapters: 3 } })
const outlineOk = outline.status === 200 && (outline.json?.outline?.length ?? 0) >= 1
ok('POST /gen/outline 生成大纲', outlineOk, `provider=${outline.json?.provider} 章节=${outline.json?.outline?.length}`)
if (outlineOk) {
  const title = outline.json.outline[0].title || ''
  ok('中文 UTF-8 往返正确', /[\u4e00-\u9fa5]/.test(title), title)
}

// 10. 卡片生成 + 质检门
const cards = await call('/gen/cards', { method: 'POST', token, body: { topic_title: '二叉树的遍历', n: 5 } })
ok('POST /gen/cards 生成卡片', cards.status === 200 && Array.isArray(cards.json?.cards), `通过 ${cards.json?.cards?.length ?? 0} / 拒收 ${cards.json?.rejected?.length ?? 0}`)
if (cards.json?.cards?.length) {
  const c = cards.json.cards[0]
  ok('卡片结构完整（front/back/explanation）', !!(c.front && c.back && c.explanation))
  ok('中文 UTF-8 往返正确（卡片）', /[\u4e00-\u9fa5]/.test(c.front), c.front?.slice(0, 40))
}

// 11. 额度已计量
const me2 = await call('/me', { token })
ok('额度已计量（used > 0）', (me2.json?.used_tokens ?? 0) > 0, `used=${me2.json?.used_tokens}`)

// 12. CORS 预检（打包版源）
const pre = await fetch(base + '/gen/cards', {
  method: 'OPTIONS',
  headers: { Origin: 'http://tauri.localhost', 'Access-Control-Request-Method': 'POST' },
})
ok('CORS 放行打包版源 tauri.localhost', pre.headers.get('access-control-allow-origin') === 'http://tauri.localhost', pre.headers.get('access-control-allow-origin') || '(无头)')

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
