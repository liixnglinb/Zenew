// 核心逻辑单元测试（模块九）——全部纯函数，不依赖 Tauri / SQLite
// 运行：npm test（vitest run）
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { Rating, State } from 'ts-fsrs'
import { newCard, schedule, cardToRow, rowToCard, isMastered, isLearning } from '../src/fsrs'
import { getSettings, saveSettings, editDistance, morphology, wordVisual, avatarVisual, similarWords, starBank, grantStars } from '../src/study'
import { TRAIN_MODES, isTrainMode, loadDictation, saveDictation, shuffle } from '../src/train'
import { emblemOf } from '../src/emblem'
import type { StateRow } from '../src/db'

/* ---------------- localStorage shim（node 环境没有） ---------------- */
const store = new Map<string, string>()
const lsShim = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
}
beforeAll(() => {
  vi.stubGlobal('localStorage', lsShim)
})
beforeEach(() => {
  store.clear()
})

/** 临时替换 fetch，测完恢复（不能走 unstubAllGlobals，会连 localStorage 垫片一起拆掉） */
async function withFetch<T>(impl: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = impl as unknown as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = orig
  }
}

/* ---------------- 模块一/三：FSRS 调度（业务核心） ---------------- */
describe('fsrs 调度', () => {
  it('新卡评分后 reps 递增、到期时间在未来', () => {
    const { next } = schedule(null, Rating.Good)
    expect(next.reps).toBe(1)
    expect(next.state).toBeGreaterThanOrEqual(State.Learning)
    expect(next.state).toBeLessThanOrEqual(State.Relearning)
    expect(new Date(next.due).getTime()).toBeGreaterThan(Date.now())
    expect(Number.isFinite(next.stability)).toBe(true)
    expect(next.stability).toBeGreaterThan(0)
  })

  it('Review 态卡点「忘了」：lapses +1、reps +1', () => {
    const now = Date.now()
    const row: StateRow = {
      card_id: 1,
      due: new Date(now - 86_400_000).toISOString(),
      stability: 30,
      difficulty: 5,
      elapsed_days: 1,
      scheduled_days: 1,
      reps: 5,
      lapses: 0,
      state: State.Review as number,
      last_review: new Date(now - 86_400_000).toISOString(),
    }
    const { next } = schedule(row, Rating.Again)
    expect(next.lapses).toBe(row.lapses + 1)
    expect(next.reps).toBe(row.reps + 1)
    expect(next.card_id).toBe(row.card_id)
  })

  it('rowToCard / cardToRow 往返保持字段一致', () => {
    const row = cardToRow(7, newCard())
    const card = rowToCard(row)
    const back = cardToRow(7, card)
    expect(back).toEqual(row)
    expect(row.card_id).toBe(7)
    expect(row.last_review).toBeNull()
  })

  it('isMastered 边界：Review 态且 stability ≥ 21', () => {
    const base = { card_id: 1, due: '', stability: 21, difficulty: 5, elapsed_days: 0, scheduled_days: 0, reps: 3, lapses: 0, last_review: null }
    expect(isMastered({ ...base, state: State.Review as number } as StateRow)).toBe(true)
    expect(isMastered({ ...base, stability: 20.9, state: State.Review as number } as StateRow)).toBe(false)
    expect(isMastered({ ...base, stability: 99, state: State.Learning as number } as StateRow)).toBe(false)
    expect(isMastered(null)).toBe(false)
    expect(isLearning(null)).toBe(false)
    expect(isLearning({ ...base, stability: 1, state: State.Learning as number } as StateRow)).toBe(true)
  })
})

/* ---------------- 模块三：坏数据容错（设置 / 听写 / 星罐） ---------------- */
describe('设置读写与坏数据容错', () => {
  it('空存储返回默认值', () => {
    expect(getSettings()).toEqual({ sound: true, haptic: true, remind: false, scale: 1, elder: false })
  })
  it('部分存储与默认值合并，不产生 undefined 字段', () => {
    store.set('zenew_settings_v1', JSON.stringify({ sound: false }))
    const s = getSettings()
    expect(s.sound).toBe(false)
    expect(s.haptic).toBe(true)
    expect(s.scale).toBe(1)
  })
  it('损坏 JSON 不崩溃，回落默认', () => {
    store.set('zenew_settings_v1', '{oops not json')
    expect(getSettings()).toEqual({ sound: true, haptic: true, remind: false, scale: 1, elder: false })
  })
  it('saveSettings 合并补丁并持久化', () => {
    const next = saveSettings({ sound: false, scale: 1.2 })
    expect(next.sound).toBe(false)
    expect(getSettings().scale).toBe(1.2)
    expect(getSettings().haptic).toBe(true)
  })
})

