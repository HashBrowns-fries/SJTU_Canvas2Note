import { useEffect, useState } from 'react'
import { Download, Mic, Check, X, Loader2, ChevronLeft, ChevronRight, LayoutPanelLeft, Play } from 'lucide-react'
import { api } from '../api'
import { pushToast } from './Toast'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Progress } from './ui/Progress'
import { Skeleton } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
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
  } catch { return iso }
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
        setError(e.message || 'Cannot fetch video list')
        setLoading(false)
      })
    api.downloads().then(files => {
      const dl = new Set<string>()
      files.filter((f: any) => f.is_video).forEach((f: any) => {
        dl.add(f.name)
        dl.add(f.name.replace('_录屏', ''))
        if (!f.name.includes('_录屏')) dl.add(f.name.replace('.mp4', '_录屏.mp4'))
      })
      setDownloaded(dl)
    }).catch(() => {})
    api.transcriptions().then(trs => {
      const tr = new Set<string>()
      trs.filter((t: any) => t.course === course.name).forEach((t: any) => {
        const stem = t.name.split('/').pop() || ''
        tr.add(stem)
      })
      setTranscribed(tr)
    }).catch(() => {})
    api.pptSlidesList(course.name).then(sets => {
      setSlideSets(sets)
      const dl = new Set<string>()
      sets.forEach(s => dl.add(s.title))
      setPptDownloaded(dl)
    }).catch(() => {})
  }, [course.id])

  function isDownloaded(v: VideoItem) {
    const title = v.title || ''
    const normalized = (s: string) => s.replace(/[^a-zA-Z0-9一-鿿]/g, '').toLowerCase()
    const vidKey = normalized(title)
    const stemKey = vidKey.replace('_录屏', '')
    return [...downloaded].some(n => {
      const dlKey = normalized(n)
      const dlStem = dlKey.replace('_录屏', '')
      if (vidKey.length < 8 && dlKey.length < 8) return vidKey === dlStem || stemKey === dlStem || stemKey === dlKey
      return dlKey.includes(vidKey) || vidKey.includes(dlKey) || dlStem.includes(stemKey) || stemKey.includes(dlStem)
    })
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function selectAll() {
    setSelected(new Set(videos.filter(v => !isDownloaded(v)).map(v => v.id)))
  }

  function deselectAll() { setSelected(new Set()) }

  async function doDownload(v: VideoItem, playIndex: number) {
    setPlaySelector(null)
    setDownloading(p => new Set(p).add(v.id))
    try {
      const { task_id } = await api.videoDownload({
        course_id: course.id, course_name: course.name,
        video_id: v.id, title: v.title, play_index: playIndex,
      })
      pushToast({ type: 'info', message: `Downloading: ${v.title}` })
      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.progress != null && t.total != null) {
          setDownloadProgress(p => new Map(p).set(v.id, { processed: t.progress, total: t.total as number }))
        }
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: `${v.title}` })
          setDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
          setDownloaded(p => {
            const n = new Set(p); const base = v.title.replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()
            n.add(`${base}.mp4`); n.add(`${base}_录屏.mp4`); return n
          })
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `${v.title}: ${t.error}` })
          setDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: 'Download request failed' })
      setDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
    }
  }

  async function download(v: VideoItem) {
    if (isDownloaded(v)) { pushToast({ type: 'info', message: `Already downloaded: ${v.title}` }); return }
    try {
      const plays = await api.videoPlays(v.id, course.id, v.title)
      plays.length <= 1 ? doDownload(v, -1) : setPlaySelector({ video: v, plays })
    } catch {
      pushToast({ type: 'error', message: 'Failed to get video plays' })
    }
  }

  async function transcribe(v: VideoItem) {
    const downloads = await api.downloads().catch(() => [])
    const title = v.title || ''
    const normalized = (s: string) => s.replace(/[^a-zA-Z0-9一-鿿]/g, '').toLowerCase()
    const vidKey = normalized(title)
    const videoFile = downloads.find((d: any) =>
      d.is_video && (
        (normalized(d.name).includes(vidKey) && vidKey.length >= 8)
        || normalized(d.name.replace('_录屏', '')).includes(vidKey.replace('_录屏', ''))
      )
    )
    if (!videoFile) { pushToast({ type: 'error', message: 'Download the video first' }); return }
    setTranscribing(p => new Set(p).add(v.id))
    try {
      const { task_id } = await api.transcribe(videoFile.path, course.name)
      pushToast({ type: 'info', message: `Transcribing: ${v.title}` })
      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: 'Transcription done' })
          setTranscribing(p => { const n = new Set(p); n.delete(v.id); return n })
          const stem = (v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()
          setTranscribed(p => new Set(p).add(stem))
          onTranscribed()
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `ASR failed: ${t.error}` })
          setTranscribing(p => { const n = new Set(p); n.delete(v.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: 'Transcription request failed' })
      setTranscribing(p => { const n = new Set(p); n.delete(v.id); return n })
    }
  }

  async function downloadPpt(v: VideoItem) {
    if (!v.cour_id) { pushToast({ type: 'error', message: 'No cour_id' }); return }
    if (pptDownloading.has(v.id)) return
    setPptDownloading(p => new Set(p).add(v.id))
    try {
      const { task_id } = await api.pptDownload({
        course_name: course.name, video_title: v.title,
        cour_id: v.cour_id, course_id: course.id,
      })
      pushToast({ type: 'info', message: `PPT downloading: ${v.title}` })
      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: `PPT saved: ${v.title}` })
          setPptDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
          const stem = (v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()
          setPptDownloaded(p => new Set(p).add(stem))
          api.pptSlidesList(course.name).then(setSlideSets).catch(() => {})
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `PPT failed: ${t.error}` })
          setPptDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: 'PPT download request failed' })
      setPptDownloading(p => { const n = new Set(p); n.delete(v.id); return n })
    }
  }

  function openSlideBrowser(title: string) {
    const found = slideSets.find(s => s.title.replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim() === title.replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim())
      || slideSets.find(s => s.title.includes(title) || title.includes(s.title))
    if (found) setSlideBrowser(found)
    else pushToast({ type: 'info', message: 'Download PPT slides first' })
  }

  async function startBatchTranscribe() {
    if (selected.size === 0) return
    const items = videos
      .filter(v => selected.has(v.id))
      .map(v => ({
        course_id: course.id, course_name: course.name,
        video_id: v.id, title: v.title || '', play_index: -1,
      }))
    try {
      const { task_id } = await api.batchTranscribe(items)
      const bi: BatchItem[] = items.map(i => ({ video_id: i.video_id, title: i.title, status: 'pending' }))
      onBatchStart({ task_id, items: bi })
      setSelected(new Set())
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Batch failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const batchStatusMap = Object.fromEntries(batchItems.map(b => [b.video_id, b]))

  if (loading) return <div className="p-6"><Skeleton lines={10} /></div>

  if (error) return (
    <EmptyState icon={Mic} title="Not logged in or no access" description={error} />
  )

  if (!videos.length) return (
    <EmptyState icon={Play} title="No recordings for this course" description="No classroom recordings available" />
  )

  return (
    <div className="h-full overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-bg flex-wrap">
        <span className="font-mono text-xs font-bold text-text">{course.name}</span>
        <span className="font-mono text-xs text-muted">· {videos.length} recordings</span>
        <Badge>v.sjtu.edu.cn</Badge>

        <div className="flex items-center gap-2 ml-auto">
          {selected.size > 0 && <span className="font-mono text-xs text-brand">{selected.size} selected</span>}
          <Button variant="secondary" size="sm" onClick={selectAll}>Select all</Button>
          {selected.size > 0 && (
            <>
              <Button variant="secondary" size="sm" onClick={deselectAll}>Clear</Button>
              <Button variant="danger" size="sm" disabled={isBatchActive} onClick={startBatchTranscribe}>
                <Download size={12} /><Mic size={12} /> Batch transcribe
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Desktop table */}
      <table className="w-full hidden md:table">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left font-mono text-xs text-muted px-6 py-2 w-8">
              <input type="checkbox" className="accent-brand"
                checked={selected.size === videos.filter(v => !isDownloaded(v)).length && selected.size > 0}
                onChange={e => e.target.checked ? selectAll() : deselectAll()} />
            </th>
            <th className="text-left font-mono text-xs text-muted px-0 py-2 w-8">#</th>
            <th className="text-left font-mono text-xs text-muted px-4 py-2">Title / Time</th>
            <th className="text-left font-mono text-xs text-muted px-4 py-2 w-20 hidden sm:table-cell">Duration</th>
            <th className="text-left font-mono text-xs text-muted px-4 py-2 w-48">Actions</th>
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

            let rowStatus: 'idle' | 'downloading' | 'transcribing' | 'done' | 'error' = 'idle'
            if (batchStatus === 'downloading') rowStatus = 'downloading'
            if (batchStatus === 'transcribing') rowStatus = 'transcribing'
            if (batchStatus === 'done') rowStatus = 'done'
            if (batchStatus === 'error') rowStatus = 'error'

            return (
              <tr
                key={v.id}
                className={`border-b border-border/50 group transition-colors animate-fade-in ${
                  isSel ? 'bg-brand/5' : 'hover:bg-surface2/50'
                }`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <td className="px-6 py-3 align-middle">
                  <input type="checkbox" className="accent-brand"
                    checked={isSel} disabled={rowStatus !== 'idle'}
                    onChange={() => toggleSelect(v.id)} />
                </td>
                <td className="font-mono text-xs text-muted px-0 pl-1 py-3 align-middle">{String(i + 1).padStart(2, '0')}</td>
                <td className="px-4 py-3 align-middle">
                  <p className="text-sm text-text leading-snug group-hover:text-brand transition-colors">{v.title || '(no title)'}</p>
                  <p className="font-mono text-xs text-muted mt-0.5">{fmtDate(v.courseBeginTime || '')}</p>
                  {batchInfo?.error && <p className="font-mono text-xs text-error mt-0.5">{batchInfo.error}</p>}
                </td>
                <td className="px-4 py-3 align-middle hidden sm:table-cell">
                  <span className="font-mono text-xs text-muted">{fmtDur(v.duration)}</span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="flex gap-1.5 flex-wrap">
                    {rowStatus === 'downloading' && (() => {
                      const prog = downloadProgress.get(v.id)
                      const pct = prog && prog.total > 0 ? Math.round(prog.processed / prog.total * 100) : 0
                      const mb = prog ? `(${(prog.processed/1024**2).toFixed(0)}/${(prog.total/1024**2).toFixed(0)}MB)` : ''
                      return prog ? (
                        <div className="flex flex-col gap-1 min-w-[120px]">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-brand/70"><Download size={10} className="inline" /> {pct}%</span>
                            <span className="font-mono text-xs text-muted/60">{mb}</span>
                          </div>
                          <Progress value={pct} />
                        </div>
                      ) : (
                        <span className="font-mono text-xs px-2.5 py-1 border border-brand/30 text-brand/70 rounded animate-pulse"><Download size={10} className="inline" /></span>
                      )
                    })()}
                    {rowStatus === 'transcribing' && (
                      <span className="font-mono text-xs px-2.5 py-1 border border-accent/30 text-accent/70 rounded animate-pulse"><Mic size={10} className="inline" /></span>
                    )}
                    {rowStatus === 'done' && (
                      <span className="font-mono text-xs px-2.5 py-1 border border-accent/30 text-accent rounded"><Check size={10} className="inline" /></span>
                    )}
                    {rowStatus === 'error' && (
                      <span className="font-mono text-xs px-2.5 py-1 border border-error/30 text-error rounded"><X size={10} className="inline" /></span>
                    )}
                    {rowStatus === 'idle' && (
                      <>
                        {isDl ? (isTrs ? (
                          <Badge variant="success">Ready</Badge>
                        ) : (
                          <Button variant="secondary" size="sm" disabled={trBusy} onClick={() => transcribe(v)}>
                            {trBusy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
                          </Button>
                        )) : (
                          <Button variant="primary" size="sm" disabled={dlBusy} onClick={() => download(v)}>
                            {dlBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                          </Button>
                        )}
                        {!isDl && (
                          <Button variant="ghost" size="sm" disabled={trBusy} onClick={() => transcribe(v)}>
                            <Mic size={12} />
                          </Button>
                        )}
                        {pptDownloaded.has((v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()) ? (
                          <Button variant="ghost" size="sm" onClick={() => openSlideBrowser(v.title || '')} title="View slides">
                            <LayoutPanelLeft size={12} />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" disabled={pptDownloading.has(v.id)} onClick={() => downloadPpt(v)} title="Download PPT slides">
                            {pptDownloading.has(v.id) ? <Loader2 size={12} className="animate-spin" /> : <LayoutPanelLeft size={12} />}
                          </Button>
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

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border/50">
        {videos.map((v, i) => {
          const dlBusy = downloading.has(v.id)
          const trBusy = transcribing.has(v.id)
          const isDl = isDownloaded(v)
          const batchInfo = batchStatusMap[v.id]

          return (
            <div key={v.id} className="px-4 py-3 space-y-2 animate-fade-in hover:bg-surface2/50 transition-colors" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-start gap-2">
                <span className="font-mono text-xs text-faint mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text leading-snug">{v.title || '(no title)'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs text-muted">{fmtDur(v.duration)}</span>
                    <span className="font-mono text-xs text-muted">{fmtDate(v.courseBeginTime || '')}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5 ml-7">
                {!isDl ? (
                  <Button variant="primary" size="sm" disabled={dlBusy} onClick={() => download(v)}>
                    {dlBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled={trBusy} onClick={() => transcribe(v)}>
                    {trBusy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} Transcribe
                  </Button>
                )}
                {pptDownloaded.has((v.title || '').replace(/[^a-zA-Z0-9 ._一-鿿-]/g, '_').trim()) ? (
                  <Button variant="ghost" size="sm" onClick={() => openSlideBrowser(v.title || '')}><LayoutPanelLeft size={12} /></Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => downloadPpt(v)} disabled={pptDownloading.has(v.id)}>
                    {pptDownloading.has(v.id) ? <Loader2 size={12} className="animate-spin" /> : <LayoutPanelLeft size={12} />}
                  </Button>
                )}
                {batchInfo?.error && <span className="font-mono text-xs text-error">{batchInfo.error}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Play selector modal */}
      {playSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setPlaySelector(null)}>
          <div className="bg-surface border border-border rounded-xl shadow-lg w-80 overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border bg-surface2">
              <p className="font-mono text-xs text-muted tracking-widest">SELECT TRACK</p>
              <p className="text-sm text-text mt-1 truncate">{playSelector.video.title}</p>
            </div>
            <div className="py-2">
              {playSelector.plays.map(play => (
                <button
                  key={play.index}
                  onClick={() => doDownload(playSelector.video, play.index)}
                  className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-surface2 transition-colors"
                >
                  <Badge variant={play.index === 0 ? 'default' : 'muted'}>
                    {play.index === 0 ? 'Main' : 'Screen'}
                  </Badge>
                  <span className="text-xs text-text">
                    {play.index === 0 ? 'Blackboard / PPT main screen' : 'Computer screen recording'}
                  </span>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border bg-surface2">
              <Button variant="secondary" size="sm" onClick={() => setPlaySelector(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Slide browser modal */}
      {slideBrowser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSlideBrowser(null)}>
          <div
            className="bg-surface border border-border rounded-xl shadow-modal flex flex-col overflow-hidden"
            style={{ width: 'min(900px, 95vw)', height: 'min(700px, 90vh)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-surface2">
              <LayoutPanelLeft size={14} className="text-accent" />
              <span className="font-mono text-xs text-text flex-1 truncate">{slideBrowser.title}</span>
              <span className="font-mono text-xs text-muted">{slideIndex + 1} / {slideBrowser.count}</span>
              <button onClick={() => setSlideBrowser(null)} className="font-mono text-xs text-muted hover:text-text ml-2"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-hidden flex items-center justify-center bg-black/90 p-4">
              <img
                key={slideIndex}
                src={`/api/slides/${encodeURIComponent(slideBrowser.course)}/${encodeURIComponent(slideBrowser.title)}/${encodeURIComponent(slideBrowser.images[slideIndex])}`}
                alt={`Slide ${slideIndex + 1}`}
                className="max-h-full max-w-full object-contain rounded"
                style={{ animation: 'fadeIn 0.15s ease' }}
              />
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center gap-3 shrink-0 bg-surface2">
              <Button variant="secondary" size="sm" disabled={slideIndex === 0} onClick={() => setSlideIndex(i => i - 1)}><ChevronLeft size={14} /></Button>
              <div className="flex gap-1 flex-1 justify-center overflow-x-auto">
                {slideBrowser.images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSlideIndex(i)}
                    className={`shrink-0 w-10 h-7 rounded border text-xs font-mono transition-all ${
                      i === slideIndex
                        ? 'border-brand/60 bg-brand-bg text-brand'
                        : 'border-border/40 text-muted/50 hover:border-border hover:text-muted'
                    }`}
                  >{i + 1}</button>
                ))}
              </div>
              <Button variant="secondary" size="sm" disabled={slideIndex === slideBrowser.count - 1} onClick={() => setSlideIndex(i => i + 1)}><ChevronRight size={14} /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
