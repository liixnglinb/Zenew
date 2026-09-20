// 充值卡密生成器：node scripts/mint-topup.mjs <档位1-4> [数量] [备注]
// 档位：1=¥3.9/60万  2=¥9.9/170万  3=¥19.9/370万  4=¥39.9/780万
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { randomBytes } from 'crypto';

export const TIERS = {
  1: { price: 3.9, tokens: 600_000 },
  2: { price: 9.9, tokens: 1_700_000 },
  3: { price: 19.9, tokens: 3_700_000 },
  4: { price: 39.9, tokens: 7_800_000 },
};

const tier = parseInt(process.argv[2] || '', 10);
if (!TIERS[tier]) {
  console.error('用法: node scripts/mint-topup.mjs <档位1-4> [数量] [备注]');
  for (const [k, v] of Object.entries(TIERS)) console.error(`  ${k} 档：¥${v.price} = ${(v.tokens / 10000).toFixed(0)} 万 tokens`);
  process.exit(2);
}
const count = Math.max(1, Math.min(500, parseInt(process.argv[3] || '1', 10) || 1));
const note = (process.argv[4] || '-').replace(/'/g, '');
const { price, tokens } = TIERS[tier];

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const block = (n = 4) => {
  const b = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
};
// 形如 ZC-XXXX-XXXX（Zenew Card），与邀请码 ZENEW- 前缀区分
const codes = Array.from({ length: count }, () => `ZC-${block()}-${block()}`);
const now = new Date().toISOString();

const values = codes.map((c) => `('${c}',${tier},${price},${tokens},'${note}','${now}')`).join(',');
const sql = `INSERT INTO topup_codes(code,tier,price_cny,tokens,note,created_at) VALUES ${values};`;

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'server-worker');
console.log(`生成 ${count} 个 ${tier} 档卡密（¥${price} / ${(tokens / 10000).toFixed(0)} 万 tokens，备注：${note}）\n`);
execSync(`npx wrangler d1 execute zenew-apac --remote --command "${sql}"`, { stdio: 'inherit', cwd: root });

console.log('\n卡密清单（自行保存，界面不展示）：');
for (const c of codes) console.log('  ' + c);
console.log(`\n总计面额：¥${(price * count).toFixed(2)}`);
console.log('查询/核查：npx wrangler d1 execute zenew-apac --remote --command "SELECT code,tier,price_cny,used_by_email FROM topup_codes ORDER BY created_at DESC LIMIT 20"');
