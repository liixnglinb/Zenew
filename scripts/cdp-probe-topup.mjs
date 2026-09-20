// 探测：当前余额 / 监听状态 / 页面
const BASE = 'http://127.0.0.1:9222'
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const mid = ++id
    const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) { ws.removeEventListener('message', on); resolve(m.result) } }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
await send('Runtime.enable', {}, sessionId)
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)
  return r?.result?.value
}
console.log('hash:', await ev('location.hash'))
console.log('watch:', await ev("localStorage.getItem('zenew_topup_watch')"))
console.log('余额行:', await ev("(document.body.innerText.match(/充值余额[^\\n]*/)||[''])[0]"))
console.log('到账提示:', await ev("(document.body.innerText.match(/充值到账[^\\n]*/)||['(无)'])[0]"))
const tok = await ev("localStorage.getItem('zenew_token')")
const me = await (await fetch('https://zenew-api.lxlrwxs.top/me', { headers: { Authorization: `Bearer ${tok}` } })).json()
console.log('服务端余额:', me.balance_tokens, '/ 账号', me.email)
process.exit(0)
