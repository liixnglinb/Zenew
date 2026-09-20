// 真机充值验收：设置页兑换卡密 → 余额到账 → 统计页显示
import fs from 'fs';
const CODE = process.argv[2] || ''
if (!CODE) { console.error('用法: node scripts/cdp-redeem-e2e.mjs ZC-XXXX-XXXX'); process.exit(2) }

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/screenshots/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('  截图 →', name);
};

await send('Page.enable');
if (await ev("document.body.innerText.includes('SIGN IN')")) {
  console.log('未登录，先注册测试账号（需要邀请码，这里用已有账号跳过）')
}
await ev("location.hash='#/settings'");
await sleep(3000);
console.log('1) 版本:', await ev("(document.querySelector('.tag-mono')||{}).textContent"));
console.log('   兑换前余额行:', await ev("(()=>{const r=[...document.querySelectorAll('.settings-row')].find(x=>x.textContent.includes('充值余额'));return r?r.textContent.replace(/\\s+/g,' ').trim():'(未找到)'})()"));

// 填卡密
await ev(`(() => {
  const el = [...document.querySelectorAll('.settings-row input')].find(i => (i.placeholder||'').includes('ZC-'));
  if (!el) return 'no-input';
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, ${JSON.stringify(CODE)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`);
await sleep(400);
console.log('2) 已填卡密');
await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='兑换');if(b)b.click();return !!b})()");
await sleep(5000);
console.log('3) 兑换结果:', await ev("(()=>{const r=[...document.querySelectorAll('.settings-row')].find(x=>x.textContent.includes('兑换充值码'));return r?r.textContent.replace(/\\s+/g,' ').trim():''})()"));
console.log('   余额行:', await ev("(()=>{const r=[...document.querySelectorAll('.settings-row')].find(x=>x.textContent.includes('充值余额'));return r?r.textContent.replace(/\\s+/g,' ').trim():'(未找到)'})()"));
await shot('topup-settings')

// 重复兑换同一张卡 → 应报错
await ev(`(() => {
  const el = [...document.querySelectorAll('.settings-row input')].find(i => (i.placeholder||'').includes('ZC-'));
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, ${JSON.stringify(CODE)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(300);
await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/兑换|已到账/.test(x.textContent));if(b)b.click();return !!b})()");
await sleep(4000);
console.log('4) 重复兑换提示:', await ev("(()=>{const r=[...document.querySelectorAll('.settings-row')].find(x=>x.textContent.includes('兑换充值码'));return r?r.textContent.replace(/\\s+/g,' ').trim():''})()"));

// 统计页余额
await ev("location.hash='#/stats'");
await sleep(3000);
console.log('5) 统计页:', await ev("(()=>{const el=[...document.querySelectorAll('.muted,.stat-value')].map(e=>e.textContent.trim()).filter(t=>/万|余额|token/.test(t));return el.join(' | ')})()"));
await shot('topup-stats')
process.exit(0);
