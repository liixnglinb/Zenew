// Zenew M1 最终验收：修正状态检测优先级（已作答 > 待作答）
const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = tabs.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const d = JSON.parse(ev.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id) }
})
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (p) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(p, Buffer.from(r.data, 'base64'))
}

await sleep(500)
await send('Runtime.evaluate', { expression: `location.hash = '#/today'` })
await sleep(900)
const today = await ev(`document.querySelector('.main-inner')?.innerText.slice(0,110).replace(/\\n/g,' | ')`)
console.log('[final] 今日页:', today)
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b=>/开始学习/.test(b.textContent))?.click()` })
await sleep(1400)

let steps = 0
for (let step = 0; step < 50; step++) {
  const phase = await ev(`(() => {
    if (/本次学习完成|没有待学习的卡片/.test(document.body.innerText)) return 'DONE'
    if (document.querySelector('.grade-row')) return 'GRADE'
    if ([...document.querySelectorAll('button')].some(b=>/先回忆/.test(b.textContent))) return 'REVEAL'
    if (document.querySelector('.choice-btn.right, .choice-btn.wrong')) return 'NEXT'
    const fresh = [...document.querySelectorAll('.choice-btn')].filter(b => !b.classList.contains('right') && !b.classList.contains('wrong'))
    if (fresh.length) return 'CHOICE'
    return 'UNKNOWN'
  })()`)
  if (phase === 'DONE') break
  if (phase === 'GRADE') {
    await ev(`[...document.querySelectorAll('.grade-row button')][${step % 2 === 0 ? 3 : 0}]?.click()`)
  } else if (phase === 'REVEAL') {
    await ev(`[...document.querySelectorAll('button')].find(b=>/先回忆/.test(b.textContent))?.click()`)
  } else if (phase === 'NEXT') {
    await ev(`[...document.querySelectorAll('button')].find(b=>/下一张|完成/.test(b.textContent))?.click()`)
  } else if (phase === 'CHOICE') {
    await ev(`(() => { const f=[...document.querySelectorAll('.choice-btn')].filter(b=>!b.classList.contains('right')&&!b.classList.contains('wrong')); f[${step % 2 === 0 ? 'f.length-1' : '0'}]?.click() })()`)
  } else {
    console.log('[final] UNKNOWN，中止')
    break
  }
  steps++
  await sleep(600)
}
await sleep(700)
console.log(`[final] 互动 ${steps} 步 → 结束页:`, (await ev(`document.querySelector('.main-inner')?.innerText.slice(0,200).replace(/\\n/g,' | ')`)))
await shot('C:/Users/李星历/Desktop/课程学习软件/Zenew/e2e-done.png')

await send('Runtime.evaluate', { expression: `location.hash = '#/stats'` })
await sleep(1100)
console.log('[final] 统计页:', (await ev(`document.querySelector('.main-inner')?.innerText.slice(0,260).replace(/\\n/g,' | ')`)))
await shot('C:/Users/李星历/Desktop/课程学习软件/Zenew/e2e-stats.png')
console.log('[final] 截图: C:/Users/李星历/Desktop/课程学习软件/Zenew/e2e-done.png, C:/Users/李星历/Desktop/课程学习软件/Zenew/e2e-stats.png')
process.exit(0)
