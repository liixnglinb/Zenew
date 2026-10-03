// 训练页：/vocab/:key/train/:mode
// 五种训练模式（速听 / 速刷 / 单词选义 / 拼写 / 听写）+ 听写设置面板。
// 评分与斩词完全沿用学习页的写库方式（见 train.ts 的 commitTrainCard / suspendCard）。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  Eye,
  Headphones,
  Image,
  Lightbulb,
  ListChecks,
  Pause,
  PenLine,
  Play,
  Scissors,
  Settings,
  Star,
  Volume2,
  X,
  Zap,
} from 'lucide-react'
import { nowIso, saveSession, type QueueItem } from '../db'
import { buildWordChoices, tone, buzz, wordVisual, type ChoiceSet } from '../study'
import { Button, IconButton, Progress, Switch, Tag, useToast } from '../ui'
import { BottomSheet } from '../ui/overlays'
import { useHotkeys } from '../ui/desktop'
import {
  GRADE,
  MODE_META,
  TRAIN_MODES,
  bookNameOf,
  clearTrainSession,
  commitTrainCard,
  isStarred,
  isTrainMode,
  judgeSpelling,
  loadDictation,
  loadStarred,
  loadTrainQueue,
  loadTrainSession,
  parseWordBack,
  playSchedule,
  saveDictation,
  saveTrainSession,
  senseText,
  speakWord,
  stopSpeaking,
  suspendCard,
  toggleStarred,
  trainLimit,
  type DictationSettings,
  type TrainGrade,
  type TrainMode,
} from '../train'
import '../train.css'

type Phase = 'typing' | 'answered' | 'done'
type DockMode = TrainMode | 'dock'

const MODE_ICON: Record<TrainMode, ReactNode> = {
  listen: <Headphones size={24} aria-hidden />,
  rush: <Zap size={24} aria-hidden />,
  choice: <ListChecks size={24} aria-hidden />,
  spell: <PenLine size={24} aria-hidden />,
  dictation: <AudioLines size={24} aria-hidden />,
}

const MODE_ORDER: Record<TrainMode, string> = { listen: '', rush: 'is-alt', choice: '', spell: 'is-warm', dictation: 'is-alt' }

