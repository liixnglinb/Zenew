// 真机覆盖度验收：新建课程 → 生成大纲 → 批量补齐 → 覆盖度提升
// 用法: node scripts/cdp-coverage-e2e.mjs [课程名]
// 注意：React 受控 input 必须用 CDP 真实键入（Input.insertText），JS 直接改 value 不会触发 React 状态
const COURSE = process.argv[2] || '离散数学';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pg = list.find((t) => t.type === 'page' && t.url.includes('tauri.localhost'));
if (!pg) { console.error('找不到应用页面'); process.exit(2) }
const ws = new WebSocket(pg.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((r) => pend.set(i, r)) };
ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id) } };
await new Promise((r) => (ws.onopen = r));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeInto(placeholderSub, text) {
  await ev(`(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(placeholderSub)})); if(i){ i.focus(); i.select(); } })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await send('Input.insertText', { text });
  await sleep(600);
}

console.log('1) 新建课程《' + COURSE + '》');
await ev("location.hash = '#/courses'"); await sleep(1800);
await typeInto('课程名', COURSE);
const canGen = await ev(`![...document.querySelectorAll('button')].find(b=>b.innerText.includes('生成大纲')).disabled`);
console.log('   生成按钮可用:', canGen);
await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('生成大纲')).click()`);
let created = false;
for (let i = 0; i < 30; i++) {
  await sleep(3000);
  const t = await ev('document.body.innerText');
  if (t.includes(COURSE) && !t.includes('生成中')) { created = true; break }
  const e = (t.match(/[^\n]*(失败|额度不足|无效|401|402|403|超时)[^\n]*/g) || [])[0];
  if (e) { console.log('   ⚠ 报错:', e); break }
}
console.log('   课程已创建:', created);
if (!created) { ws.close(); process.exit(1) }

console.log('2) 打开课程详情');
await ev(`(() => { const r=[...document.querySelectorAll('.row')].find(x=>x.innerText.includes(${JSON.stringify(COURSE)})); r && r.click(); })()`);
await sleep(3000);
let t = await ev('document.body.innerText');
const cov0 = (t.match(/知识点覆盖 (\d+)%/) || [])[1];
const cards0 = (t.match(/(\d+) 张卡/) || [])[1];
const total = (t.match(/整课生成（(\d+) 个知识点）/) || [])[1];
const targets = (t.match(/补齐未覆盖（(\d+)）/) || [])[1];
console.log(`   知识点 ${total} · 初始覆盖 ${cov0}% · 卡片 ${cards0} · 待补 ${targets}`);

console.log('3) 批量补齐（真实模型，逐个知识点）');
await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('补齐未覆盖')).click()`);
let last = '';
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < 900) {
  await sleep(6000);
  t = await ev('document.body.innerText');
  const prog = (t.match(/正在生成 \d+\/\d+：[^\n]*/) || [''])[0];
  if (prog && prog !== last) { console.log('   ' + prog); last = prog }
  if (t.includes('完成：')) break;
}
t = await ev('document.body.innerText');
const cov1 = (t.match(/知识点覆盖 (\d+)%/) || [])[1];
const cards1 = (t.match(/(\d+) 张卡/) || [])[1];
console.log('4) 结果');
console.log(`   覆盖度 ${cov0}% → ${cov1}%   卡片 ${cards0} → ${cards1}`);
console.log('   提示:', (t.match(/(补齐未覆盖|整课生成)完成：[^\n]*/) || ['（无完成提示）'])[0]);
console.log('   已覆盖标记数:', (t.match(/✓ 已覆盖/g) || []).length);

const fs = await import('fs');
fs.mkdirSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots', { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots/coverage-e2e.png', Buffer.from(shot.data, 'base64'));
console.log('   截图 → C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots/coverage-e2e.png');
ws.close();
