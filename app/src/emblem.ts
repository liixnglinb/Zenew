/* ============================================================
 * emblem.ts — 程序化"形义徽标"（确定性，同词永远同图）
 *
 * 由单词本身哈希决定四件事：
 *   1. 渐变对（低饱和 6 组，色相覆盖 蓝/绿/紫/橙/珊瑚/青）
 *   2. 几何纹样（内联 SVG data-URI 平铺：同心圆/斜纹/点阵/三角/波浪/十字）
 *   3. 旋转角（-6°..6°，给纹样层一点手工感）
 *   4. 中央大字形（词首字母大写）
 *
 * 不伪造照片/插画：只用几何纹样 + 渐变 + 字形做"记忆锚点"。
 * 哈希用 FNV-1a 32 位：无碰撞担忧、跨会话/跨页面完全一致，
 * 学习页 / 训练页 / 词条详情三处媒体卡共用，视觉严格一致。
 * ============================================================ */

export interface Emblem {
  /** 渐变起点色 */
  from: string
  /** 渐变终点色 */
  to: string
  /** 纹样平铺层：内联 SVG data-URI（28×28 无缝瓦片） */
  pattern: string
  /** 中央大字形（词首字母） */
  glyph: string
  /** 纹样层旋转角（度，-6..6） */
  angle: number
}

/** 低饱和渐变对：色相覆盖 蓝绿紫橙珊瑚青（顺序即取模顺序） */
const GRADIENTS: [string, string][] = [
  ['#6E8FD8', '#4A66AC'], // 蓝
  ['#5CB8A4', '#3C8E7C'], // 绿
  ['#9C86D6', '#6D58AE'], // 紫
  ['#E2A465', '#C07C40'], // 橙
  ['#E08B7C', '#B95F53'], // 珊瑚
  ['#56B4C8', '#34849B'], // 青
]

/** 28×28 无缝 SVG 瓦片 → data-URI（encode 后可在任意 background-image 使用） */
function tileSvg(body: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>${body}</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

/** 六种几何纹样（白描边/白点，低不透明度，平铺无缝） */
const PATTERNS: string[] = [
  // 同心圆：中心双环 + 四角补环
  tileSvg(
    `<g fill='none' stroke='#FFF' stroke-opacity='.24' stroke-width='1.4'>` +
      `<circle cx='14' cy='14' r='3.5'/><circle cx='14' cy='14' r='9.5'/>` +
      `<circle cx='0' cy='0' r='7'/><circle cx='28' cy='0' r='7'/>` +
      `<circle cx='0' cy='28' r='7'/><circle cx='28' cy='28' r='7'/></g>`
  ),
  // 斜纹：三条 45° 平行线（含越界补线）
  tileSvg(
    `<g stroke='#FFF' stroke-opacity='.2' stroke-width='3.2'>` +
      `<path d='M-14 14 L14 -14'/><path d='M0 28 L28 0'/><path d='M14 42 L42 14'/></g>`
  ),
  // 点阵：错位双点
  tileSvg(
    `<g fill='#FFF' fill-opacity='.28'>` +
      `<circle cx='7' cy='7' r='2'/><circle cx='21' cy='21' r='2'/></g>`
  ),
  // 三角：菱形网格（上下两排山形折线，角点相接）
  tileSvg(
    `<g fill='none' stroke='#FFF' stroke-opacity='.2' stroke-width='1.3' stroke-linejoin='round'>` +
      `<path d='M0 28 L14 12 L28 28'/><path d='M0 0 L14 16 L28 0'/></g>`
  ),
  // 波浪：两条正弦线（行距 14，水平起终点斜率一致）
  tileSvg(
    `<g fill='none' stroke='#FFF' stroke-opacity='.2' stroke-width='1.4'>` +
      `<path d='M0 8 Q7 0 14 8 Q21 16 28 8'/><path d='M0 22 Q7 14 14 22 Q21 30 28 22'/></g>`
  ),
  // 十字：每瓦片一枚圆头十字
  tileSvg(
    `<g stroke='#FFF' stroke-opacity='.24' stroke-width='1.8' stroke-linecap='round'>` +
      `<path d='M14 8.5 V19.5 M8.5 14 H19.5'/></g>`
  ),
]

/** FNV-1a 32 位哈希（确定性；与视觉强相关，勿改动映射参数） */
function hashWord(word: string): number {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 确定性形义徽标：同词永远同图 */
export function emblemOf(word: string): Emblem {
  const w = word.trim()
  const h = hashWord(w || 'zenew')
  const [from, to] = GRADIENTS[h % GRADIENTS.length]
  const pattern = PATTERNS[Math.floor(h / GRADIENTS.length) % PATTERNS.length]
  const angle = (Math.floor(h / (GRADIENTS.length * PATTERNS.length)) % 13) - 6 // -6..6
  const glyph = (w[0] || 'A').toUpperCase()
  return { from, to, pattern, glyph, angle }
}
