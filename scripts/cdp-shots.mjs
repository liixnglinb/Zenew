// UI 验收截图：遍历五个页面 + 复习两卡，存 D:/Zenew/ui-*.png
import fs from 'fs';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`D:/Zenew/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nav = async (hash, wait = 900) => { await evalJs(`location.hash='${hash}'`); await sleep(wait); };
const click = async (sel) => evalJs(`(()=>{const b=document.querySelector('${sel}');if(b){b.click();return true}return false})()`);

await send('Page.enable');
await nav('#/today'); await shot('ui-today');
await nav('#/courses'); await shot('ui-courses');
await nav('#/courses/1'); await shot('ui-detail');
await nav('#/stats'); await shot('ui-stats');

// 复习流程两张截图（正面 / 已作答）
await nav('#/review');
await sleep(700);
const hasCard = await evalJs(`!!document.querySelector('.review-card')`);
console.log('review card visible:', hasCard);
if (hasCard) {
  await shot('ui-review-front');
  const isChoice = await evalJs(`!!document.querySelector('.choice-btn')`);
  if (isChoice) {
    await click('.choice-btn'); await sleep(500); await shot('ui-review-answered');
    await click('.btn-primary'); await sleep(400);
  } else {
    await click('.btn-primary'); await sleep(500); await shot('ui-review-answered');
    await click('.g-good'); await sleep(400);
  }
  // 第二张的正面（验证进度点）
  const still = await evalJs(`!!document.querySelector('.review-card')`);
  if (still) await shot('ui-review-next');
}
await evalJs(`location.hash='#/today'`);
console.log('DONE');
ws.close();
process.exit(0);
