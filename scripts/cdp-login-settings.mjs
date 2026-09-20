import fs from 'fs';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable');

// 注册或登录取得 token，写入 localStorage
const token = await evalJs(`(async () => {
  const body = JSON.stringify({email:'installed@zenew.app', password:'zenew-test-2026'});
  const h = {'Content-Type':'application/json'};
  let r = await fetch('http://127.0.0.1:8765/auth/register', {method:'POST', headers:h, body});
  if (!r.ok) r = await fetch('http://127.0.0.1:8765/auth/login', {method:'POST', headers:h, body});
  const j = await r.json();
  if (j.token) { localStorage.setItem('zenew_token', j.token); return j.token ? 'ok' : 'no'; }
  return 'fail:' + JSON.stringify(j).slice(0,120);
})()`);
console.log('登录:', token);
await evalJs("location.reload()");
await sleep(3000);
await evalJs("location.hash='#/settings'");
await sleep(3000);
console.log('版本标签:', await evalJs("(document.querySelector('.tag-mono')||{}).textContent"));
console.log('更新区:', await evalJs("(()=>{const rows=[...document.querySelectorAll('.settings-row')];const r=rows.find(x=>x.textContent.includes('检查更新'));return r?r.textContent.replace(/\s+/g,' ').trim():'(未找到)'})()"));
console.log('横幅:', await evalJs("(()=>{const b=document.querySelector('.update-banner');return b?b.textContent.replace(/\s+/g,' ').trim():'(无)'})()"));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots', { recursive: true });
fs.writeFileSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots/upd-before.png', Buffer.from(shot.result.data, 'base64'));
console.log('已截图 docs/screenshots/upd-before.png');
process.exit(0);
