// 查词：全量索引（14,625 词 = 四书 + 考研 + 托福 + SAT）按词与释义搜索，一键收藏进生词本
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { getDb } from '../db'
import { loadIndex, addWordToNotebook, type IndexItem } from '../vocab'

async function q(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]> {
  const db = await getDb()
  return db.select<Record<string, unknown>[]>(sql, args as never[])
}

export default function Dict() {
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [results, setResults] = useState<IndexItem[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const search = (t: string) => {
    const s = t.trim().toLowerCase()
    if (s.length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    void loadIndex()
      .then((idx) => {
        const starts: IndexItem[] = []
        const contains: IndexItem[] = []
        const meanHits: IndexItem[] = []
        for (const it of idx) {
          if (it.w.startsWith(s)) starts.push(it)
          else if (it.w.includes(s)) contains.push(it)
          else if (s.length >= 2 && it.m.some((m) => m.t.includes(s))) meanHits.push(it)
          if (starts.length >= 30) break
        }
        const out = [...starts, ...contains.slice(0, 20), ...meanHits.slice(0, 12)]
        setResults(out.slice(0, 40))
        setActive(out.length ? 0 : -1)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(() => search(text), 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const collect = async (it: IndexItem) => {
    const r = await addWordToNotebook(it.w, it, { db: await getDb(), dbQuery: q })
    if (r === 'added') setAdded((s) => new Set([...s, it.w]))
  }

  // 键盘：↑↓ 选择，Enter 收藏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!results.length) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(a + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter' && active >= 0) {
        void collect(results[active])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, active])

  return (
    <div className="page-in">
      <div className="page-head-row">
        <div>
          <div className="page-title">查词</div>
          <div className="page-sub">14,625 词全量索引（四六级 / 高频 / 基础 / 考研 / 托福 / SAT），支持英文与中文释义检索。收藏的词进入生词本，走同一复习循环。</div>
        </div>
        <button className="btn" onClick={() => nav('/vocab')}>
          返回词书
        </button>
      </div>

      <div className="dict-search">
        <input
          className="input"
          autoFocus
          placeholder="输入单词或中文释义…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {loading && <span className="dict-loading">搜索中…</span>}
      </div>

      <div className="dict-list" ref={listRef}>
        {results.map((it, i) => (
          <div className={`dict-item${i === active ? ' active' : ''}`} key={it.w} onClick={() => setActive(i)}>
            <div className="dict-word">
              <b>{it.w}</b>
              <span className="dict-src">{it.src.join(' / ')}</span>
            </div>
            <div className="dict-mean">
              {it.m.slice(0, 3).map((m, j) => (
                <span key={j}>
                  {m.p && <i>{m.p}.</i>}
                  {m.t}
                  {j < Math.min(2, it.m.length - 1) ? '；' : ''}
                </span>
              ))}
            </div>
            <button
              className={`btn btn-sm${added.has(it.w) ? ' is-added' : ''}`}
              disabled={added.has(it.w)}
              onClick={(e) => {
                e.stopPropagation()
                void collect(it)
              }}
            >
              {added.has(it.w) ? (
                <>
                  <Check size={13} /> 已收藏
                </>
              ) : (
                '收藏'
              )}
            </button>
          </div>
        ))}
        {text.trim() && !results.length && !loading && <div className="muted" style={{ padding: 20 }}>没有找到「{text}」</div>}
      </div>
    </div>
  )
}
