// 模块八：性能测量（真机 CDP）。产物：可复现的耗时/内存数字
// 前置：9222 端口的 tauri dev
import { fileURLToPath } from 'url'

const l = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const p = l.find((t) => t.type === 'page')
const ws = new WebSocket(p.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const q = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && q.has(m.id)) { q.get(m.id)(m); q.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; q.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const go = async (hash, wait = 1800) => { await ev(`location.hash='${hash}'`); await sleep(wait) }
await send('Runtime.enable')

const PAGES = ['/today', '/vocab', '/dict', '/stats', '/tasks', '/rank', '/settings']
const out = {}

// 1) 页面加载：Navigation Timing（/today 为首屏）
await go('/today')
out.firstScreen = await ev(`(()=>{const n=performance.getEntriesByType('navigation')[0];
  return {domContentLoaded: Math.round(n.domContentLoadedEventEnd), loadEvent: Math.round(n.loadEventEnd), transferSize: n.transferSize}})()`)

// 2) 词库检索核心：fetch + parse + 全量扫描过滤（查词页的算法本质）
out.dict = await ev(`(async()=>{
  const t0=performance.now();
  const r=await fetch('/dict/index.json');
  const text=await r.text();
  const t1=performance.now();
  const j=JSON.parse(text);
  const t2=performance.now();
  // 查词核心：与 Dict 页同构的全量线性过滤（前缀/包含/中文释义）
  const kw='ab';
  const hits=j.filter(it=>it.w.toLowerCase().startsWith(kw)||it.w.toLowerCase().includes(kw));
  const t3=performance.now();
  return {fetchMs:Math.round(t1-t0), parseMs:Math.round(t2-t1), scanMs:+(t3-t2).toFixed(1), entries:j.length, hits:hits.length};
})()`)
// 重复取（验证 HTTP 缓存/同源复用后的稳态）
out.dictWarm = await ev(`(async()=>{const t=performance.now();const r=await fetch('/dict/index.json');await r.json();return Math.round(performance.now()-t)})()`)

// 3) 内存稳定性：两轮全页面遍历，比 heap
const heap = () => ev(`performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1`)
const pass = async () => { for (const pg of PAGES) await go(pg, 1200) }
await pass()
out.heapAfterPass1 = await heap()
await pass()
out.heapAfterPass2 = await heap()
out.heapDeltaMB = (out.heapAfterPass2 - out.heapAfterPass1)

console.log(JSON.stringify(out, null, 1))
const bad = []
if (out.dict.scanMs > 50) bad.push('检索扫描 >50ms')
if (out.heapDeltaMB > 15) bad.push(`两轮遍历 heap 涨 ${out.heapDeltaMB}MB（疑似泄漏）`)
if (out.firstScreen.loadEvent > 3000) bad.push('首屏 load >3s')
console.log(bad.length ? '✗ ' + bad.join('；') : '✓ 性能指标在阈值内')
ws.close()
process.exit(bad.length ? 1 : 0)
