// 真机更新验证：mode=check 检查更新 / mode=apply 执行更新并等待重启
import fs from 'fs';
const mode = process.argv[2] || 'check';

async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, evalJs };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (send, name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots', { recursive: true });
  fs.writeFileSync(`C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('截图 →', name);
};

let { ws, send, evalJs } = await connect();
await send('Page.enable');
await evalJs("location.hash='#/settings'");
await sleep(1500);

if (mode === 'check') {
  const before = await evalJs("(()=>{const b=document.querySelector('.update-banner');return b?b.textContent.replace(/\\s+/g,' ').trim():'(无横幅)'})()");
  console.log('点击前横幅:', before);
  const clicked = await evalJs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='检查');if(!b)return '未找到按钮';b.click();return '已点击'})()");
  console.log('检查按钮:', clicked);
  await sleep(6000);
  const after = await evalJs("(()=>{const b=document.querySelector('.update-banner');return b?b.textContent.replace(/\\s+/g,' ').trim():'(无横幅)'})()");
  console.log('点击后横幅:', after);
  console.log('版本标签:', await evalJs("(document.querySelector('.tag-mono')||{}).textContent"));
  await shot(send, 'upd-available');
  process.exit(0);
}

if (mode === 'apply') {
  const clicked = await evalJs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即更新'));if(!b)return '未找到按钮';b.click();return '已点击'})()");
  console.log('立即更新:', clicked);
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const txt = await evalJs("(()=>{const b=document.querySelector('.update-banner');return b?b.textContent.replace(/\\s+/g,' ').trim():'(无)'})()");
    console.log(`t+${(i + 1) * 5}s:`, txt);
    if (i === 1) await shot(send, 'upd-progress');
    if (!txt || txt === '(无)' || /新版本/.test(txt || '')) {
      // 重启或回退：等待新进程
      break;
    }
  }
  console.log('等待应用重启…');
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    try {
      const c = await connect();
      const hash = await c.evalJs('location.hash');
      const rootLen = await c.evalJs('document.getElementById("root").innerHTML.length');
      if (hash && rootLen > 100) {
        await c.evalJs("location.hash='#/settings'");
        await sleep(2500);
        const ver = await c.evalJs("(document.querySelector('.tag-mono')||{}).textContent");
        console.log('重启后 hash:', hash, '| 版本标签:', ver);
        await shot(c.send, 'upd-after');
        process.exit(0);
      }
    } catch (e) { /* 重启中，继续等 */ }
  }
  console.log('超时：未观察到重启后的页面');
  process.exit(1);
}
