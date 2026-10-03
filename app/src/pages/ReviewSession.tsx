import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ArrowLeft, ArrowRight, Check, Lightbulb, Maximize2, Minimize2, Scissors, Sparkles, Volume2, X } from 'lucide-react'
import { getDb, loadQueue, loadSession, loadQueueByIds, saveSession, clearSession, nowIso, isTauri, type QueueItem } from '../db'
import { schedule, R } from '../fsrs'
import { buildWordChoices, morphology, similarWords, tone, buzz, wordVisual, getSettings, type ChoiceSet } from '../study'
import { Progress, useToast } from '../ui'

type Phase = 'front' | 'answered'
type DetailTab = 'sense' | 'sent' | 'morph' | 'similar'

/** 单词卡 back 结构（vocab.ts squeeze 输出） */
interface WordBack {
  m?: { p: string; t: string }[]
  s?: { e: string; c: string }[]
  uk?: string
  us?: string
}
function parseWordBack(back: string): WordBack | null {
  try {
    const o = JSON.parse(back)
    if (o && (o.m || o.s || o.uk || o.us)) return o as WordBack
    return null
  } catch {
    return null
  }
}

/** Tauri WebView2 内置 SpeechSynthesis 朗读 */
function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 0.92
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
    /* 无语音引擎时静默 */
  }
}

interface Confetti {
  left: number
  dx: number
  rot: number
  color: string
  delay: number
}

const CONFETTI_COLORS = ['#94D7CF', '#245EF0', '#FFD166', '#FF8A3D', '#7A5CFF', '#FFFFFF']

