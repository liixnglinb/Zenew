// 诊断「去购买」：捕获点击时的异常与提示文案
const BASE = 'http://127.0.0.1:9222'
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push('[console] ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Log.entryAdded') {
    logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text}`)
  }
})
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
await send('Log.enable', {}, sessionId)
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  return r?.exceptionDetails ? 'EX: ' + r.exceptionDetails.text : r?.result?.value
}

await evalJs(`location.hash='#/settings'`)
await new Promise((r) => setTimeout(r, 1800))

// 直接调用插件验证权限
const direct = await evalJs(`(async () => {
  try {
    const m = await import('@tauri-apps/plugin-opener')
    await m.openUrl('https://lxlrwxs.top/zenew/buy/')
    return 'opened-ok'
  } catch (e) {
    return 'ERR: ' + (e?.message || String(e))
  }
})()`)
console.log('直接调用 openUrl:', direct)

// 点击页面按钮
const clicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '去购买')
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await new Promise((r) => setTimeout(r, 2500))
const msg = await evalJs(`(() => {
  const t = document.body.innerText
  const m = t.match(/打开浏览器失败[^\\n]*/)
  return m ? m[0] : '(无错误提示)'
})()`)
console.log('按钮点击:', clicked)
console.log('页面提示:', msg)
console.log('捕获日志:', logs.slice(-8).join('\n') || '(无)')
process.exit(0)
