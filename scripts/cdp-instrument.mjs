// 插桩版复习循环：每步记录检测到的相位与点击结果，定位卡点
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

await sleep(600)
await send('Runtime.evaluate', { expression: `location.hash = '#/today'` })
await sleep(900)
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b=>/开始学习/.test(b.textContent))?.click()` })
await sleep(1400)

for (let step = 0; step < 20; step++) {
  const info = await ev(`(() => {
    const tag = document.querySelector('.tag')?.textContent || '-'
    if (/本次学习完成|没有待学习的卡片/.test(document.body.innerText)) return { tag, phase: 'DONE' }
    const fresh = [...document.querySelectorAll('.choice-btn')].filter(b => !b.classList.contains('right') && !b.classList.contains('wrong'))
    if (fresh.length) return { tag, phase: 'CHOICE', n: fresh.length }
    if (document.querySelector('.grade-row')) return { tag, phase: 'GRADE' }
    if ([...document.querySelectorAll('button')].some(b=>/先回忆/.test(b.textContent))) return { tag, phase: 'REVEAL' }
    if ([...document.querySelectorAll('button')].find(b=>/下一张|完成/.test(b.textContent))) return { tag, phase: 'NEXT' }
    return { tag, phase: 'UNKNOWN', body: document.body.innerText.slice(0,100) }
  })()`)
  console.log(`step${step}:`, JSON.stringify(info))
  if (info.phase === 'DONE') break
  if (info.phase === 'CHOICE') {
    await ev(`(() => { const f=[...document.querySelectorAll('.choice-btn')].filter(b=>!b.classList.contains('right')&&!b.classList.contains('wrong')); f[${step % 2 === 0 ? 'f.length-1' : '0'}]?.click() })()`)
  } else if (info.phase === 'REVEAL') {
    await ev(`[...document.querySelectorAll('button')].find(b=>/先回忆/.test(b.textContent))?.click()`)
  } else if (info.phase === 'GRADE') {
    const r = await ev(`(() => { const b=[...document.querySelectorAll('.grade-row button')][3]; b?.click(); return b ? 'clicked:'+b.textContent.slice(0,4) : 'NO-GRADE-BTN' })()`)
    if (step > 8) console.log('  grade:', r)
  } else if (info.phase === 'NEXT') {
    const r = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/下一张|完成/.test(b.textContent)); b?.click(); return b?'clicked':'NO-BTN' })()`)
    console.log('  next:', r)
  } else {
    console.log('  卡在:', info.body)
    break
  }
  await sleep(650)
}
console.log('--- 最终 ---')
console.log(await ev(`document.querySelector('.main-inner')?.innerText.slice(0,150).replace(/\\n/g,' | ')`))
process.exit(0)
