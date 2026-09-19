// 充值（卡密兑换）链路验收：node scripts/smoke-topup.mjs <邀请码> <卡密>
import fs from 'fs';
const base = 'https://zenew-api.lxlrwxs.top';
const INVITE = process.argv[2] || fs.readFileSync('/tmp/inv.txt', 'utf8').trim();
const TOPUP = process.argv[3] || fs.readFileSync('/tmp/topup.txt', 'utf8').trim();

const j = async (p, b, t) => {
  const r = await fetch(base + p, {
    method: b ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`) };

const email = `topup_${Date.now()}@zenew.test`;
const reg = await j('/auth/register', { email, password: 'zenew-topup-2026', invite_code: INVITE });
ok('注册（凭邀请码）', reg.s === 200 && !!reg.d.token, reg.d.detail || '');
const tk = reg.d.token;

let me = await j('/me', null, tk);
ok('初始余额为 0', me.d.balance_tokens === 0, `balance=${me.d.balance_tokens} 免费额度=${me.d.quota_tokens}`);

const noCode = await j('/billing/redeem', {}, tk);
ok('空兑换码被拒（400）', noCode.s === 400, noCode.d.detail || '');

const badCode = await j('/billing/redeem', { code: 'ZC-XXXX-XXXX' }, tk);
ok('无效兑换码被拒（404）', badCode.s === 404, badCode.d.detail || '');

const r1 = await j('/billing/redeem', { code: TOPUP }, tk);
ok('兑换成功并到账', r1.s === 200 && r1.d.balance_tokens > 0,
  `档位 ${r1.d.tier} ¥${r1.d.price_cny} +${r1.d.added_tokens} tokens → 余额 ${r1.d.balance_tokens}`);

const r2 = await j('/billing/redeem', { code: TOPUP }, tk);
ok('同一卡密重复兑换被拒（403）', r2.s === 403, r2.d.detail || '');

const anon = await fetch(base + '/billing/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: TOPUP }) });
ok('未登录兑换被拒（401）', anon.status === 401);

me = await j('/me', null, tk);
ok('/me 返回余额', me.d.balance_tokens === r1.d.balance_tokens, `balance=${me.d.balance_tokens}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
