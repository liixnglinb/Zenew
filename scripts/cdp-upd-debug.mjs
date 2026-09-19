// 诊断：捕获检查更新时的控制台错误与更新区文案
import fs from 'fs';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let id = 0; const pending = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (m.params.type === 'error' || m.params.type === 'warning') events.push(`[console.${m.params.type}] ${text.slice(0, 300)}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    events.push(`[exception] ${d.text} ${(d.exception?.description || '').slice(0, 300)}`);
  }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');

// 直接从 webview 里 fetch 更新清单，验证网络可达性
const probe = await evalJs(`(async () => {
  try {
    const r = await fetch('https://github.com/liixnglinb/Zenew/releases/latest/download/latest.json', {cache:'no-store'});
    const t = await r.text();
    return 'http=' + r.status + ' len=' + t.length + ' ver=' + (JSON.parse(t).version || '?');
  } catch (e) { return 'ERR: ' + e.message; }
})()`);
console.log('webview 直连清单:', probe);

await evalJs("location.hash='#/settings'");
await sleep(1200);
console.log('点击检查…');
await evalJs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='检查');if(b)b.click();return !!b})()");
await sleep(9000);

console.log('更新区文案:', await evalJs("(()=>{const rows=[...document.querySelectorAll('.settings-row')];const r=rows.find(x=>x.textContent.includes('检查更新'));return r?r.querySelector('.row-meta')?.textContent:'(未找到)'})()"));
console.log('横幅:', await evalJs("(()=>{const b=document.querySelector('.update-banner');return b?b.textContent.replace(/\\s+/g,' ').trim():'(无)'})()"));
console.log('捕获事件:', events.length ? events.slice(-6) : '(无)');
process.exit(0);