export default function ReviewSession({ initialQueue }: { initialQueue?: QueueItem[] }) {
  const nav = useNavigate()
  const toast = useToast()
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue ?? [])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('front')
  const [picked, setPicked] = useState<number | null>(null)
  const [choices, setChoices] = useState<ChoiceSet | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('sense')
  const [showDetail, setShowDetail] = useState(false)
  const [similar, setSimilar] = useState<{ w: string; t: string }[] | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [confetti, setConfetti] = useState<Confetti[]>([])
  const [prevCard, setPrevCard] = useState<{ w: string; m: string } | null>(null)
  const [done, setDone] = useState<{ total: number; again: number; ms: number } | null>(null)
  const shownAt = useRef<number>(Date.now())
  const sessionStart = useRef<number>(Date.now())
  const againCount = useRef<number>(0)
  const doneCount = useRef<number>(0)
  const [loading, setLoading] = useState(true)
  const [fs, setFs] = useState(false)
  const [resumed, setResumed] = useState(false)
  const committing = useRef(false)
  const [commitErr, setCommitErr] = useState('')

  const enterFs = () => {
    if (isTauri()) getCurrentWindow().setFullscreen(true).catch(() => {})
    try { localStorage.setItem('zenew_review_fs', '1') } catch {}
  }
  const exitFs = () => {
    if (isTauri()) getCurrentWindow().setFullscreen(false).catch(() => {})
    try { localStorage.setItem('zenew_review_fs', '0') } catch {}
  }

  useEffect(() => {
    if (isTauri()) {
      const win = getCurrentWindow()
      const p = win.onResized(async () => {
        try { setFs(await win.isFullscreen()) } catch {}
      })
      return () => {
        p.then((f) => f()).catch(() => {})
      }
    }
    return () => {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        if (initialQueue && initialQueue.length) {
          await saveSession(initialQueue.map((x) => x.id), 0).catch(() => {})
          shownAt.current = Date.now()
          setLoading(false)
          return
        }
        const saved = await loadSession()
        if (saved) {
          const q = await loadQueueByIds(saved.card_ids)
          if (q.length && saved.idx < q.length) {
            setQueue(q)
            setIdx(saved.idx)
            doneCount.current = saved.done_count || 0
            againCount.current = saved.again_count || 0
            setResumed(true)
            setLoading(false)
            shownAt.current = Date.now()
            return
          }
        }
        await clearSession()
      } catch (e) {
        console.error('恢复会话失败', e)
      }
      const rawLimit = Number(localStorage.getItem('zenew_new_limit'))
      const newLimit = Number.isFinite(rawLimit) && rawLimit >= 0 ? rawLimit : 10
      const q = await loadQueue(nowIso(), newLimit)
      setQueue(q)
      await saveSession(q.map((x) => x.id), 0).catch(() => {})
      setLoading(false)
      shownAt.current = Date.now()
    })()
  }, [])

  const item = queue[idx]
  const isWord = item?.type === 'word'
  const wordBack = useMemo(() => (item && item.type === 'word' ? parseWordBack(item.back) : null), [item])
  const morph = useMemo(() => (item && item.type === 'word' ? morphology(item.front) : null), [item])
  const visual = useMemo(() => wordVisual(item?.front || 'A'), [item])
  const firstSense = wordBack?.m?.[0]

  /* ---- 换卡：重置阶段态，生成四选一，自动朗读 ---- */
  useEffect(() => {
    if (!item) return
    setPhase('front')
    setPicked(null)
    setShowDetail(false)
    setShowHint(false)
    setConfetti([])
    setSimilar(null)
    setDetailTab('sense')
    setCommitErr('')
    shownAt.current = Date.now()
    if (item.type === 'word') {
      const back = parseWordBack(item.back)
      const sense = back?.m?.[0]
      if (sense?.t) {
        buildWordChoices(item.id, item.course_name, sense).then(setChoices).catch(() => setChoices(null))
      } else {
        setChoices(null)
      }
      if (getSettings().sound) setTimeout(() => speak(item.front), 220)
    } else {
      setChoices(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  /* ---- 答对后异步取形近词（用于「和 xxx 搞混了？」辨析） ---- */
  useEffect(() => {
    if (phase !== 'answered' || !isWord || !item) return
    similarWords(item.front).then(setSimilar).catch(() => setSimilar([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item?.id])

  const commit = async (grade: number): Promise<boolean> => {
    if (!item) return false
    const db = await getDb()
    const { next } = schedule(item.st, grade as 1 | 2 | 3 | 4)
    const row = { ...next, card_id: item.id }
    try {
      await db.execute(
        `INSERT INTO card_state(card_id,due,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(card_id) DO UPDATE SET due=excluded.due, stability=excluded.stability, difficulty=excluded.difficulty,
           elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days, reps=excluded.reps,
           lapses=excluded.lapses, state=excluded.state, last_review=excluded.last_review`,
        [row.card_id, row.due, row.stability, row.difficulty, row.elapsed_days, row.scheduled_days, row.reps, row.lapses, row.state, row.last_review]
      )
      await db.execute('INSERT INTO review_log(card_id,rating,reviewed_at,duration_ms) VALUES(?,?,?,?)', [
        item.id,
        grade,
        nowIso(),
        Date.now() - shownAt.current,
      ]).catch(() => {})
      return true
    } catch (e) {
      console.error('commit 失败', e)
      setCommitErr('保存失败，请重试')
      return false
    }
  }

  const advance = () => {
    if (idx + 1 >= queue.length) {
      void clearSession().catch(() => {})
      setDone({ total: doneCount.current + 1, again: againCount.current, ms: Date.now() - sessionStart.current })
    } else {
      const nextIdx = idx + 1
      setIdx(nextIdx)
      setPhase('front')
      setPicked(null)
      shownAt.current = Date.now()
      void saveSession(queue.map((x) => x.id), nextIdx, doneCount.current, againCount.current).catch(() => {})
    }
  }

  /** 作答（四选一） */
  const pickChoice = (i: number) => {
    if (phase === 'answered' || committing.current || !item) return
    committing.current = true
    const right = i === (choices?.answerIndex ?? 0)
    setPicked(i)
    setPhase('answered')
    if (right) {
      tone('ok')
      buzz(18)
      setConfetti(
        Array.from({ length: 22 }, (_, k) => ({
          left: 4 + ((k * 37) % 92),
          dx: ((k * 53) % 60) - 30,
          rot: 180 + ((k * 71) % 360),
          color: CONFETTI_COLORS[k % CONFETTI_COLORS.length],
          delay: (k % 6) * 0.045,
        }))
      )
    } else {
      tone('no')
      buzz(40)
    }
    void (async () => {
      const ok = await commit(right ? R.Good : R.Again)
      if (!ok) {
        committing.current = false
        return
      }
      if (!right) againCount.current++
      doneCount.current++
      await saveSession(queue.map((x) => x.id), Math.min(idx + 1, queue.length), doneCount.current, againCount.current).catch(() => {})
      committing.current = false
    })()
  }

  /** 自评分（回忆卡） */
  const selfGrade = (g: 1 | 2 | 3 | 4) => {
    if (committing.current || !item) return
    committing.current = true
    tone(g === R.Again ? 'no' : 'ok')
    buzz(g === R.Again ? 30 : 12)
    void (async () => {
      const ok = await commit(g)
      if (!ok) {
        committing.current = false
        return
      }
      if (g === R.Again) againCount.current++
      doneCount.current++
      await saveSession(queue.map((x) => x.id), idx + 1, doneCount.current, againCount.current).catch(() => {})
      committing.current = false
      advance()
    })()
  }

  /** 斩：认识，直接移出计划（暂停该卡 + 按 Easy 记录），立即下一张 */
  const cutCard = () => {
    if (!item || committing.current) return
    committing.current = true
    tone('cut')
    toast.success('已斩 · 不再出现在计划里')
    void (async () => {
      try {
        const db = await getDb()
        await db.execute('UPDATE card SET suspended=1 WHERE id=?', [item.id])
      } catch (e) {
        console.error(e)
      }
      const ok = await commit(R.Easy)
      committing.current = false
      if (!ok) return
      doneCount.current++
      await saveSession(queue.map((x) => x.id), idx + 1, doneCount.current, againCount.current).catch(() => {})
      advance()
    })()
  }

  /** 记录「上一词」条 */
  useEffect(() => {
    if (phase !== 'answered' || !item) return
    if (item.type !== 'word') return
    const sense = parseWordBack(item.back)?.m?.[0]
    if (sense?.t) setPrevCard({ w: item.front, m: `${sense.p ? sense.p + '. ' : ''}${sense.t}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exitFs()
        nav('/today')
        return
      }
      if (!item || done || committing.current) return
      const hasChoices = !!choices
      if (phase === 'front' && e.code === 'Space') {
        e.preventDefault()
        if (hasChoices) return
        setPhase('answered')
        return
      }
      if (e.key === 's' || e.key === 'S') {
        if (item.type === 'word') {
          e.preventDefault()
          speak(item.front)
        }
        return
      }
      if (phase === 'front' && hasChoices && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        pickChoice(Number(e.key) - 1)
        return
      }
      if (phase === 'answered' && !hasChoices && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        selfGrade(Number(e.key) as 1 | 2 | 3 | 4)
        return
      }
      if (phase === 'answered' && hasChoices && (e.key === 'Enter' || e.code === 'Space')) {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, idx, phase, done, choices])

  /* ---------------- 渲染 ---------------- */

  if (loading) {
    return (
      <div className="study" style={{ padding: '40px 22px' }}>
        <div className="skeleton sk-line" style={{ width: 140, height: 22 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 'var(--r-lg)', marginTop: 14 }} />
        <div className="skeleton sk-line" style={{ width: 200, height: 30, marginTop: 18 }} />
      </div>
    )
  }

  if (done || queue.length === 0) {
    const s = done || { total: 0, again: 0, ms: 0 }
    return (
      <div className="study" style={{ padding: '8vh 22px 40px' }}>
        <div className="page-in" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: '3.4rem', lineHeight: 1 }}>🎉</div>
          <div className="page-title" style={{ marginTop: 12 }}>
            {queue.length === 0 && !done ? '暂时没有待学的卡片' : '今日训练完成'}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {queue.length === 0 && !done ? '去词书挑一本开始，或导入教材生成练习卡' : '学习记录已保存，下次打开接着安排'}
          </div>
          {done && (
            <div className="card" style={{ marginTop: 22, display: 'inline-flex', gap: 22, alignItems: 'baseline', padding: '18px 26px' }}>
              <div>
                <div className="display-num" style={{ fontSize: '2rem' }}>{s.total}</div>
                <div className="row-meta">张完成</div>
              </div>
              <div style={{ width: 1, height: 36, background: 'var(--line)' }} />
              <div className="tag">{s.again} 次忘了</div>
              <div className="tag tag-ok">{Math.round(s.ms / 1000)} 秒</div>
            </div>
          )}
          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { exitFs(); nav('/today') }}>
              回到今日
            </button>
            <button className="btn btn-outline" onClick={() => { exitFs(); nav('/stats') }}>
              看看统计
            </button>
            {fs && (
              <button className="btn btn-ghost" onClick={exitFs}>
                退出全屏
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const right = choices?.answerIndex ?? 0
  const isRight = picked === right

  return (
    <div className={`study${fs ? ' review-fs' : ''}`}>
      {/* 顶部：返回 + 上一词 + 进度 + 贴纸 */}
      <div className="study-top">
        <button className="icon-btn" title="退出学习（Esc）" onClick={() => { exitFs(); nav('/today') }}>
          <ArrowLeft size={17} />
        </button>
        <span className="study-top-mid">
          {prevCard ? `${prevCard.w}: ${prevCard.m}` : '暂无上一词'}
        </span>
        {resumed && (
          <span className="tag tag-glass" style={{ marginRight: 8 }} title="从中断处继续">
            已续
          </span>
        )}
        <button className="review-exit" title={fs ? '退出全屏' : '进入全屏'} onClick={() => (fs ? exitFs() : enterFs())} style={{ marginLeft: 0 }}>
          {fs ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      <div style={{ padding: '0 var(--sp-6) var(--sp-2)' }}>
        <Progress value={idx + 1} max={queue.length} label={`学习进度：第 ${idx + 1} / ${queue.length} 张`} />
      </div>
      <div className="study-badge">连对保护</div>

      <div style={{ padding: '0 22px', maxWidth: 560, margin: '0 auto', position: 'relative' }}>
        {/* 答对纸屑 */}
        {confetti.length > 0 && (
          <div className="celebrate">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="confetti"
                style={
                  {
                    left: `${c.left}%`,
                    background: c.color,
                    animationDelay: `${c.delay}s`,
                    '--dx': `${c.dx}px`,
                    '--rot': `${c.rot}deg`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        {/* 媒体记忆卡 */}
        <div className="media-card" style={{ background: `linear-gradient(150deg, ${visual.from}, ${visual.to})` }}>
          <span className="media-letter">{visual.glyph}</span>
          <span className="media-tag">{isWord ? 'WORD' : item.type === 'basic' ? 'RECALL' : item.type === 'why' ? 'WHY' : 'CHOICE'}</span>
          <span className="media-caption">
            {item.course_name} · {item.topic_title}
          </span>
          {picked !== null && isRight && (
            <div className="answer-bubble">
              <b>{item.front}</b>
              <span>{firstSense ? `${firstSense.p ? firstSense.p + '. ' : ''}${firstSense.t}` : '已掌握'}</span>
            </div>
          )}
        </div>

        {/* 单词 / 题干 */}
        {isWord ? (
          <div className="study-word">
            <div className="study-word-text">{item.front}</div>
            <div className="study-phones">
              {wordBack?.uk && <span className="study-phone">美 /{wordBack.us || wordBack.uk}/</span>}
              {wordBack?.uk && wordBack?.us && wordBack.uk !== wordBack.us && <span className="study-phone">英 /{wordBack.uk}/</span>}
              <button className="word-speak" title="朗读 (S)" onClick={() => speak(item.front)}>
                <Volume2 size={15} />
              </button>
            </div>
          </div>
        ) : (
          <div className="study-word">
            <div className="review-front">{item.front}</div>
          </div>
        )}

        {/* 例句 */}
        {wordBack?.s?.[0] && (
          <p className="study-sentence">
            {highlightWord(wordBack.s[0].e, item.front)}
            {showHint && wordBack.s[0].c && <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: '.82rem', marginTop: 4 }}>{wordBack.s[0].c}</span>}
          </p>
        )}

        {/* 四选一 */}
        {choices && (
          <>
            <div className="choice-grid" role="group" aria-label="选择这个单词的正确释义">
              {choices.choices.map((c, i) => {
                const revealed = phase === 'answered'
                const isAnswer = i === right
                const cls = revealed ? (isAnswer ? ' is-right' : i === picked ? ' is-wrong' : ' is-dim') : ''
                return (
                  <button key={i} className={`choice-cell${cls}`} disabled={revealed} onClick={() => pickChoice(i)}>
                    <span className="choice-pos">{c.replace(/\..*$/, '.')}</span>
                    {c.replace(/^[a-z]+\.\s*/i, '')}
                    {revealed && isAnswer && (
                      <span className="choice-tick">
                        <Check size={15} strokeWidth={3} />
                      </span>
                    )}
                    {revealed && i === picked && !isAnswer && (
                      <span className="choice-tick" style={{ background: 'var(--red)' }}>
                        <X size={15} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {phase === 'front' && (
              <div className="review-hint">
                点击选项作答，或按 <kbd>1</kbd>-<kbd>4</kbd>
              </div>
            )}
          </>
        )}

        {/* 回忆卡：先想再看答案 */}
        {!choices && phase === 'front' && (
          <>
            <div className="reveal-row">
              <button className="btn btn-primary btn-lg" onClick={() => setPhase('answered')}>
                显示答案
              </button>
            </div>
            <div className="review-hint">
              先回忆 · <kbd>空格</kbd> 翻面
            </div>
          </>
        )}

        {/* 作答后的详情 */}
        {phase === 'answered' && (
          <div className="fade-up" style={{ marginTop: 18 }}>
            {/* AI 辨析气泡 */}
            {similar && similar.length > 0 && (
              <button
                className="ai-bubble"
                style={{ marginBottom: 12 }}
                onClick={() => {
                  setDetailTab('similar')
                  setShowDetail(true)
                }}
              >
                <span className="ai-mark">Ai</span>
                和 {similar[0].w} 搞混了？帮你辨析
                <span className="spacer" />
                <ArrowRight size={15} style={{ color: 'var(--ink-3)' }} />
              </button>
            )}

            {isWord && wordBack && !showDetail && (
              <div className="detail-card">
                <div className="detail-tabs">
                  {(
                    [
                      ['sense', '释义'],
                      ['sent', '例句'],
                      ['morph', '词根词缀'],
                      ['similar', '形近词'],
                    ] as [DetailTab, string][]
                  ).map(([k, label]) => (
                    <button key={k} className={`detail-tab${detailTab === k ? ' is-active' : ''}`} onClick={() => setDetailTab(k)}>
                      {label}
                    </button>
                  ))}
                </div>
                <WordDetail tab={detailTab} word={item.front} back={wordBack} morph={morph} similar={similar} />
              </div>
            )}

            {!isWord && (
              <>
                <div className="review-back">
                  <span className="muted">Answer</span>
                  {item.back}
                </div>
                <div className="explain-box">
                  <b>Why</b>
                  {item.explanation || '—'}
                </div>
              </>
            )}

            {commitErr && <div className="error-text" style={{ marginTop: 10 }}>{commitErr}</div>}

            {!choices && (
              <div className="grade-row">
                <button className="btn g-again" disabled={committing.current} onClick={() => selfGrade(1)}>
                  忘了<small>1</small>
                </button>
                <button className="btn g-hard" disabled={committing.current} onClick={() => selfGrade(2)}>
                  想起<small>2</small>
                </button>
                <button className="btn g-good" disabled={committing.current} onClick={() => selfGrade(3)}>
                  记得<small>3</small>
                </button>
                <button className="btn g-easy" disabled={committing.current} onClick={() => selfGrade(4)}>
                  秒答<small>4</small>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="action-bar">
        <button className="act" disabled={phase === 'front'} title="上一个（本版仅支持继续）">
          <ArrowLeft size={17} />
          上一词
        </button>
        <button className="act" title="斩：认识，移出计划" onClick={cutCard}>
          <Scissors size={17} />
          斩
        </button>
        <button
          className="act is-mid"
          title="查看词根词缀 / 形近词"
          onClick={() => {
            if (phase === 'front') return
            setShowDetail((v) => !v)
          }}
          disabled={phase === 'front'}
        >
          <Sparkles size={17} />
          Ai
        </button>
        <button className="act" title="提示中文" onClick={() => setShowHint((v) => !v)}>
          <Lightbulb size={17} />
          提示
        </button>
        <button className="act" title="朗读 (S)" onClick={() => speak(item.front)}>
          <Volume2 size={17} />
          朗读
        </button>
        {choices ? (
          <button className="act is-primary" disabled={phase === 'front'} onClick={advance} title="继续 (⏎)">
            继续
            <ArrowRight size={15} />
          </button>
        ) : (
          <button className="act is-primary" disabled={phase === 'front'} onClick={() => selfGrade(3)} title="记得并继续">
            继续
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

/** 例句里高亮目标词 */
function highlightWord(sentence: string, word: string) {
  const parts = sentence.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase().startsWith(word.toLowerCase()) ? <em key={i}>{p}</em> : <span key={i}>{p}</span>
  )
}

/** 详情面板：释义 / 例句 / 词根词缀 / 形近词 */
function WordDetail({
  tab,
  word,
  back,
  morph,
  similar,
}: {
  tab: DetailTab
  word: string
  back: WordBack
  morph: { parts: { text: string; label: string; kind: string }[]; note: string } | null
  similar: { w: string; t: string }[] | null
}) {
  const [sentTab, setSentTab] = useState<'sent' | 'form' | 'more'>('sent')

  if (tab === 'sense') {
    return (
      <div className="detail-panel">
        {(back.m || []).map((m, i) => (
          <div className="sense-row" key={i} style={{ marginTop: i ? 8 : 0 }}>
            {m.p && <i className="sense-pos">{m.p}.</i>}
            <span>{m.t}</span>
          </div>
        ))}
        {!back.m?.length && <div className="muted">暂无释义</div>}
        {back.s?.[0] && (
          <div className="sent-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="sent-en">{highlightWord(back.s[0].e, word)}</div>
            <div className="sent-cn">{back.s[0].c}</div>
          </div>
        )}
      </div>
    )
  }

  if (tab === 'sent') {
    return (
      <div className="detail-panel">
        <div className="mini-tabs">
          {(
            [
              ['sent', '例句'],
              ['form', '变形·派生'],
              ['more', '延展'],
            ] as ['sent' | 'form' | 'more', string][]
          ).map(([k, label]) => (
            <button key={k} className={`mini-tab${sentTab === k ? ' is-active' : ''}`} onClick={() => setSentTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {sentTab === 'sent' &&
          (back.s?.length ? (
            back.s.map((s, i) => (
              <div className="sent-row" key={i}>
                <div className="sent-en">{highlightWord(s.e, word)}</div>
                <div className="sent-cn">{s.c}</div>
              </div>
            ))
          ) : (
            <div className="muted">该词暂无例句数据</div>
          ))}
        {sentTab === 'form' && (
          <div>
            <div className="muted">由词根词缀推导的常见变形（离线推导，供参考）：</div>
            <div className="chip-row">
              {deriveForms(word).map((f) => (
                <span className="chip" key={f}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
        {sentTab === 'more' && (
          <div>
            <div className="muted">搭配与用法提示：</div>
            <div className="chip-row">
              <span className="chip">in {word}</span>
              <span className="chip">{word} of</span>
              <span className="chip">be {word} to</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (tab === 'morph') {
    return (
      <div className="detail-panel">
        {morph ? (
          <>
            <div className="morph-line">
              {morph.parts.map((p, i) => (
                <span key={i} className={`morph-part${p.kind === 'root' ? ' is-root' : p.kind === 'suffix' ? ' is-suffix' : ''}`}>
                  <b>{p.text}</b>
                  <small>{p.label}</small>
                </span>
              ))}
            </div>
            <div className="morph-note">{morph.note}</div>
          </>
        ) : (
          <div className="muted">这个单词没有匹配到离线词根词缀数据。可以试着按音节拆开读几遍，或加入生词本反复见它。</div>
        )}
      </div>
    )
  }

  return (
    <div className="detail-panel">
      {similar === null ? (
        <div className="muted">正在从 14,625 词索引里找形近词…</div>
      ) : similar.length === 0 ? (
        <div className="muted">索引里没有找到编辑距离 ≤2 的形近词，说明这个词拼写比较独特。</div>
      ) : (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>拼写相近，容易看错（编辑距离 ≤ 2）：</div>
          {similar.map((s) => (
            <div className="sense-row" key={s.w} style={{ marginTop: 7 }}>
              <b style={{ minWidth: 92 }}>{s.w}</b>
              <span style={{ color: 'var(--ink-2)' }}>{s.t || '—'}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/** 由词形推导常见变形（离线启发式，供「变形·派生」tab 展示） */
function deriveForms(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>()
  if (w.endsWith('e')) {
    out.add(w + 'd')
    out.add(w.slice(0, -1) + 'ing')
  } else if (/[^aeiou][aeiou][^aeiouy]$/.test(w)) {
    out.add(w + w.slice(-1) + 'ed')
    out.add(w + w.slice(-1) + 'ing')
  } else {
    out.add(w + 'ed')
    out.add(w + 'ing')
  }
  out.add(w + 's')
  if (w.endsWith('y')) out.add(w.slice(0, -1) + 'ies')
  if (w.endsWith('e')) out.add(w.slice(0, -1) + 'er')
  else out.add(w + 'er')
  return [...out].filter((x) => x !== w).slice(0, 8)
}
