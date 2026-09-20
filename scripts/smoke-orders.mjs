// 收款链路验收：下单 → 管理确认 → 自动充入账号 / 签发兑换码
// 用法: node scripts/smoke-orders.mjs <管理口令> <已注册邮箱> <该邮箱密码>
import fs from 'fs';
const API = 'https://zenew-api.lxlrwxs.top';
const ADMIN = process.argv[2] || fs.readFileSync('C:/Users/李星历/Desktop/课程学习软件/Zenew/.secrets/admin_token.txt', 'utf8').trim();
const EMAIL = process.argv[3];
const PASS = process.argv[4];
let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => { cond ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log('  ✗ ' + name + ' ' + extra)); };

const post = async (p, b, h = {}) => {
  const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b ?? {}) });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const get = async (p, h = {}) => {
  const r = await fetch(API + p, { headers: h });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};

console.log('=== 1. 下单（填邮箱 → 应自动充值）===');
const o1 = await post('/billing/order', { tier: 2, email: EMAIL });
ck('下单成功且返回订单号', o1.s === 200 && /^ZW\d{6}[A-Z0-9]{6}$/.test(o1.d.order_no), JSON.stringify(o1.d));
ck('金额/额度正确（¥9.9 / 170万）', o1.d.price_cny === 9.9 && o1.d.tokens === 1700000);
const before = (await post('/auth/login', { email: EMAIL, password: PASS })).d;
const tk = before.token;
const balBefore = (await get('/me', { Authorization: 'Bearer ' + tk })).d.balance_tokens || 0;

console.log('=== 2. 权限校验 ===');
ck('无口令查订单被拒 401', (await get('/admin/orders')).s === 401);
ck('错口令确认被拒 401', (await post('/admin/orders/' + o1.d.order_no + '/confirm', {}, { 'x-admin-token': 'wrong' })).s === 401);

console.log('=== 3. 管理确认（有账号 → 直接充入）===');
const c1 = await post('/admin/orders/' + o1.d.order_no + '/confirm', {}, { 'x-admin-token': ADMIN });
ck('确认成功', c1.s === 200 && c1.d.ok);
ck('走「充入账号」而非发码', c1.d.credited === true && !c1.d.code, JSON.stringify(c1.d));
const meAfter = (await get('/me', { Authorization: 'Bearer ' + tk })).d;
ck('余额 +170万', (meAfter.balance_tokens || 0) === balBefore + 1700000, `${balBefore} → ${meAfter.balance_tokens}`);
const q1 = await get('/billing/order/' + o1.d.order_no);
ck('订单状态变 paid', q1.d.status === 'paid');
ck('重复确认幂等', (await post('/admin/orders/' + o1.d.order_no + '/confirm', {}, { 'x-admin-token': ADMIN })).d.already === true);

console.log('=== 4. 下单（不填邮箱 → 应发兑换码）===');
const o2 = await post('/billing/order', { tier: 1 });
ck('未填邮箱下单成功', o2.s === 200);
const c2 = await post('/admin/orders/' + o2.d.order_no + '/confirm', {}, { 'x-admin-token': ADMIN });
ck('确认后签发兑换码', c2.d.credited === false && /^ZC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c2.d.code || ''), JSON.stringify(c2.d));
const r2 = await post('/billing/redeem', { code: c2.d.code }, { Authorization: 'Bearer ' + tk });
ck('兑换码可在软件内兑换', r2.s === 200 && r2.d.added_tokens === 600000, JSON.stringify(r2.d));
ck('兑换码不可复用', (await post('/billing/redeem', { code: c2.d.code }, { Authorization: 'Bearer ' + tk })).s === 403);

console.log('=== 5. 边界 ===');
ck('无效档位 400', (await post('/billing/order', { tier: 9 })).s === 400);
ck('不存在的订单 404', (await get('/billing/order/ZW000000XXXXXX')).s === 404);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
