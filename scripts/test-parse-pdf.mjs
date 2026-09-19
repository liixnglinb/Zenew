// 独立验证 PDF 解析逻辑（与 app/src/pdf.ts 相同算法）：行重组 + 章标题检测
import * as pdfjsLib from 'file:///D:/Zenew/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'fs'

const data = new Uint8Array(fs.readFileSync('D:/Zenew/docs/test-textbook.pdf'))
const pdf = await pdfjsLib.getDocument({ data }).promise
const CHAPTER_RE = /^\s*(第\s*[一二三四五六七八九十百0-9０-９]+\s*[章讲篇部]|Chapter\s+\d+)/i

const chapters = []
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p)
  const tc = await page.getTextContent()
  const linesMap = new Map()
  for (const it of tc.items) {
    if (!it.str) continue
    const y = Math.round(it.transform[5] / 4) * 4
    if (!linesMap.has(y)) linesMap.set(y, [])
    linesMap.get(y).push({ x: it.transform[4], s: it.str })
  }
  const ys = [...linesMap.keys()].sort((a, b) => b - a)
  const lines = ys.map((y) => linesMap.get(y).sort((a, b) => a.x - b.x).map((w) => w.s).join('').trim()).filter(Boolean)
  // 全行扫描章标题
  for (const ln of lines) {
    if (CHAPTER_RE.test(ln) && ln.length <= 32) {
      chapters.push(`p${p}: 「${ln}」`)
    }
  }
  if (p === 1) console.log('--- 第 1 页前 4 行（行重组效果）---')
  if (p === 1) lines.slice(0, 4).forEach((l) => console.log('   |', l.slice(0, 50)))
}
console.log('--- 检测到的章标题 ---')
chapters.forEach((c) => console.log(' ', c))
console.log(chapters.length === 2 ? '✓ 两章均正确识别，标题为纯标题行' : '✗ 章标题检测异常')
