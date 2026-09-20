// 邀请码生成器：node scripts/mint-invite.mjs [数量] [备注]
// 生成形如 ZENEW-XXXX-XXXX 的一次性邀请码并写入线上 D1（zenew-apac）
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { join } from 'path';

const count = Math.max(1, Math.min(200, parseInt(process.argv[2] || '1', 10) || 1));
const note = (process.argv[3] || 'manual').replace(/'/g, '');
// 去掉易混字符（0/O/1/I）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function block(n = 4) {
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
const codes = Array.from({ length: count }, () => `ZENEW-${block()}-${block()}`);
const now = new Date().toISOString();

const values = codes.map((c) => `('${c}','${note}','${now}')`).join(',');
const sql = `INSERT INTO invite_codes(code,note,created_at) VALUES ${values};`;

console.log(`生成 ${count} 个邀请码（备注：${note}），写入线上 D1…\n`);
execSync(
  `npx wrangler d1 execute zenew-apac --remote --command "${sql}"`,
  { stdio: 'inherit', cwd: join(fileURLToPath(new URL('..', import.meta.url)), 'server-worker') }
);

console.log('\n邀请码清单（请自行保存，界面只显示一次）：');
for (const c of codes) console.log('  ' + c);
console.log('\n用法：在客户端「注册」页填入邀请码即可开通账号（一次性，用后作废）。');
console.log('查询/停用：npx wrangler d1 execute zenew-apac --remote --command "SELECT code,note,used_by_email FROM invite_codes"');
