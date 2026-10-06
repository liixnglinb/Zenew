// 模块九·错误路径：词库加载失败必须「抛可读错误 + 缓存不中毒 + 可重试」
// 这是完全离线应用最关键的失败路径（文件缺失/损坏时不能把应用锁死）
import { describe, it, expect, vi } from 'vitest'
import { loadBook, loadIndex } from '../src/vocab'

async function withFetch(impl: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>, fn: () => Promise<void>) {
  const orig = globalThis.fetch
  const spy = vi.fn(impl)
  globalThis.fetch = spy as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = orig
  }
  return spy
}

describe('词库加载失败路径', () => {
  it('loadBook：HTTP 500 → 抛可读错误；第二次调用会重试（缓存不中毒）', async () => {
    const spy = await withFetch(async () => ({ ok: false, status: 500 }), async () => {
      await expect(loadBook('cet4.json')).rejects.toThrow('词书加载失败')
    })
    expect(spy).toHaveBeenCalledTimes(1)
    // 恢复后同一进程内再次调用必须真正发起第二次网络请求（失败不缓存）
    await withFetch(async () => ({ ok: true, json: async () => [{ w: 'a', uk: '', us: '', m: [], s: [], r: 0 }] }), async () => {
      const book = await loadBook('cet4.json')
      expect(Array.isArray(book)).toBe(true)
    })
    expect(spy).toHaveBeenCalledTimes(1) // 上一个 withFetch 的 spy 作用域独立，这里只验证不抛
  })

  it('loadIndex：非 2xx → 抛「词库索引加载失败」且允许下次重试', async () => {
    await withFetch(async () => ({ ok: false, status: 404 }), async () => {
      await expect(loadIndex()).rejects.toThrow('词库索引加载失败')
    })
    await withFetch(async () => ({ ok: true, json: async () => [] }), async () => {
      await expect(loadIndex()).resolves.toEqual([])
    })
  })

  it('loadBook：JSON 解析失败同样抛错且不缓存坏结果', async () => {
    await withFetch(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json') } }), async () => {
      await expect(loadBook('freq.json')).rejects.toThrow()
    })
    await withFetch(async () => ({ ok: true, json: async () => [] }), async () => {
      await expect(loadBook('freq.json')).resolves.toEqual([])
    })
  })
})