describe('听写设置：字段白名单校验', () => {
  it('全部字段越界时逐字段回落默认', () => {
    store.set('zenew_dictation', JSON.stringify({ prompt: 'x', accent: 'jp', plays: 5, interval: 7, autoNext: 'yes' }))
    const d = loadDictation()
    expect(d).toEqual({ prompt: 'audio', accent: 'us', plays: 3, interval: 4, autoNext: true })
  })
  it('合法值被保留、坏 JSON 回默认', () => {
    store.set('zenew_dictation', JSON.stringify({ prompt: 'meaning', accent: 'uk', plays: 2, interval: 8, autoNext: false }))
    expect(loadDictation()).toEqual({ prompt: 'meaning', accent: 'uk', plays: 2, interval: 8, autoNext: false })
    store.set('zenew_dictation', 'not json at all')
    expect(loadDictation().plays).toBe(3)
  })
  it('saveDictation 局部合并并持久化', () => {
    saveDictation({ plays: 1 })
    expect(loadDictation().plays).toBe(1)
    expect(loadDictation().interval).toBe(4)
  })
})

describe('每日任务星星：幂等', () => {
  it('同一任务当天只计一次，重复发放返回 0', () => {
    expect(grantStars(['t1', 't2'])).toBe(2)
    expect(grantStars(['t1', 't2', 't3'])).toBe(1)
    expect(grantStars(['t1'])).toBe(0)
    expect(starBank()).toBe(3)
  })
  it('空列表不写库', () => {
    expect(grantStars([])).toBe(0)
    expect(starBank()).toBe(0)
  })
})

/* ---------------- 模块三：边界输入 ---------------- */
describe('editDistance 与形近词', () => {
  it('经典用例与边界', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('abc', 'abc')).toBe(0)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
    expect(editDistance('a', 'b')).toBe(1)
  })
  it('形近词：排除自身、按距离排序、尊重 limit', async () => {
    const fixture = [
      { w: 'legal', m: [{ p: 'adj.', t: '法律的' }], p: [], src: [] },
      { w: 'legals', m: [{ p: 'n.', t: '法律文件' }], p: [], src: [] },
      { w: 'regal', m: [{ p: 'adj.', t: '帝王的' }], p: [], src: [] },
      { w: 'leger', m: [{ p: 'n.', t: '账簿' }], p: [], src: [] },
      { w: 'league', m: [{ p: 'n.', t: '联盟' }], p: [], src: [] },
    ]
    await withFetch(async () => ({ ok: true, json: async () => fixture }), async () => {
      const all = await similarWords('legal', 6)
      expect(all.map((x) => x.w)).not.toContain('legal')
      expect(all.length).toBeGreaterThan(0)
      expect(all.length).toBeLessThanOrEqual(6)
      // 距离非降序
      const dists = all.map((x) => editDistance('legal', x.w))
      expect([...dists].sort((a, b) => a - b)).toEqual(dists)
      expect(all.every((x) => typeof x.t === 'string')).toBe(true)
    })
  })
  it('非字母 / 过短输入直接返回空', async () => {
    expect(await similarWords('ab')).toEqual([])
    expect(await similarWords('12345')).toEqual([])
  })
})

describe('词根词缀与确定性视觉', () => {
  it('morphology 对带词缀的词给出拆解', () => {
    const m = morphology('illegal')
    expect(m).not.toBeNull()
    expect(m!.parts.length).toBeGreaterThanOrEqual(2)
  })
  it('同一输入永远同一输出（媒体卡不闪变）', () => {
    expect(wordVisual('adequate')).toEqual(wordVisual('adequate'))
    expect(avatarVisual('seed')).toEqual(avatarVisual('seed'))
    expect(emblemOf('adequate')).toEqual(emblemOf('adequate'))
  })
  it('不同词的视觉参数有区分', () => {
    const a = emblemOf('legal')
    const b = emblemOf('regal')
    expect(a).not.toEqual(b)
  })
})

/* ---------------- 模块三：训练模式守卫 ---------------- */
describe('训练模式', () => {
  it('五种合法模式全部通过', () => {
    expect(TRAIN_MODES).toEqual(['listen', 'rush', 'choice', 'spell', 'dictation'])
    for (const m of TRAIN_MODES) expect(isTrainMode(m)).toBe(true)
  })
  it('大小写敏感与垃圾值拒绝', () => {
    expect(isTrainMode('Choice')).toBe(false)
    expect(isTrainMode('')).toBe(false)
    expect(isTrainMode(undefined)).toBe(false)
    expect(isTrainMode('listen ')).toBe(false) // 尾随空格不接受
  })
  it('shuffle 是排列（不丢不重）', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffle([...src])
    expect(out).toHaveLength(src.length)
    expect([...out].sort((a, b) => a - b)).toEqual(src)
  })
})
