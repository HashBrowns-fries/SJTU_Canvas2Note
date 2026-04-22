import { useEffect, useState } from 'react'
import { api } from '../api'
import { pushToast } from './Toast'
import type { Course } from '../types'
import type { VideoItem, VideoPlay, PptSlideSet } from '../api'

function fmtDur(sec: number) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtDate(iso: string) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  } catch {
    return iso
  }
}

interface BatchItem {
  video_id: string
  title: string
  status: string
  error?: string
}

interface Props {
  course: Course
  onTranscribed: () => void
  batchTaskId: string | null
  batchItems: BatchItem[]
  batchDone: number
  batchTotal: number
  batchCurrent: string
  onBatchStart: (args: { task_id: string; items: BatchItem[] }) => void
}

export function VideosTab({
  course, onTranscribed,
  batchTaskId, batchItems, batchDone, batchTotal, batchCurrent,
  onBatchStart,
}: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [transcribing, setTranscribing] = useState<Set<string>>(new Set())
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [transcribed, setTranscribed] = useState<Set<string>>(new Set())
  const [playSelector, setPlaySelector] = useState<{ video: VideoItem; plays: VideoPlay[] } | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Map<string, { processed: number; total: number }>>(new Map())

  // PPT slides
  const [slideSets, setSlideSets] = useState<PptSlideSet[]>([])
  const [slideBrowser, setSlideBrowser] = useState<PptSlideSet | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [pptDownloading, setPptDownloading] = useState<Set<string>>(new Set())
  const [pptDownloaded, setPptDownloaded] = useState<Set<string>>(new Set())

  // Batch selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const isBatchActive = batchTaskId !== null

  useEffect(() => {
    setLoading(true)
    setError('')
    api.videoList(course.id)
      .then(v => { setVideos(v); setLoading(false) })
      .catch(e => {
        setError(e.message || '无法获取视频列表')
        setLoading(false)
      })
    api.downloads().then(files => {
      const downloaded = new Set<string>()
      files.filter((f: any) => f.is_video).forEach((f: any) => {
        downloaded.add(f.name)
        downloaded.add(f.name.replace('_录屏', ''))
        if (!f.name.includes('_录屏')) {
          downloaded.add(f.name.replace('.mp4', '_录屏.mp4'))
        }
      })
      setDownloaded(downloaded)
    }).catch(() => {})
    api.transcriptions().then(trs => {
      const transcribed = new Set<string>()
      trs.filter((t: any) => t.course === course.name).forEach((t: any) => {
        const stem = t.name.split('/').pop() || ''
        transcribed.add(stem)
      })
      setTranscribed(transcribed)
    }).catch(() => {})
    // Load existing PPT slide sets
    api.pptSlidesList(course.name).then(sets => {
      setSlideSets(sets)
      const downloaded = new Set<string>()
      sets.forEach(s => downloaded.add(s.title))
      setPptDownloaded(downloaded)
    }).catch(() => {})
  }, [course.id])

  function isDownloaded(v: VideoItem) {
    const title = v.title || ''
    const normalized = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').toLowerCase()
    const vidKey = normalized(title)
    const stemKey = vidKey.replace('_录屏', '')
    return [...downloaded].some(n => {
      const downloadedKey = normalized(n)
      const dlStem = downloadedKey.replace('_录屏', '')
      // Both are short lecture numbers — exact match
      if (vidKey.length < 8 && downloadedKey.length < 8) {
        return vidKey === dlStem || stemKey === dlStem || stemKey === downloadedKey
      }
      // One or both include course name
      return downloadedKey.includes(vidKey)
          || vidKey.includes(downloadedKey)
          || dlStem.includes(stemKey)
          || stemKey.includes(dlStem)
    })
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function selectAll() {
    setSelected(new Set(videos.filter(v => !isDownloaded(v)).map(v => v.id)))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  async function doDownload(v: VideoItem, playIndex: number) {
    setPlaySelector(null)
    setDownloading(p => new Set(p).add(v.id))
    try {
      const { task_id } = await api.videoDownload({
        course_id: course.id,
        course_name: course.name,
        video_id: v.id,
        title: v.title,
        play_index: playIndex,
      })
      pushToast({ type: 'info', message: `下载中: ${v.title}` })
      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.progress != null && t.total != null) {
          setDownloadProgress(p => new Map(p).set(v.id, { processed: t.progress, total: t.total as number }))
        }
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: `✓ 已保存: ${v.title}` })
          setDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
          setDownloaded(p => {
            const n = new Set(p)
            const base = v.title.replace(/[^a-zA-Z0-9 ._\u4e00-\u9fff-]/g, '_').trim()
            n.add(`${base}.mp4`)
            n.add(`${base}_录屏.mp4`)
            return n
          })
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `✗ ${v.title}: ${t.error}` })
          setDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: '下载请求失败' })
      setDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
    }
  }

  async function download(v: VideoItem) {
    if (isDownloaded(v)) {
      pushToast({ type: 'info', message: `已在: ${v.title}` })
      return
    }
    try {
      const plays = await api.videoPlays(v.id, course.id, v.title)
      if (plays.length <= 1) {
        void doDownload(v, -1)
      } else {
        setPlaySelector({ video: v, plays })
      }
    } catch {
      pushToast({ type: 'error', message: '获取视频片段失败' })
    }
  }

  async function transcribe(v: VideoItem) {
    const downloads = await api.downloads().catch(() => [])
    const title = v.title || ''
    const normalized = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').toLowerCase()
    const vidKey = normalized(title)
    const videoFile = downloads.find((d: any) =>
      d.is_video && (
        (normalized(d.name).includes(vidKey) && vidKey.length >= 8)
        || normalized(d.name.replace('_录屏', '')).includes(vidKey.replace('_录屏', ''))
      )
    )
    if (!videoFile) {
      pushToast({ type: 'error', message: '请先下载视频，再进行转录' })
      return
    }
    setTranscribing(p => new Set(p).add(v.id))
    try {
      const { task_id } = await api.transcribe(videoFile.path, course.name)
      pushToast({ type: 'info', message: `转录中: ${v.title}` })
      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: '✓ 转录完成' })
          setTranscribing(p => { const n = new Set(p); n.delete(v.id); return n })
          const stem = (v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()
          setTranscribed(p => new Set(p).add(stem))
          onTranscribed()
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `ASR 失败: ${t.error}` })
          setTranscribing(p => { const n = new Set(p); n.delete(v.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: '转录请求失败' })
      setTranscribing(p => { const n = new Set(p); n.delete(v.id); return n })
    }
  }

  // ── PPT slides ───────────────────────────────────────────────────────────────

  async function downloadPpt(v: VideoItem) {
    if (!v.cour_id) { pushToast({ type: 'error', message: '无 cour_id，无法下载 PPT' }); return }
    if (pptDownloading.has(v.id)) return
    setPptDownloading(p => new Set(p).add(v.id))
    try {
      const { task_id } = await api.pptDownload({
        course_name: course.name,
        video_title: v.title,
        cour_id: v.cour_id,
        course_id: course.id,
      })
      pushToast({ type: 'info', message: `PPT 下载中: ${v.title}` })
      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: `✓ PPT 已保存: ${v.title}` })
          setPptDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
          const stem = (v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()
          setPptDownloaded(p => new Set(p).add(stem))
          // Refresh slide list
          api.pptSlidesList(course.name).then(setSlideSets).catch(() => {})
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `PPT 失败: ${t.error}` })
          setPptDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: 'PPT 下载请求失败' })
      setPptDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
    }
  }

  function openSlideBrowser(title: string) {
    const found = slideSets.find(s => s.title.replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim() === title.replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim())
      || slideSets.find(s => s.title.includes(title) || title.includes(s.title))
    if (found) setSlideBrowser(found)
    else pushToast({ type: 'info', message: '请先下载 PPT 幻灯片' })
  }

  // ── Batch transcribe ────────────────────────────────────────────────────────

  async function startBatchTranscribe() {
    if (selected.size === 0) return
    const items = videos
      .filter(v => selected.has(v.id))
      .map(v => ({
        course_id: course.id,
        course_name: course.name,
        video_id: v.id,
        title: v.title || '',
        play_index: -1,
      }))
    try {
      const { task_id } = await api.batchTranscribe(items)
      const batchItems: BatchItem[] = items.map(i => ({
        video_id: i.video_id, title: i.title, status: 'pending',
      }))
      onBatchStart({ task_id, items: batchItems })
      setSelected(new Set())
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `批量操作启动失败: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // Map batch items to video id → status for quick lookup
  const batchStatusMap = Object.fromEntries(
    batchItems.map(b => [b.video_id, b])
  )

  if (loading) return <ListSkeleton />
  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <span className="text-5xl opacity-20">◎</span>
      <div>
        <p className="font-mono text-sm text-[var(--text-muted)] mb-2">未登录或无录屏权限</p>
        <p className="font-mono text-xs text-[var(--text-muted)] opacity-60">{error}</p>
      </div>
    </div>
  )

  if (!videos.length) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
      <span className="text-4xl opacity-30">◻</span>
      <p className="font-mono text-sm">本课程暂无课堂录屏</p>
    </div>
  )

  return (
    <div className="h-full overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 py-3 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] flex-wrap">
        <span className="font-mono text-xs font-bold text-[var(--text)]">{course.name}</span>
        <span className="font-mono text-xs text-[var(--text-muted)]">· {videos.length} 个录屏</span>
        <span className="font-mono text-xs px-2 py-0.5 bg-[var(--green-bg)] text-[var(--green)] rounded border border-[var(--green)]/20">v.sjtu.edu.cn</span>

        {/* Batch controls */}
        <div className="flex items-center gap-2 ml-auto">
          {selected.size > 0 && (
            <span className="font-mono text-xs text-[var(--green)]">{selected.size} 已选</span>
          )}
          <button
            onClick={selectAll}
            className="font-mono text-xs px-2.5 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
          >
            全选
          </button>
          {selected.size > 0 && (
            <>
              <button
                onClick={deselectAll}
                className="font-mono text-xs px-2.5 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
              >
                取消
              </button>
              <button
                disabled={isBatchActive}
                onClick={startBatchTranscribe}
                className="font-mono text-xs px-3 py-1 rounded border border-[var(--rust)]/40 text-[var(--rust)] hover:bg-[var(--rust)]/10 disabled:opacity-40 transition-all"
              >
                ↓◎ 批量转录
              </button>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-6 py-2 w-8">
              <input type="checkbox" className="accent-[var(--green)]"
                checked={selected.size === videos.filter(v => !isDownloaded(v)).length && selected.size > 0}
                onChange={e => e.target.checked ? selectAll() : deselectAll()}
              />
            </th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-0 py-2 w-8">#</th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-4 py-2">标题 / 上课时间</th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-4 py-2 w-20 hidden sm:table-cell">时长</th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-4 py-2 w-48">操作</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v, i) => {
            const dlBusy = downloading.has(v.id)
            const trBusy = transcribing.has(v.id)
            const isDl = isDownloaded(v)
            const isSel = selected.has(v.id)
            const isTrs = transcribed.has(v.title?.replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim())
            const batchInfo = batchStatusMap[v.id]
            const batchStatus = batchInfo?.status

            // Determine overall row status
            let rowStatus: 'idle' | 'downloading' | 'transcribing' | 'done' | 'error' = 'idle'
            if (batchStatus === 'downloading') rowStatus = 'downloading'
            if (batchStatus === 'transcribing') rowStatus = 'transcribing'
            if (batchStatus === 'done') rowStatus = 'done'
            if (batchStatus === 'error') rowStatus = 'error'

            return (
              <tr
                key={v.id}
                className={`border-b border-[var(--border)]/50 group transition-colors animate-fade-in ${
                  isSel ? 'bg-[var(--green)]/5' : 'hover:bg-[var(--surface2)]/50'
                }`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <td className="px-6 py-3 align-middle">
                  <input type="checkbox" className="accent-[var(--green)]"
                    checked={isSel}
                    disabled={rowStatus !== 'idle'}
                    onChange={() => toggleSelect(v.id)}
                  />
                </td>
                <td className="font-mono text-xs text-[var(--text-muted)] px-0 pl-1 py-3 align-middle">
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td className="px-4 py-3 align-middle">
                  <p className="text-sm text-[var(--text)] leading-snug group-hover:text-[var(--green)] transition-colors">
                    {v.title || '（无标题）'}
                  </p>
                  <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                    {fmtDate(v.courseBeginTime || '')}
                  </p>
                  {batchInfo?.error && (
                    <p className="font-mono text-xs text-[var(--rust)] mt-0.5">{batchInfo.error}</p>
                  )}
                </td>
                <td className="px-4 py-3 align-middle hidden sm:table-cell">
                  <span className="font-mono text-xs text-[var(--text-muted)]">{fmtDur(v.duration)}</span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="flex gap-1.5 flex-wrap">
                    {/* Row status indicator */}
                    {rowStatus === 'downloading' && (() => {
                      const prog = downloadProgress.get(v.id)
                      const pct = prog && prog.total > 0 ? Math.round(prog.processed / prog.total * 100) : 0
                      const mb = prog ? `(${(prog.processed/1024**2).toFixed(0)}/${(prog.total/1024**2).toFixed(0)}MB)` : ''
                      return prog ? (
                        <div className="flex flex-col gap-1 min-w-[120px]">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-[var(--green)]/70">↓ {pct}%</span>
                            <span className="font-mono text-xs text-[var(--text-muted)] opacity-60">{mb}</span>
                          </div>
                          <div className="h-1 bg-[var(--border)] rounded-full overflow-hidden">
                            <div className="h-full bg-[var(--green)]/50 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono text-xs px-2.5 py-1 border border-[var(--green)]/30 text-[var(--green)]/70 rounded animate-pulse">↓</span>
                      )
                    })()}
                    {rowStatus === 'transcribing' && (
                      <span className="font-mono text-xs px-2.5 py-1 border border-[var(--moss)]/30 text-[var(--moss)]/70 rounded animate-pulse">◎</span>
                    )}
                    {rowStatus === 'done' && (
                      <span className="font-mono text-xs px-2.5 py-1 border border-[var(--moss)]/30 text-[var(--moss)] rounded">✓</span>
                    )}
                    {rowStatus === 'error' && (
                      <span className="font-mono text-xs px-2.5 py-1 border border-[var(--rust)]/30 text-[var(--rust)] rounded">✗</span>
                    )}
                    {rowStatus === 'idle' && (
                      <>
                        {isDl ? (
                          isTrs ? (
                            <span className="font-mono text-xs px-2.5 py-1 border border-[var(--moss)]/30 text-[var(--moss)]/60 rounded">已有</span>
                          ) : (
                            <button
                              disabled={trBusy}
                              onClick={() => transcribe(v)}
                              className={`font-mono text-xs px-2.5 py-1 rounded border transition-all ${
                                trBusy
                                  ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                                  : 'border-[var(--moss)]/30 text-[var(--moss)] hover:bg-[var(--moss)]/10'
                              }`}
                            >
                              {trBusy ? '⟳' : '◎'}
                            </button>
                          )
                        ) : (
                          <button
                            disabled={dlBusy}
                            onClick={() => download(v)}
                            className={`font-mono text-xs px-2.5 py-1 rounded border transition-all ${
                              dlBusy
                                ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                                : 'border-[var(--green)]/30 text-[var(--green)] hover:bg-[var(--green)]/10'
                            }`}
                          >
                            {dlBusy ? '…' : '↓'}
                          </button>
                        )}
                        {!isDl && (
                          <button
                            disabled={trBusy}
                            onClick={() => transcribe(v)}
                            className={`font-mono text-xs px-2.5 py-1 rounded border transition-all ${
                              trBusy
                                ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                                : 'border-[var(--moss)]/30 text-[var(--moss)] hover:bg-[var(--moss)]/10'
                            }`}
                          >
                            {trBusy ? '⟳' : '◎'}
                          </button>
                        )}
                        {/* PPT slides button */}
                        {pptDownloaded.has((v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()) ? (
                          <button
                            onClick={() => openSlideBrowser(v.title || '')}
                            className="font-mono text-xs px-2.5 py-1 rounded border border-violet-400/30 text-violet-400 hover:bg-violet-400/10 transition-all"
                            title="浏览幻灯片"
                          >
                            ◧
                          </button>
                        ) : (
                          <button
                            disabled={pptDownloading.has(v.id)}
                            onClick={() => downloadPpt(v)}
                            className={`font-mono text-xs px-2.5 py-1 rounded border transition-all ${
                              pptDownloading.has(v.id)
                                ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                                : 'border-violet-400/30 text-violet-400/70 hover:bg-violet-400/10'
                            }`}
                            title="下载 PPT 幻灯片"
                          >
                            {pptDownloading.has(v.id) ? '…' : '◧'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Play selector modal */}
      {playSelector && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setPlaySelector(null)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl w-80 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface2)]">
              <p className="font-mono text-xs text-[var(--text-muted)] tracking-widest">选择下载轨道</p>
              <p className="font-sans text-sm text-[var(--text)] mt-1 truncate">{playSelector.video.title}</p>
            </div>
            <div className="py-2">
              {playSelector.plays.map(play => (
                <button
                  key={play.index}
                  onClick={() => doDownload(playSelector.video, play.index)}
                  className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-[var(--surface2)] transition-colors"
                >
                  <span className={`font-mono text-xs w-14 shrink-0 px-2 py-0.5 rounded border ${
                    play.index === 0 ? 'border-[var(--green)]/30 text-[var(--green)] bg-[var(--green)]/5' : 'border-[var(--moss)]/30 text-[var(--moss)] bg-[var(--moss-bg)]'
                  }`}>
                    {play.index === 0 ? '主屏' : '录屏'}
                  </span>
                  <span className="font-sans text-xs text-[var(--text)]">
                    {play.index === 0 ? '教室黑板 / PPT 主屏幕' : '电脑屏幕录屏'}
                  </span>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface2)]">
              <button
                onClick={() => setPlaySelector(null)}
                className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Slide browser modal */}
      {slideBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setSlideBrowser(null)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
            style={{ width: 'min(900px, 95vw)', height: 'min(700px, 90vh)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-3 shrink-0 bg-[var(--surface2)]">
              <span className="font-mono text-xs text-violet-400">◧</span>
              <span className="font-mono text-xs text-[var(--text)] flex-1 truncate">{slideBrowser.title}</span>
              <span className="font-mono text-xs text-[var(--text-muted)]">{slideIndex + 1} / {slideBrowser.count}</span>
              <button
                onClick={() => setSlideBrowser(null)}
                className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)] ml-2"
              >✕</button>
            </div>
            {/* Image */}
            <div className="flex-1 overflow-hidden flex items-center justify-center bg-[#111] p-4">
              <img
                key={slideIndex}
                src={`/api/slides/${encodeURIComponent(slideBrowser.course)}/${encodeURIComponent(slideBrowser.title)}/${encodeURIComponent(slideBrowser.images[slideIndex])}`}
                alt={`Slide ${slideIndex + 1}`}
                className="max-h-full max-w-full object-contain rounded"
                style={{ animation: 'fadeIn 0.15s ease' }}
              />
            </div>
            {/* Controls */}
            <div className="px-5 py-3 border-t border-[var(--border)] flex items-center gap-3 shrink-0 bg-[var(--surface2)]">
              <button
                disabled={slideIndex === 0}
                onClick={() => setSlideIndex(i => i - 1)}
                className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 transition-all"
              >←</button>
              <div className="flex gap-1 flex-1 justify-center overflow-x-auto max-w-0 flex-auto">
                {slideBrowser.images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSlideIndex(i)}
                    className={`shrink-0 w-10 h-7 rounded border text-xs font-mono transition-all ${
                      i === slideIndex
                        ? 'border-violet-400/60 bg-violet-400/10 text-violet-400'
                        : 'border-[var(--border)]/40 text-[var(--text-muted)]/50 hover:border-[var(--border)] hover:text-[var(--text-muted)]'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <button
                disabled={slideIndex === slideBrowser.count - 1}
                onClick={() => setSlideIndex(i => i + 1)}
                className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 transition-all"
              >→</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="p-6 space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-4 border-b border-[var(--border)]/30">
          <div className="w-6 h-4 bg-[var(--surface2)] rounded animate-pulse" />
          <div className="w-6 h-4 bg-[var(--surface2)] rounded animate-pulse" />
          <div className="flex-1 h-4 bg-[var(--surface2)] rounded animate-pulse" style={{ width: `${70 - i * 5}%` }} />
          <div className="w-12 h-4 bg-[var(--surface2)] rounded animate-pulse hidden sm:block" />
          <div className="w-16 h-6 bg-[var(--surface2)] rounded animate-pulse" />
        </div>
      ))}
    </div>
  )
}
