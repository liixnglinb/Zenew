// 词书页：四级 / 六级 / 高频词 / 基础英语 四板块（仅这四本默认内置）
// 每本词书按 100 词一段导入（幂等可续），导入的词全部进入统一 FSRS 复习循环。
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb } from '../db'
import { WORD_BOOKS, loadBook, vocabCourseStats, importVocabRange, type WordBook, type VocabEntry } from '../vocab'

type Progress = Record<string, { cards: number; learned: number; importing: number; loaded: number; err: string }>

async function q(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]> {
  const db = await getDb()
  return db.select<Record<string, unknown>[]>(sql, args as never[])
}

export default function Vocab() {
  const nav = useNavigate()
  const [progress, setProgress] = useState<Progress>({})
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    const next: Progress = {}
    for (const b of WORD_BOOKS) {
      const s = await vocabCourseStats(b.name, q)
      next[b.key] = { cards: s.cards, learned: s.learned, importing: 0, loaded: 0, err: '' }
    }
    setProgress(next)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const importBatch = async (book: WordBook, entries: VocabEntry[], start: number, count: number) => {
    setProgress((p) => ({ ...p, [book.key]: { ...p[book.key], importing: count, err: '' } }))
    try {
      const db = await getDb()
      await importVocabRange(book, entries, start, Math.min(start + count, entries.length), { db, dbQuery: q })
      const s = await vocabCourseStats(book.name, q)
      setProgress((p) => ({
        ...p,
        [book.key]: { ...s, importing: 0, loaded: Math.min(start + count, entries.length), err: '' },
      }))
    } catch (e) {
      setProgress((p) => ({ ...p, [book.key]: { ...p[book.key], importing: 0, err: String(e).slice(0, 120) } }))
    }
  }

  const startImport = async (book: WordBook) => {
    if (busy) return
    setBusy(true)
    try {
      const entries = await loadBook(book.file)
      const p = progress[book.key]
      const start = p?.cards ?? 0
      await importBatch(book, entries, start, Math.min(300, entries.length - start))
    } catch (e) {
      setProgress((pp) => ({ ...pp, [book.key]: { ...pp[book.key], err: String(e).slice(0, 120) } }))
    } finally {
      setBusy(false)
    }
  }

  const importAll = async (book: WordBook) => {
    if (busy) return
    setBusy(true)
    try {
      const entries = await loadBook(book.file)
      const start = progress[book.key]?.cards ?? 0
      for (let from = start; from < entries.length; from += 300) {
        await importBatch(book, entries, from, 300)
      }
    } catch (e) {
      setProgress((pp) => ({ ...pp, [book.key]: { ...pp[book.key], err: String(e).slice(0, 120) } }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-in">
      <div className="page-head-row">
        <div>
          <div className="page-title">词书</div>
          <div className="page-sub">四本内置词书，导入即进入科学复习循环：先回忆 → 翻面 → 自评分，按遗忘曲线安排间隔重复。</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('/dict')}>
          查词
        </button>
      </div>

      <div className="book-grid">
        {WORD_BOOKS.map((b) => {
          const p = progress[b.key]
          const total = { cet4: 4544, cet6: 3991, freq: 4544, basic: 3911 }[b.key]
          const pct = p && p.cards > 0 ? Math.round((p.learned / p.cards) * 100) : 0
          const done = p ? p.cards >= total : false
          return (
            <div className="book-card" key={b.key}>
              <div className="book-name">{b.name}</div>
              <div className="book-desc">{b.desc} · {total} 词</div>
              {p && p.cards > 0 && (
                <>
                  <div className="book-bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="book-meta">
                    已导入 {p.cards} · 已学 {p.learned}（{pct}%）
                  </div>
                </>
              )}
              {p?.err && <div className="error-text">{p.err}</div>}
              <div className="book-actions">
                {!done && (
                  <button className="btn btn-sm" disabled={busy || (p?.importing ?? 0) > 0} onClick={() => void startImport(b)}>
                    {p && p.cards > 0 ? '继续导入 300 词' : '导入 300 词'}
                  </button>
                )}
                {!done && p && p.cards > 0 && (
                  <button className="btn btn-sm" disabled={busy || (p?.importing ?? 0) > 0} onClick={() => void importAll(b)}>
                    导入全部
                  </button>
                )}
                {done && <span className="tag tag-mono">已导入全部</span>}
                {p && p.cards > 0 && (
                  <button
                    className="btn btn-sm"
                    onClick={() => nav(`/vocab/${b.key}`)}
                  >
                    开始学习
                  </button>
                )}
              </div>
              {(p?.importing ?? 0) > 0 && <div className="book-meta">正在导入 {p.importing} 词…</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
