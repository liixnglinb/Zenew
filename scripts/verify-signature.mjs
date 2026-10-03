// 校验 Tauri 更新签名：用 tauri.conf.json 里的公钥验证安装包 .sig（minisign/Ed25519）
import { readFileSync } from 'fs'
import { createHash, createPublicKey, verify } from 'crypto'

const Z = 'C:/Users/李星历/Desktop/课程学习软件/Zenew'
const conf = JSON.parse(readFileSync(`${Z}/app/src-tauri/tauri.conf.json`, 'utf8'))
const pubB64 = conf.plugins.updater.pubkey

const exePath = `${Z}/app/src-tauri/target/release/bundle/nsis/Zenew_0.15.0_x64-setup.exe`
const sigPath = `${exePath}.sig`
const file = readFileSync(exePath)
const sigB64 = readFileSync(sigPath, 'utf8').trim()

const pub = Buffer.from(pubB64, 'base64')
const sigOuter = Buffer.from(sigB64, 'base64')

// 公钥/签名文件都是「base64 包一层文本」：untrusted comment: ...\n<base64 实际数据>
const inner = (buf) =>
  Buffer.from(
    buf
      .toString('utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('untrusted'))
      .join('')
      .trim(),
    'base64'
  )

const pubRaw = inner(pub)
const sigRaw = inner(sigOuter)

console.log('公钥算法标签:', pubRaw.subarray(0, 2).toString(), '| keyId:', pubRaw.subarray(2, 10).toString('hex'))
console.log('签名算法标签:', sigRaw.subarray(0, 2).toString(), '| keyId:', sigRaw.subarray(2, 10).toString('hex'))
console.log('签名长度:', sigRaw.length, '字节（2+8+64 = 74 期望）')

const keyBytes = pubRaw.subarray(10) // 32 字节 ed25519 公钥
const sigBytes = sigRaw.subarray(10) // 64 字节签名
const alg = sigRaw.subarray(0, 2).toString()

// 构造 DER 包装的 ed25519 SPKI
const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyBytes])
const keyObj = createPublicKey({ key: der, format: 'der', type: 'spki' })

const message = alg === 'ED' ? createHash('blake2b512').update(file).digest() : file
console.log('校验方式:', alg === 'ED' ? 'BLAKE2b-512 预哈希' : '原始文件内容')

const ok = verify(null, message, keyObj, sigBytes)
console.log('\n签名校验:', ok ? '✓ 通过（应用内更新可正常验证）' : '✗ 失败')
process.exit(ok ? 0 : 1)
