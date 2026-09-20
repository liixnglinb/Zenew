// 真机端到端 v2：登录页 → 服务设置改线上网关 → 注册 → 课程 → 生成
import fs from 'fs';
const LIVE = 'https://zenew-api.lxlrwxs.top';
const email = `live_${Date.now()}@zenew.test`;
const password = 'zenew-live-2026';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fill = (sel, value) => evalJs(`(() => {
  const input = document.querySelector(${JSON.stringify(sel)});
  if (!input) return 'no-input:' + ${JSON.stringify(sel)};
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`);
const clickText = (text, sel = 'button') => evalJs(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'not-found:' + ${JSON.stringify(text)};
  b.click(); return 'clicked';
})()`);
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots', { recursive: true });
  fs.writeFileSync(`C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots/${name}.png`, Buffer.from(s.result.data, 'base64'));
};
const txt = (n = 90) => evalJs(`document.body.innerText.replace(/\\s+/g,' ').slice(0,${n})`);

await send('Page.enable');
console.log('起始页面:', await txt(70));

// 1) 登录页 → 服务设置 → 填线上网关
console.log('\n1) 打开服务设置')
console.log('   ', await clickText('服务设置'))
await sleep(600)
console.log('   服务输入框:', await fill('.auth-box .input:nth-of-type(1)', LIVE) === LIVE ? '已填' : '定位失败')
// 输入框在 auth-alt 之后，改用更稳的选择器：最后一个 input
const filled = await evalJs(`(() => {
  const inputs = [...document.querySelectorAll('.auth-box input')];
  const serverInput = inputs[inputs.length - 1];
  if (!serverInput) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(serverInput, ${JSON.stringify(LIVE)});
  serverInput.dispatchEvent(new Event('input', { bubbles: true }));
  return serverInput.value;
})()`)
console.log('   服务地址设为:', filled)

// 2) 切注册模式 + 填账号
console.log('\n2) 注册账号')
console.log('   ', await clickText('注册', '.auth-alt button'))
await sleep(500)
await fill('.auth-box input[placeholder="邮箱"]', email)
await evalJs(`(() => {
  const pw = document.querySelector('.auth-box input[type=password]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(pw, ${JSON.stringify(password)});
  pw.dispatchEvent(new Event('input', { bubbles: true }));
  return pw.value ? 'ok' : 'fail';
})()`)
await sleep(300)
console.log('   ', await clickText('注册并登录'))
await sleep(6000)
console.log('   结果:', await txt(80))

// 3) 课程页生成大纲（真实线上调用）
console.log('\n3) 课程页生成大纲')
await evalJs("location.hash='#/courses'")
await sleep(2500)
const before = await evalJs("document.querySelectorAll('.row').length")
console.log('   生成前课程数:', before)
await fill('.input[placeholder*="课程名"]', '计算机网络')
await sleep(300)
console.log('   ', await clickText('生成大纲'))
await sleep(12000)
console.log('   生成后课程数:', await evalJs("document.querySelectorAll('.row').length"))
console.log('   列表末行:', await evalJs("[...document.querySelectorAll('.row')].slice(-1).map(r=>r.textContent.replace(/\\s+/g,' ').slice(0,50)).join('')"))
await shot('live-courses')

// 4) 详情页生成卡片
console.log('\n4) 课程详情生成卡片')
await evalJs(`(() => { const r=[...document.querySelectorAll('.row')].find(x=>x.textContent.includes('计算机网络')); if(r) r.click(); return !!r })()`)
await sleep(3500)
console.log('   章节数:', await evalJs("document.querySelectorAll('.section-label').length"))
console.log('   ', await clickText('生成'))
await sleep(12000)
console.log('   生成提示:', await evalJs("(()=>{const t=document.querySelector('.tag-ok');return t?t.textContent.replace(/\\s+/g,' '):'(无)'})()"))
await shot('live-cards')

// 5) 统计页额度
console.log('\n5) 统计页额度')
await evalJs("location.hash='#/stats'")
await sleep(3000)
console.log('   额度行:', await evalJs("[...document.querySelectorAll('.muted')].map(e=>e.textContent.trim()).filter(t=>t.includes('/')).join(' ') || '(空)'"))
await shot('live-stats')
process.exit(0);
