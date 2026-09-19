// 真机导入 PDF 验收：点导入框 → Tauri 文件对话框没法远程驱动 → 直接把 File 对象注入流水线
// 做法：读取 PDF 为 base64，在页面里构造 File，调用 startImport 等价逻辑（直接 import pdf 模块跑 runImportPipeline）
import fs from 'fs'
const PDF = 'D:/Zenew/docs/test-textbook.pdf'
const b64 = fs.readFileSync(PDF).toString('base64')

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const pg = list.find((t) => t.type === 'page' && t.url.includes('tauri.localhost'))
if (!pg) { console.error('应用未启动'); process.exit(2) }
const ws = new WebSocket(pg.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((r) => pend.set(i, r)) }
ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id) } }
await new Promise((r) => (ws.onopen = r))
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('1) 进入课程页')
await ev("location.hash='#/courses'"); await sleep(2000)

console.log('2) 注入 PDF File 并启动流水线')
// 通过动态 import 拿到模块（Vite 下 /src/pdf.ts 已打包进 app；用页面内 fetch 不可行 → 直接调 startImport 不行，它是组件内部函数。
// 方案：直接 import('/src/pdf.ts') 在 dev 下可行；生产打包后路径不同。用兜底：把 b64 交给页面内 fetch data: URL 构造 File，再模拟点击选择文件不可行 →
// 改用：页面里 dispatch change 事件到隐藏 input。
const injected = await ev(`(async () => {
  const b64 = "${b64}"
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const file = new File([arr], 'test-textbook.pdf', { type: 'application/pdf' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('input[type=file]')
  if (!input) return 'no-input'
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`)
console.log('   注入结果:', injected)

console.log('3) 观察流水线进度（每 8 秒采样）')
let last = ''
for (let i = 0; i < 40; i++) {
  await sleep(8000)
  const t = await ev('document.body.innerText')
  const prog = (t.match(/(读取 PDF|解析中|提取知识点|自动建卡)\n?[^\n]*/) || [''])[0].replace(/\n/g, ' ')
  const stats = (t.match(/章节 \d+\n知识点 \d+\n卡片 \d+/) || [''])[0].replace(/\n/g, ' · ')
  const line = (prog + ' | ' + stats).trim()
  if (line && line !== last) { console.log('   ' + line); last = line }
  if (t.includes('完成：') && t.includes('章 ·')) { console.log('   ✓', (t.match(/完成：[^\n]+/) || [''])[0]); break }
}

console.log('4) 课程列表应有《test-textbook》')
const has = await ev(`document.body.innerText.includes('test-textbook')`)
console.log('   课程出现:', has)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.mkdirSync('D:/Zenew/docs/screenshots', { recursive: true })
fs.writeFileSync('D:/Zenew/docs/screenshots/pdf-import.png', Buffer.from(shot.data, 'base64'))
console.log('截图 → pdf-import.png')
ws.close()
