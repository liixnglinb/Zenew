// 真实内容端到端：客户端 → 线上网关(openai) → 生成真实卡片 → 进复习
// 用法：node scripts/cdp-real-e2e.mjs ZENEW-XXXX-XXXX
import fs from 'fs';
const INVITE = process.argv[2] || ''
if (!INVITE) { console.error('需要邀请码参数：node scripts/cdp-real-e2e.mjs ZENEW-XXXX-XXXX'); process.exit(2) }
const email = `real_${Date.now()}@zenew.test`;
const password = 'zenew-real-2026';

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
  fs.mkdirSync('D:/Zenew/docs/screenshots', { recursive: true });
  fs.writeFileSync(`D:/Zenew/docs/screenshots/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('  截图 →', name);
};
const fillReact = (sel, value) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value ? 'ok' : 'fail';
})()`);
const clickText = (t, sel = 'button') => ev(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(t)})); if(!b) return 'not-found'; b.click(); return 'clicked'; })()`);

await send('Page.enable');
// 先清掉旧登录态，回到登录页，模拟新用户首次使用
await ev("localStorage.removeItem('zenew_token'); location.reload()")
await sleep(4000)
console.log('起始:', await ev("document.body.innerText.replace(/\\s+/g,' ').slice(0,50)"));

// 若在登录页 → 注册
if (await ev("document.body.innerText.includes('SIGN IN') || document.body.innerText.includes('REGISTER')")) {
  console.log('1) 注册新账号')
  await clickText('注册', '.auth-alt button'); await sleep(600);
  await fillReact('.auth-box input[placeholder="邮箱"]', email);
  await ev(`(() => { const pw=document.querySelector('.auth-box input[type=password]'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(pw, ${JSON.stringify(password)}); pw.dispatchEvent(new Event('input',{bubbles:true})); return 'ok' })()`);
  await sleep(400)
  // 邀请码输入框（注册模式才出现）
  console.log('   填邀请码:', await fillReact('.auth-box input[placeholder*="邀请码"]', INVITE))
  await sleep(300); await clickText('注册并登录'); await sleep(6000);
  console.log('   ', await ev("document.body.innerText.replace(/\\s+/g,' ').slice(0,60)"));
}

// 课程页 → 高等数学（上） → 找一个知识点生成真实卡片
console.log('2) 进入课程生成真实卡片')
await ev("location.hash='#/courses'"); await sleep(2200);
await ev(`(() => { const r=[...document.querySelectorAll('.row')].find(x=>x.textContent.includes('高等数学')); if(r) r.click(); return !!r })()`);
await sleep(3000);
console.log('   课程:', await ev("document.querySelector('.page-title')?.textContent"), '| 章节数:', await ev("document.querySelectorAll('.section-label').length"))
// 点第一个「生成」按钮（若已有卡片则点「+5」）
const genLabel = await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/生成|\\+5/.test(x.textContent));return b?b.textContent.trim():'(无按钮)'})()")
console.log('   按钮:', genLabel)
await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/生成|\\+5/.test(x.textContent));if(b)b.click();return !!b})()")
console.log('   等待真实生成（最多 40s）…')
for (let i = 0; i < 8; i++) {
  await sleep(5000)
  const t = await ev("(()=>{const t=document.querySelector('.tag-ok');return t?t.textContent.replace(/\\s+/g,' ').trim():''})()")
  const err = await ev("(()=>{const e=document.querySelector('.error-text');return e?e.textContent.trim():''})()")
  if (t || err) { console.log('   结果:', t || ('错误: ' + err)); break }
}
console.log('   首个知识点状态:', await ev("(()=>{const r=document.querySelector('.row');return r?r.textContent.replace(/\\s+/g,' ').slice(0,52):''})()"))
await shot('real-cards-generated')

// 今日 → 开始学习 → 看真实卡片
console.log('3) 进今日复习真实卡片')
await ev("location.hash='#/today'"); await sleep(2500)
console.log('   今日队列:', await ev("document.body.innerText.replace(/\\s+/g,' ').slice(20,110)"))
await clickText('开始学习'); await sleep(3500)
const front = await ev("(()=>{const f=document.querySelector('.review-front');return f?f.textContent.replace(/\\s+/g,' ').slice(0,90):'(无复习卡)'})()")
console.log('   卡片题面:', front)
await shot('real-review-front')
await clickText('显示答案'); await sleep(1200)
console.log('   答案:', await ev("(()=>{const b=document.querySelector('.review-back');return b?b.textContent.replace(/\\s+/g,' ').slice(0,90):''})()"))
console.log('   解释:', await ev("(()=>{const b=document.querySelector('.explain-box');return b?b.textContent.replace(/\\s+/g,' ').slice(0,90):''})()"))
await shot('real-review-answer')
process.exit(0);
