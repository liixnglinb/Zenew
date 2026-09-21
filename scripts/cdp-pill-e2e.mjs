// 更新胶囊 E2E：启动静默检查（走 CDN）→ idle 显示版本号 · 最新（不出现「重试」）
const BASE = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? '✓' : '✓'.replace('✓','✓')} ${name}${extra ? ' — ' + extra : ''}`).valueOf ? void 0 : void 0 }

// 简化输出函数
const chk = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`) }

await sleep(9000) // 等启动静默检查（CDN 端点）
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri|localhost/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

const pill = await evalJs(`document.querySelector('.update-pill')?.textContent?.trim() || ''`)
chk('更新胶囊显示版本号+最新', /^v0\.13\.1 · 最新$/.test(pill), pill)
const retryGone = await evalJs(`document.body.innerText.trim().split('\\n').filter(x => x === '重试').length === 0`)
chk('标题栏无「重试」', retryGone)
// 悬停确认 title
const title = await evalJs(`document.querySelector('.update-pill')?.title || ''`)
chk('悬停提示含当前版本', title.includes('v0.13.1'), title)

console.log(`\\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