export default function Train() {
  const { key = '', mode = 'dock' } = useParams()
  const nav = useNavigate()
  const toast = useToast()

  const activeMode: DockMode = isTrainMode(mode) ? mode : 'dock'
  const bookName = key ? bookNameOf(key) : ''

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [ready, setReady] = useState(false)
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('typing')
  const [picked, setPicked] = useState<number | null>(null)
  const [choices, setChoices] = useState<ChoiceSet | null>(null)
  const [input, setInput] = useState('')
  const [answer, setAnswer] = useState('')
  const [hintCount, setHintCount] = useState(0)
  const [revealSense, setRevealSense] = useState(false)
  const [showMedia, setShowMedia] = useState(true)
  const [paused, setPaused] = useState(false)
  const [finished, setFinished] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [commitErr, setCommitErr] = useState('')
  const [starred, setStarred] = useState<string[]>([])
  const [dict, setDict] = useState<DictationSettings>(() => loadDictation())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [playStep, setPlayStep] = useState(0)
  const [autoPlaying, setAutoPlaying] = useState(false)
  const [playToken, setPlayToken] = useState(0)
  const [playBusy, setPlayBusy] = useState(false)
  /** 听写是否已开始（开始前显示「准备好笔纸，开始听写」入口） */
  const [dictStarted, setDictStarted] = useState(false)

  const committing = useRef(false)
  const shownAt = useRef(Date.now())
  const doneIds = useRef<Set<number>>(new Set())
  const timers = useRef<number[]>([])
  const panelRef = useRef<HTMLDivElement | null>(null)

  const item = queue[idx]
  const total = queue.length
  const back = useMemo(() => (item ? parseWordBack(item.back) : null), [item])
  const sense = item ? senseText(item.back) : ''
  const visual = useMemo(() => wordVisual(item?.front || 'A'), [item?.front])
  const prevItem = idx > 0 ? queue[idx - 1] : null
  const prevSense = prevItem ? senseText(prevItem.back) : ''
  const isLast = idx + 1 >= total
  const isStar = !!item && isStarred(item.front, starred)

  /* ---------------- 载入队列 ---------------- */
  useEffect(() => {
    if (activeMode === 'dock') {
      setReady(true)
      return
    }
    if (!bookName) {
      nav('/vocab')
      return
    }
    let cancelled = false
    setReady(false)
    setFinished(false)
    setQueue([])
    setIdx(0)
    setPhase('typing')
    committing.current = false
    doneIds.current = new Set()
    void (async () => {
      try {
        const saved = await loadTrainSession(activeMode).catch(() => null)
        let q: QueueItem[] = []
        if (saved && saved.card_ids.length) {
          const all = await loadTrainQueue({
            courseName: bookName,
            limit: trainLimit(activeMode),
            shuffled: activeMode === 'rush' || activeMode === 'listen',
          })
          const byId = new Map(all.map((x) => [x.id, x]))
          q = saved.card_ids.map((id) => byId.get(id)).filter((x): x is QueueItem => !!x)
        }
        if (!q.length) {
          q = await loadTrainQueue({
            courseName: bookName,
            limit: trainLimit(activeMode),
            shuffled: activeMode === 'rush' || activeMode === 'listen',
          })
          if (cancelled) return
          setQueue(q)
          setIdx(0)
          setResumed(false)
        } else {
          if (cancelled) return
          setQueue(q)
          setIdx(Math.min(saved?.idx ?? 0, q.length - 1))
          setResumed(true)
        }
        if (!cancelled && q.length) {
          shownAt.current = Date.now()
          void saveSession(
            q.map((x) => x.id),
            0
          ).catch(() => {})
        }
      } catch (e) {
        console.error('训练队列载入失败', e)
        toast.error('训练内容载入失败，请返回词书页重试')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, bookName, nav])

  /* ---------------- 收藏 ---------------- */
  useEffect(() => {
    setStarred(loadStarred())
    setDict(loadDictation())
  }, [])

  /* ---------------- 换词：重置阶段态、生成选项 ---------------- */
  useEffect(() => {
    if (activeMode === 'dock' || !item) return
    setPhase('typing')
    setPicked(null)
    setInput('')
    setAnswer('')
    setHintCount(0)
    setRevealSense(false)
    setCommitErr('')
    setPlayStep(0)
    setDictStarted(activeMode !== 'dictation')
    shownAt.current = Date.now()
    const first = parseWordBack(item.back)?.m?.[0]
    if (first?.t) {
      buildWordChoices(item.id, item.course_name, first)
        .then(setChoices)
        .catch(() => setChoices(null))
    } else {
      setChoices(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, activeMode])

  /* ---------------- 退出时停掉朗读 / 定时器 ---------------- */
  useEffect(() => {
    return () => {
      stopSpeaking()
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [])

  /* ---------------- 进度条 ---------------- */
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    el.scrollTop = 0
  }, [phase, item?.id])

  /* ---------------- 提交（与学习页同一套写库方式） ---------------- */
  const commit = useCallback(
    async (grade: TrainGrade): Promise<boolean> => {
      if (!item || committing.current) return false
      committing.current = true
      const res = await commitTrainCard(item.id, grade, item.st, Date.now() - shownAt.current, nowIso())
      committing.current = false
      if (!res.ok) {
        setCommitErr(res.error || '保存失败，请重试')
        return false
      }
      setCommitErr('')
      return true
    },
    [item]
  )

  const goNext = useCallback(() => {
    if (isLast) {
      setFinished(true)
      void clearTrainSession().catch(() => {})
      return
    }
    const next = idx + 1
    setIdx(next)
    setPhase('typing')
    shownAt.current = Date.now()
    void saveTrainSession(
      queue.map((x) => x.id),
      next,
      activeMode === 'dock' ? 'rush' : activeMode
    ).catch(() => {})
  }, [idx, isLast, queue, activeMode])

  /** 回看上一词（←）：只在还没作答时允许，避免打乱本次记录 */
  const goPrev = useCallback(() => {
    if (phase !== 'typing' || idx <= 0) return
    setIdx(idx - 1)
    setPhase('typing')
    shownAt.current = Date.now()
  }, [idx, phase])

  /** 评分并推进（学习页语义：认识=Good 模糊=Hard 不认识=Again 斩=Easy+暂停） */
  const gradeAndNext = useCallback(
    (grade: TrainGrade, autoAdvance: boolean) => {
      void (async () => {
        const ok = await commit(grade)
        if (!ok || !item) return
        doneIds.current.add(item.id)
        tone(grade === GRADE.again ? 'no' : 'ok')
        buzz(grade === GRADE.again ? 30 : 12)
        if (autoAdvance) goNext()
      })()
    },
    [commit, goNext, item]
  )

  /** 斩：暂停该卡 + 按 Easy 记录，立即下一张 */
  const cutCard = useCallback(() => {
    if (!item || committing.current) return
    committing.current = true
    const target = item
    tone('cut')
    toast.success('已斩 · 不再出现在计划里')
    void (async () => {
      await suspendCard(target.id)
      committing.current = false
      const ok = await commit(GRADE.easy)
      if (!ok) return
      doneIds.current.add(target.id)
      goNext()
    })()
  }, [commit, goNext, item, toast])

  /* ---------------- 选义 ---------------- */
  const pickChoice = (i: number) => {
    if (phase === 'answered' || committing.current) return
    const right = i === (choices?.answerIndex ?? -1)
    setPicked(i)
    setPhase('answered')
    if (right) {
      tone('ok')
      buzz(18)
    } else {
      tone('no')
      buzz(40)
    }
    void (async () => {
      const ok = await commit(right ? GRADE.good : GRADE.again)
      if (!ok || !item) return
      doneIds.current.add(item.id)
    })()
  }

  const dontKnow = () => {
    if (phase === 'answered' || committing.current) return
    setPicked(-1)
    setPhase('answered')
    tone('no')
    buzz(40)
    void (async () => {
      const ok = await commit(GRADE.again)
      if (!ok || !item) return
      doneIds.current.add(item.id)
    })()
  }

  /* ---------------- 拼写 / 听写 判定 ---------------- */
  const submitSpelling = (source: 'spell' | 'dictation') => {
    if (phase === 'answered' || !item) return
    const typed = input.trim()
    if (!typed) {
      toast.info('先写下你记得的拼写')
      return
    }
    const verdict = judgeSpelling(typed, item.front)
    setAnswer(typed)
    setPhase('answered')
    if (verdict.correct) {
      tone('ok')
      buzz(18)
    } else {
      tone('no')
      buzz(40)
    }
    void (async () => {
      const ok = await commit(verdict.correct ? GRADE.good : GRADE.again)
      if (!ok || !item) return
      doneIds.current.add(item.id)
      const autoNext = source === 'spell' ? false : dict.autoNext
      if (autoNext) {
        window.setTimeout(() => goNext(), 900)
      }
    })()
  }

  const revealNext = () => {
    const n = Math.min(item ? item.front.length : 0, hintCount + 1)
    setHintCount(n)
  }

  /* ---------------- 速听：自动循环朗读 ---------------- */
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  const playWord = useCallback(
    (times: number, intervalSec: number, accent: 'us' | 'uk', rate = 0) => {
      if (!item) return
      clearTimers()
      stopSpeaking()
      setAutoPlaying(true)
      setPlayBusy(true)
      const delays = playSchedule(times, intervalSec / speed)
      delays.forEach((delay, i) => {
        const t = window.setTimeout(() => {
          speakWord(item.front, accent, rate || speed)
          setPlayStep(i + 1)
          if (i === delays.length - 1) {
            setPlayBusy(false)
            window.setTimeout(() => setAutoPlaying(false), 400)
          }
        }, delay)
        timers.current.push(t)
      })
    },
    [item, speed]
  )

  /** 按当前听写设置播一轮（三种模式共用） */
  const playCycle = useCallback(() => {
    playWord(dict.plays, dict.interval, dict.accent)
  }, [playWord, dict.plays, dict.interval, dict.accent])

  /** 立刻重播一轮（同时推进 token，让自动播放的 effect 重新触发） */
  const replay = () => {
    playCycle()
    setPlayToken((v) => v + 1)
  }

  const stopPlay = () => {
    clearTimers()
    stopSpeaking()
    setAutoPlaying(false)
    setPlayBusy(false)
  }

  /* 速听：换词 / 点播放 / 改遍数 都会重放一轮 */
  useEffect(() => {
    if (activeMode !== 'listen' || !item || paused) return
    playCycle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, item?.id, playToken, dict.plays, dict.interval, dict.accent, paused, speed])

  /* 速听：整轮读完按「自动下一词」推进 */
  useEffect(() => {
    if (activeMode !== 'listen' || paused || autoPlaying) return
    if (!dict.autoNext) return
    if (playStep < dict.plays) return
    const t = window.setTimeout(() => goNext(), 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, paused, autoPlaying, playStep, dict.plays, dict.autoNext, idx])

  /* ---------------- 听写：按设置播放 ---------------- */
  useEffect(() => {
    if (activeMode !== 'dictation' || !dictStarted) return
    if (dict.prompt !== 'audio' || !item || paused) return
    playCycle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, dictStarted, dict.prompt, item?.id, playToken, dict.plays, dict.interval, dict.accent, paused, speed])

  /* ---------------- 选义答对后自动下一题 ---------------- */
  useEffect(() => {
    if (activeMode !== 'choice' || phase !== 'answered') return
    if (picked === null || picked < 0) return
    if (!choices) return
    if (picked !== choices.answerIndex) return
    const t = window.setTimeout(() => goNext(), 950)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, phase, picked, choices])

  /* ---------------- 键盘 ---------------- */
  const hotkeys = useMemo(
    () => ({
      arrowleft: () => {
        if (phase !== 'typing') return
        if (idx > 0) goPrev()
        else if (prevSense) toast.info(`${prevItem?.front ?? ''}：${prevSense}`)
      },
      arrowright: () => {
        if (phase !== 'typing') goNext()
      },
      space: () => {
        if (activeMode === 'rush') {
          if (phase === 'typing') setRevealSense(true)
          else goNext()
          return
        }
        if (!item) return
        if (paused) {
          setPaused(false)
          return
        }
        playCycle()
      },
      p: () => {
        if (item) speakWord(item.front, dict.accent, speed)
      },
      s: () => cutCard(),
      escape: () => {
        stopPlay()
        nav(`/vocab/${key}/words`)
      },
      ...(activeMode === 'rush'
        ? {
            '1': () => gradeAndNext(GRADE.again, true),
            '2': () => gradeAndNext(GRADE.hard, true),
            '3': () => gradeAndNext(GRADE.good, true),
          }
        : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeMode, phase, item?.id, paused, prevSense, prevItem?.front, dict.plays, dict.interval, dict.accent, key, idx, goPrev, playCycle, speed]
  )
  useHotkeys(hotkeys)

  /* ---------------- 小操作 ---------------- */
  const toggleStar = () => {
    if (!item) return
    const next = toggleStarred(item.front)
    setStarred(next)
    toast.success(next.includes(item.front) ? '已收藏到生词本' : '已取消收藏')
  }

  const openSheet = () => setSheetOpen(true)
  const patchDict = (patch: Partial<DictationSettings>) => setDict(saveDictation(patch))

  const startDictation = () => {
    setSheetOpen(false)
    setDictStarted(true)
    setPhase('typing')
    setPaused(false)
    setPlayToken((v) => v + 1)
  }

  /* ---------------- 渲染：训练坞 ---------------- */
  if (activeMode === 'dock') {
    return (
      <div className="train">
        <div className="train-body">
          <div className="train-dock-head">
            <button className="btn btn-ghost btn-sm" onClick={() => nav(`/vocab/${key}/words`)}>
              <ArrowLeft size={14} aria-hidden /> 返回单词列表
            </button>
            <div className="train-dock-title" style={{ marginTop: 'var(--sp-4)' }}>
              训练模式
            </div>
          </div>
          <div className="train-dock-grid" role="list">
            {TRAIN_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="listitem"
                className={`train-dock-card ${MODE_ORDER[m]}`}
                onClick={() => nav(`/vocab/${key}/train/${m}`)}
              >
                <span className="train-dock-icon">{MODE_ICON[m]}</span>
                <span className="train-dock-body">
                  <span className="train-dock-name">{MODE_META[m].label}</span>
                  <span className="train-dock-desc">{MODE_META[m].desc}</span>
                </span>
                <span className="train-dock-go">
                  <ArrowRight size={18} aria-hidden />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- 渲染：载入中 ---------------- */
  if (!ready) {
    return (
      <div className="train">
        <div className="train-body" style={{ paddingTop: 'var(--sp-6)' }}>
          <div className="skeleton sk-line" style={{ width: 160, height: 20 }} />
          <div className="skeleton" style={{ height: 240, borderRadius: 'var(--r-xl)', marginTop: 'var(--sp-4)' }} />
          <div className="skeleton sk-line" style={{ width: 220, height: 28, marginTop: 'var(--sp-4)' }} />
        </div>
      </div>
    )
  }

  /* ---------------- 渲染：空态 / 结束态 ---------------- */
  if ((!total || finished) && activeMode !== 'dictation') {
    return (
      <div className="train">
        <div className="train-body">
          <div className="train-empty">
            <div className="train-empty-art">{total ? '🎉' : '📭'}</div>
            <div className="train-empty-title">{total ? `${MODE_META[activeMode].label}完成` : '这本书暂时没有可训练的词'}</div>
            <div className="train-empty-desc">
              {total
                ? `本组 ${total} 词已全部过完，成绩已写入记忆曲线`
                : '先去词库导入词书，或在查词页把生词收进生词本'}
            </div>
            {total > 0 && (
              <div className="train-summary">
                <div>
                  <b className="tnum">{total}</b>
                  <span>张完成</span>
                </div>
                <div>
                  <b className="tnum">{doneIds.current.size}</b>
                  <span>张计入曲线</span>
                </div>
              </div>
            )}
            <div className="train-empty-actions">
              <Button
                variant="primary"
                icon={<ArrowLeft size={15} aria-hidden />}
                onClick={() => nav(`/vocab/${key}/words`)}
              >
                返回单词列表（选其它模式）
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const meta = MODE_META[activeMode]

  return (
    <div className="train">
      {/* 顶部：返回 + 进度 + 上一词释义 + ⭐ */}
      <div className="train-top">
        <IconButton label="返回单词列表（Esc）" onClick={() => nav(`/vocab/${key}/words`)}>
          <ArrowLeft size={17} aria-hidden />
        </IconButton>
        <div className="train-top-mid">
          <span className="train-count">
            {idx + 1}/{total || 1}
            <small> · {meta.label}</small>
          </span>
          <button className="train-prev" onClick={() => prevSense && toast.info(`${prevItem?.front ?? ''}：${prevSense}`)}>
            {prevItem && prevSense ? (
              <>
                上一词 · <em>{prevItem.front}</em> {prevSense}
              </>
            ) : (
              '暂无上一词'
            )}
          </button>
          {resumed && (
            <Tag tone="success" className="tag-mono" title="从上次中断处继续">
              已续
            </Tag>
          )}
        </div>
        <div className="train-top-acts">
          <button
            type="button"
            className={`train-star${isStar ? ' is-on' : ''}`}
            aria-label={isStar ? '取消收藏' : '收藏到生词本'}
            aria-pressed={isStar}
            onClick={toggleStar}
          >
            <Star size={17} fill={isStar ? 'currentColor' : 'none'} aria-hidden />
          </button>
          <IconButton label="听写设置" onClick={openSheet}>
            <Settings size={17} aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="train-body" ref={panelRef}>
        <Progress value={idx + 1} max={total || 1} label={`${meta.label}进度：第 ${idx + 1} / ${total} 张`} />

        <div className="train-meta" style={{ marginTop: 'var(--sp-3)' }}>
          <Tag tone="neutral">{MODE_META[activeMode].label}</Tag>
          <span className="row-meta">
            {item?.course_name} · {item?.topic_title}
          </span>
        </div>

        {/* ---------- 速听 ---------- */}
        {activeMode === 'listen' && item && (
          <>
            <div className={`train-media-wrap${showMedia ? '' : ' is-hidden'}`}>
              {showMedia ? (
                <div className="media-card" style={{ background: `linear-gradient(150deg, ${visual.from}, ${visual.to})` }}>
                  <span className="media-letter">{visual.glyph}</span>
                  <span className="media-tag">LISTEN</span>
                  <span className="media-caption">
                    {item.course_name} · {item.topic_title}
                  </span>
                </div>
              ) : (
                <div className="train-rush-card">
                  <div className="train-rush-word">{item.front}</div>
                </div>
              )}
            </div>
            <div className="study-word">
              <div className="study-word-text">{item.front}</div>
              <div className="study-phones">
                {back?.us && <span className="study-phone">美 /{back.us}/</span>}
                {back?.uk && back.uk !== back.us && <span className="study-phone">英 /{back.uk}/</span>}
              </div>
            </div>
            <div className="train-listen-ctl">
              <button
                type="button"
                className={`train-play${autoPlaying ? ' is-playing' : ''}`}
                onClick={() => (autoPlaying || playBusy ? stopPlay() : replay())}
              >
                {autoPlaying || playBusy ? <Pause size={26} aria-hidden /> : <Play size={26} aria-hidden />}
                <span className="train-play-sub">{autoPlaying || playBusy ? '停 止' : '播 放'}</span>
              </button>
              <div className="train-play-bar">
                <div className="train-bar-track">
                  <span style={{ width: `${Math.min(100, (playStep / Math.max(1, dict.plays)) * 100)}%` }} />
                </div>
                <div className="train-spell-hint" style={{ textAlign: 'center', marginTop: 6 }}>
                  已播 {playStep}/{dict.plays} 次 · 间隔 {dict.interval} 秒
                </div>
              </div>
            </div>
            <div className="train-speed">
              <button type="button" className={paused ? 'is-on' : ''} onClick={() => setPaused((v) => !v)}>
                {paused ? '继续播放' : '暂停播放'}
              </button>
              <button type="button" className={dict.autoNext ? 'is-on' : ''} onClick={() => patchDict({ autoNext: !dict.autoNext })}>
                自动下一词{dict.autoNext ? '：开' : '：关'}
              </button>
              {([0.75, 1, 1.25] as const).map((s) => (
                <button key={s} type="button" className={speed === s ? 'is-on' : ''} onClick={() => setSpeed(s)} title={`播放速度 ${s}x`}>
                  {s}x
                </button>
              ))}
              <button type="button" onClick={replay}>
                再听一遍
              </button>
            </div>
            <div className="train-sense">
              {sense}
              <small>{revealSense ? '' : '先听声音，努力回想意思'}</small>
            </div>
            <div className="train-rush-actions" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <button className="train-g-good" onClick={() => gradeAndNext(GRADE.good, true)}>
                认识<small>Good</small>
              </button>
              <button className="train-g-again" onClick={() => gradeAndNext(GRADE.again, true)}>
                不认识<small>Again</small>
              </button>
              <button className="train-g-cut" onClick={cutCard}>
                斩<small>S</small>
              </button>
            </div>
            <div className="review-hint">
              <kbd>空格</kbd> 播放 / 暂停 · <kbd>P</kbd> 重听 · <kbd>→</kbd> 下一个
            </div>
          </>
        )}

        {/* ---------- 速刷 ---------- */}
        {activeMode === 'rush' && item && (
          <>
            <div className="train-rush-card">
              <div className="train-rush-word">{item.front}</div>
              <div className="train-rush-phone">{back?.us ? `美 /${back.us}/` : back?.uk ? `英 /${back.uk}/` : ''}</div>
              {revealSense ? (
                <div className="train-rush-sense">{sense}</div>
              ) : (
                <button type="button" className="train-hidden-sense" style={{ marginTop: 'var(--sp-4)' }} onClick={() => setRevealSense(true)}>
                  <Eye size={14} aria-hidden /> 点这里看释义（空格）
                </button>
              )}
            </div>
            <div className="train-rush-actions">
              <button className="train-g-good" onClick={() => gradeAndNext(GRADE.good, true)}>
                认识<small>1</small>
              </button>
              <button className="train-g-hard" onClick={() => gradeAndNext(GRADE.hard, true)}>
                模糊<small>2</small>
              </button>
              <button className="train-g-again" onClick={() => gradeAndNext(GRADE.again, true)}>
                不认识<small>3</small>
              </button>
              <button className="train-g-cut" onClick={cutCard}>
                斩<small>S</small>
              </button>
            </div>
            <div className="review-hint">
              <kbd>1</kbd> 认识 · <kbd>2</kbd> 模糊 · <kbd>3</kbd> 不认识 · <kbd>空格</kbd> 看释义
            </div>
          </>
        )}

        {/* ---------- 单词选义 ---------- */}
        {activeMode === 'choice' && item && (
          <>
            {showMedia && (
              <div className="media-card" style={{ background: `linear-gradient(150deg, ${visual.from}, ${visual.to})` }}>
                <span className="media-letter">{visual.glyph}</span>
                <span className="media-tag">WORD</span>
                <span className="media-caption">
                  {item.course_name} · {item.topic_title}
                </span>
              </div>
            )}
            <div className="study-word">
              <div className="study-word-text">{item.front}</div>
              <div className="study-phones">
                {back?.us && <span className="study-phone">美 /{back.us}/</span>}
                {back?.uk && back.uk !== back.us && <span className="study-phone">英 /{back.uk}/</span>}
                <button className="word-speak" title="朗读 (P)" onClick={() => speakWord(item.front, dict.accent)}>
                  <Volume2 size={15} aria-hidden />
                </button>
              </div>
            </div>
            {choices ? (
              <>
                <div className="choice-grid" role="group" aria-label="选择这个单词的正确释义">
                  {choices.choices.map((c, i) => {
                    const revealed = phase === 'answered'
                    const isAnswer = i === choices.answerIndex
                    const posMatch = /^([a-z]+)\.\s*/i.exec(c)
                    const pos = posMatch ? `${posMatch[1]}.` : ''
                    const text = posMatch ? c.slice(posMatch[0].length) : c
                    const cls = revealed ? (isAnswer ? ' is-right' : i === picked ? ' is-wrong' : ' is-dim') : ''
                    return (
                      <button key={i} type="button" className={`choice-cell${cls}`} disabled={revealed} onClick={() => pickChoice(i)}>
                        {pos && <span className="choice-pos">{pos}</span>}
                        <span>{text}</span>
                        {revealed && isAnswer && (
                          <span className="choice-tick">
                            <Check size={15} strokeWidth={3} aria-hidden />
                          </span>
                        )}
                        {revealed && i === picked && !isAnswer && (
                          <span className="choice-tick" style={{ background: 'var(--coral)' }}>
                            <X size={15} strokeWidth={3} aria-hidden />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <button type="button" className="train-unknown" disabled={phase === 'answered'} onClick={dontKnow}>
                  我不认识，直接看答案
                </button>
              </>
            ) : (
              <div className="train-sense">
                {sense}
                <small>这本书的释义样本不足，为您直接展示释义</small>
              </div>
            )}
            {phase === 'answered' && (
              <div className={`train-feedback ${picked === choices?.answerIndex ? 'is-ok' : 'is-no'}`}>
                {picked === choices?.answerIndex ? (
                  <>
                    <b>答对了</b>
                    <span className="train-answer">
                      {item.front} · {sense}
                    </span>
                  </>
                ) : (
                  <>
                    <b>答错了，正确答案是</b>
                    <span className="train-answer">{sense}</span>
                  </>
                )}
              </div>
            )}
            {phase === 'typing' && (
              <div className="review-hint">
                按 <kbd>1</kbd>-<kbd>4</kbd> 作答
              </div>
            )}
          </>
        )}

        {/* ---------- 拼写 / 听写 ---------- */}
        {(activeMode === 'spell' || activeMode === 'dictation') && item && (
          <>
            {activeMode === 'dictation' && !dictStarted ? (
              <div className="train-dictation-start">
                <div className="train-dictation-art">✍️</div>
                <div className="train-dictation-title">准备好笔纸，开始听写</div>
                <div className="train-dictation-rows">
                  <div className="train-dictation-row">
                    <span>听写方式</span>
                    <b>{dict.prompt === 'audio' ? '听发音·写单词/释义' : '听释义·写单词'}</b>
                  </div>
                  <div className="train-dictation-row">
                    <span>单词发音</span>
                    <b>{dict.accent === 'us' ? '美音 en-US' : '英音 en-GB'}</b>
                  </div>
                  <div className="train-dictation-row">
                    <span>播放次数 / 间隔</span>
                    <b>
                      {dict.plays} 次 · {dict.interval} 秒
                    </b>
                  </div>
                  <div className="train-dictation-row">
                    <span>自动播放下一词</span>
                    <b>{dict.autoNext ? '已开启' : '已关闭'}</b>
                  </div>
                </div>
                <div className="train-dictation-actions">
                  <Button variant="outline" icon={<Settings size={15} aria-hidden />} onClick={openSheet}>
                    听写设置
                  </Button>
                  <Button variant="primary" size="lg" icon={<AudioLines size={16} aria-hidden />} onClick={startDictation}>
                    开始听写
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {showMedia && activeMode === 'spell' && (
                  <div className="media-card" style={{ background: `linear-gradient(150deg, ${visual.from}, ${visual.to})` }}>
                    <span className="media-letter">{visual.glyph}</span>
                    <span className="media-tag">SPELL</span>
                    <span className="media-caption">
                      {item.course_name} · {item.topic_title}
                    </span>
                  </div>
                )}
                {activeMode === 'dictation' && dict.prompt === 'audio' && (
                  <div className="train-listen-ctl">
                    <button
                      type="button"
                      className={`train-play is-sm${autoPlaying || playBusy ? ' is-playing' : ''}`}
                      onClick={replay}
                      title="再播一遍发音"
                    >
                      <Volume2 size={22} aria-hidden />
                      <span className="train-play-sub">再 播</span>
                    </button>
                    <div className="train-play-bar">
                      <div className="train-bar-track">
                        <span style={{ width: `${Math.min(100, (playStep / Math.max(1, dict.plays)) * 100)}%` }} />
                      </div>
                      <div className="train-spell-hint" style={{ textAlign: 'center', marginTop: 6 }}>
                        已播 {playStep}/{dict.plays} 次 · 间隔 {dict.interval} 秒
                      </div>
                    </div>
                  </div>
                )}
                <div className="train-sense">
                  {dict.prompt === 'meaning' || activeMode === 'spell' ? sense : '听发音，写出这个单词'}
                  <small>{activeMode === 'spell' ? '按提示拼出英文单词' : '写完按 Enter 判定'}</small>
                </div>
                <div className="train-spell">
                  <input
                    className={`train-input${phase === 'answered' ? ' is-locked' : ''}`}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (phase === 'typing') submitSpelling(activeMode === 'spell' ? 'spell' : 'dictation')
                        else if (activeMode === 'spell' || !dict.autoNext) goNext()
                        return
                      }
                      if (e.key === 'Tab' && phase === 'typing') {
                        e.preventDefault()
                        revealNext()
                      }
                    }}
                    placeholder={phase === 'answered' ? item.front : '在这里拼写单词…'}
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="拼写单词"
                    readOnly={phase === 'answered'}
                  />
                  <div className="train-charline" aria-live="polite">
                    {phase === 'typing'
                      ? Array.from(input).map((ch, i) => (
                          <span key={i} className="train-ch">
                            {ch}
                          </span>
                        ))
                      : Array.from(item.front).map((ch, i) => (
                          <span key={i} className={`train-ch is-${i < answer.length ? (answer[i]?.toLowerCase() === ch.toLowerCase() ? 'ok' : 'bad') : 'gap'}`}>
                            {ch}
                          </span>
                        ))}
                    {phase === 'typing' && <span className="train-caret" aria-hidden />}
                  </div>
                  {hintCount > 0 && phase === 'typing' && (
                    <div style={{ textAlign: 'center', marginTop: 'var(--sp-2)' }}>
                      <span className="train-hint-chars">
                        {Array.from(item.front).map((ch, i) => (
                          <span key={i}>{i < hintCount ? ch : <i>·</i>}</span>
                        ))}
                      </span>
                    </div>
                  )}
                  <div className="train-spell-foot">
                    <span className="train-spell-hint">
                      {phase === 'answered' ? (
                        <>
                          正确拼写：<b>{item.front}</b>
                        </>
                      ) : (
                        <>
                          <kbd>Enter</kbd> 判定 · <kbd>Tab</kbd> 提示下一个字母
                        </>
                      )}
                    </span>
                    <span className="train-spell-btns">
                      {phase === 'typing' ? (
                        <>
                          <Button variant="ghost" size="sm" icon={<Lightbulb size={14} aria-hidden />} onClick={revealNext}>
                            提示
                          </Button>
                          <Button variant="primary" size="sm" onClick={() => submitSpelling(activeMode === 'spell' ? 'spell' : 'dictation')}>
                            判定
                          </Button>
                        </>
                      ) : (
                        <Button variant="primary" size="sm" iconRight={<ArrowRight size={14} aria-hidden />} onClick={goNext}>
                          下一词
                        </Button>
                      )}
                    </span>
                  </div>
                  {phase === 'answered' && (
                    <div className={`train-feedback ${answer.toLowerCase() === item.front.toLowerCase() ? 'is-ok' : 'is-no'}`}>
                      {answer.toLowerCase() === item.front.toLowerCase() ? (
                        <>
                          <b>完全正确</b>
                          <span className="train-answer">
                            {item.front} · {sense}
                          </span>
                        </>
                      ) : (
                        <>
                          <b>{judgeSpelling(answer, item.front).message}</b>
                          <span className="train-answer">
                            {item.front} · {sense}
                          </span>
                          <span style={{ display: 'block', marginTop: 4 }}>你写的是：{answer || '（空）'}</span>
                        </>
                      )}
                    </div>
                  )}
                  {phase === 'answered' && (
                    <div className="train-rush-actions" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                      <button className="train-g-good" onClick={() => gradeAndNext(GRADE.good, true)}>
                        认识<small>Good</small>
                      </button>
                      <button className="train-g-again" onClick={() => gradeAndNext(GRADE.again, true)}>
                        不认识<small>Again</small>
                      </button>
                      <button className="train-g-cut" onClick={cutCard}>
                        斩<small>S</small>
                      </button>
                    </div>
                  )}
                  {commitErr && <div className="error-text">{commitErr}</div>}
                </div>
                {phase === 'typing' && (
                  <div className="review-hint">
                    <kbd>Tab</kbd> 补字母 · <kbd>P</kbd> 重听 · <kbd>S</kbd> 斩
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* 底部工具条：设置 / 图片 / 斩 / 提示 / 朗读 */}
      <div className="action-bar">
        <button className="act" title="听写设置" onClick={openSheet}>
          <Settings size={17} aria-hidden />
          设置
        </button>
        <button className="act" title="显示 / 隐藏图卡" onClick={() => setShowMedia((v) => !v)}>
          {showMedia ? <Eye size={17} aria-hidden /> : <Image size={17} aria-hidden />}
          {showMedia ? '藏图' : '图片'}
        </button>
        <button className="act" title="斩：认识，移出计划 (S)" onClick={cutCard}>
          <Scissors size={17} aria-hidden />
          斩
        </button>
        <button
          className="act"
          title="提示"
          onClick={() => {
            if (activeMode === 'spell' || activeMode === 'dictation') revealNext()
            else setRevealSense(true)
          }}
        >
          <Lightbulb size={17} aria-hidden />
          提示
        </button>
        <button className="act is-mid" title="朗读 (P)" onClick={() => item && speakWord(item.front, dict.accent, speed)}>
          <Volume2 size={17} aria-hidden />
          朗读
        </button>
        <button
          className="act"
          title={activeMode === 'listen' || activeMode === 'dictation' ? '播放发音' : '播放 / 重听'}
          onClick={() => {
            if (paused) {
              setPaused(false)
              return
            }
            playCycle()
          }}
        >
          <Play size={17} aria-hidden />
          播放
        </button>
        {phase === 'answered' ? (
          <button className="act is-primary" onClick={goNext} title="继续 (→)">
            继续
            <ArrowRight size={15} aria-hidden />
          </button>
        ) : (
          <button className="act is-primary" onClick={() => setRevealSense(true)} title="显示释义">
            看释义
            <Eye size={15} aria-hidden />
          </button>
        )}
      </div>

      {/* 听写设置面板 */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={<span className="train-sheet-title">听写设置</span>}
      >
        <div className="train-field">
          <span className="train-field-label">听写方式</span>
          <div className="train-opts is-two">
            <button
              type="button"
              className={`train-opt is-lg${dict.prompt === 'audio' ? ' is-on' : ''}`}
              aria-pressed={dict.prompt === 'audio'}
              onClick={() => patchDict({ prompt: 'audio' })}
            >
              <Volume2 size={20} aria-hidden />
              <span className="train-opt-title">听发音·写单词/释义</span>
            </button>
            <button
              type="button"
              className={`train-opt is-lg${dict.prompt === 'meaning' ? ' is-on' : ''}`}
              aria-pressed={dict.prompt === 'meaning'}
              onClick={() => patchDict({ prompt: 'meaning' })}
            >
              <ListChecks size={20} aria-hidden />
              <span className="train-opt-title">听释义·写单词</span>
            </button>
          </div>
        </div>

        <div className="train-field">
          <span className="train-field-label">单词发音</span>
          <div className="train-opts is-two">
            <button
              type="button"
              className={`train-opt is-center${dict.accent === 'us' ? ' is-on' : ''}`}
              aria-pressed={dict.accent === 'us'}
              onClick={() => {
                patchDict({ accent: 'us' })
                setPlayToken((v) => v + 1)
              }}
            >
              <span className="train-opt-num">美音</span>
            </button>
            <button
              type="button"
              className={`train-opt is-center${dict.accent === 'uk' ? ' is-on' : ''}`}
              aria-pressed={dict.accent === 'uk'}
              onClick={() => {
                patchDict({ accent: 'uk' })
                setPlayToken((v) => v + 1)
              }}
            >
              <span className="train-opt-num">英音</span>
            </button>
          </div>
        </div>

        <div className="train-field">
          <span className="train-field-label">播放次数</span>
          <div className="train-opts is-four">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`train-opt is-center${dict.plays === n ? ' is-on' : ''}`}
                aria-pressed={dict.plays === n}
                onClick={() => {
                  patchDict({ plays: n })
                  setPlayToken((v) => v + 1)
                }}
              >
                <span className="train-opt-num">{n} 次</span>
              </button>
            ))}
          </div>
        </div>

        <div className="train-field">
          <span className="train-field-label">播放间隔</span>
          <div className="train-opts is-four">
            {([2, 4, 6, 8] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`train-opt is-center${dict.interval === n ? ' is-on' : ''}`}
                aria-pressed={dict.interval === n}
                onClick={() => {
                  patchDict({ interval: n })
                  setPlayToken((v) => v + 1)
                }}
              >
                <span className="train-opt-num">{n} 秒</span>
              </button>
            ))}
          </div>
        </div>

        <div className="train-switch-row">
          <span className="train-switch-text">
            <b>自动播放下一词</b>
          </span>
          <Switch checked={dict.autoNext} onChange={(v) => patchDict({ autoNext: v })} label="自动播放下一词" />
        </div>

        <button type="button" className="train-sheet-cta" onClick={startDictation}>
          <AudioLines size={18} aria-hidden />
          准备好笔纸，开始听写
        </button>
        <div className="train-spell-hint" style={{ textAlign: 'center', marginTop: 'var(--sp-2)' }}>
          当前设置：{dict.prompt === 'audio' ? '听发音·写单词/释义' : '听释义·写单词'} · {dict.accent === 'us' ? '美音' : '英音'} · {dict.plays} 次 ·{' '}
          {dict.interval} 秒 · 自动下一词{dict.autoNext ? '开' : '关'}
        </div>
      </BottomSheet>
    </div>
  )
}
