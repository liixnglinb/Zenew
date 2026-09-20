// 充值到账识别 E2E：真下单 → 真管理确认 → 断言软件自动提示到账
// 流程：读软件内 token → 用该账号下单 → 点「去购买」开始监听 → 管理端确认 → 等软件自动提示
import { readFileSync } from 'fs'

const BASE = 'http://127.0.0.1:9222'
const API = 'https://zenew-api.lxlrwxs.top'
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ADMIN = readFileSync(`${ROOT}/.secrets/admin_token.txt`, 'utf8').trim()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => results.push(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`)

// ---- CDP ----
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri/.test(t.url))
if (!page) { console.log('未找到 Tauri 页面'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const mid = ++id
    const on = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === mid) { ws.removeEventListener('message', on); resolve(m.result) }
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
await send('Runtime.enable', {}, sessionId)
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  return r?.exceptionDetails ? 'EX: ' + r.exceptionDetails.text : r?.result?.value
}

await evalJs(`location.hash='#/settings'`)
await sleep(2000)

// 1) 取软件内登录态
const token = await evalJs(`localStorage.getItem('zenew_token')`)
check('读取到软件登录态', !!token)
const meBefore = await (await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
const email = meBefore.email
const balBefore = meBefore.balance_tokens || 0
console.log(`账号 ${email} · 当前余额 ${balBefore} tokens`)

// 2) 下单（1 档 ¥3.9 / 60 万）
const created = await (await fetch(`${API}/billing/order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tier: 1, email }),
})).json()
const orderNo = created.order_no
check('创建订单', !!orderNo, `${orderNo} · ¥${created.price_cny} / ${created.tokens} tokens`)

// 3) 点「去购买」启动监听（会打开浏览器，属于正常流程）
const buyClicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '去购买')
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await sleep(2500)
const watchBanner = await evalJs(`document.body.innerText.includes('等待付款确认')`)
check('点击去购买后进入「等待付款确认」', buyClicked === 'clicked' && watchBanner, `点击=${buyClicked} 横幅=${watchBanner}`)
const watchState = await evalJs(`localStorage.getItem('zenew_topup_watch')`)
check('本地已存监听状态（含基线余额）', !!watchState && watchState.includes('baseline_balance'), watchState ? 'ok' : '无')

// 4) 模拟「用户已付款，站长核对确认」
const conf = await (await fetch(`${API}/admin/orders/${orderNo}/confirm`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN },
  body: JSON.stringify({ note: 'E2E 自动确认' }),
})).json()
check('管理端确认收款并自动充值', conf.ok === true && conf.credited === true, JSON.stringify(conf))

// 5) 模拟购买页：订单已支付 → 触发 zenew:// 深链把软件唤到前台
import { execSync } from 'child_process'
const deepLink = `zenew://paid?order=${orderNo}`
try {
  execSync(`cmd /c start "" "${deepLink}"`, { windowsHide: true })
} catch (e) {
  console.log('深链触发异常:', String(e).slice(0, 120))
}

// 6) 等软件自动识别（深链应即时触发；轮询 8s 兜底）
let banner = ''
for (let i = 0; i < 8; i++) {
  await sleep(2000)
  banner = await evalJs(`(() => {
    const t = document.body.innerText
    const m = t.match(/充值到账[^\\n]*/)
    return m ? m[0] : ''
  })()`)
  if (banner) break
}
check('软件自动提示「充值到账」', !!banner, banner || '未出现')

// 7) 余额与余额条同步
const meAfter = await (await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
const added = (meAfter.balance_tokens || 0) - balBefore
check('服务端余额已增加', added === created.tokens, `+${added} tokens`)
await sleep(1500)
const uiBalance = await evalJs(`(() => {
  const t = document.body.innerText
  const m = t.match(/充值余额\\s*([\\d,]+)/)
  return m ? m[1] : ''
})()`)
check('软件余额显示已刷新', Number(String(uiBalance).replace(/,/g, '')) === (meAfter.balance_tokens || 0), `界面显示 ${uiBalance}`)

const watchCleared = await evalJs(`localStorage.getItem('zenew_topup_watch') === null`)
check('到账后监听状态自动清除', watchCleared === true)

console.log('\n' + results.join('\n'))
const fails = results.filter((r) => r.startsWith('✗')).length
console.log(`\n结果：${results.length - fails} 通过 / ${fails} 失败`)
console.log(`（测试订单 ${orderNo} 已真实充值 ${created.tokens} tokens 到 ${email}）`)
process.exit(fails ? 1 : 0)
