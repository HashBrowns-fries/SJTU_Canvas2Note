import { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { pushToast } from './Toast'
import type { Course } from '../types'
import type { VideoItem, VideoPlay } from '../api'

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

interface Props { course: Course; onTranscribed: () => void }

export function VideosTab({ course, onTranscribed }: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [transcribing, setTranscribing] = useState<Set<string>>(new Set())
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [playSelector, setPlaySelector] = useState<{ video: VideoItem; plays: VideoPlay[] } | null>(null)

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
        // 同时注册去掉/加上"_录屏"的变体
        downloaded.add(f.name.replace('_录屏', ''))
        if (!f.name.includes('_录屏')) {
          downloaded.add(f.name.replace('.mp4', '_录屏.mp4'))
        }
      })
      setDownloaded(downloaded)
    }).catch(() => {})
  }, [course.id])

  function isDownloaded(v: VideoItem) {
    const title = v.title || ''
    // 支持两种格式: {标题}.mp4 和 {标题}_录屏.mp4
    const normalized = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').toLowerCase()
    const vidKey = normalized(title)
    return [...downloaded].some(n => {
      const downloadedKey = normalized(n)
      // 完全匹配标准化后的标题
      return downloadedKey.includes(vidKey) && vidKey.length >= 8
      || downloadedKey.replace('_录屏', '').includes(vidKey.replace('_录屏', ''))
    })
  }

  async function download(v: VideoItem) {
    if (isDownloaded(v)) {
      pushToast({ type: 'info', message: `已在: ${v.title}` })
      return
    }
    try {
      const plays = await api.videoPlays(v.id, v.title)
      if (plays.length <= 1) {
        // 只有一个片段，直接下载
        void doDownload(v, -1)
      } else {
        // 多个片段，弹出选择器
        setPlaySelector({ video: v, plays })
      }
    } catch {
      pushToast({ type: 'error', message: '获取视频片段失败' })
    }
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
      <div className="sticky top-0 z-10 px-6 py-3 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)]">
        <span className="font-mono text-xs font-bold text-[var(--text)]">{course.name}</span>
        <span className="font-mono text-xs text-[var(--text-muted)]">· {videos.length} 个录屏</span>
        <span className="font-mono text-xs px-2 py-0.5 bg-sage/10 text-sage rounded border border-sage/20">v.sjtu.edu.cn</span>
      </div>

      {/* List */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-6 py-2 w-8">#</th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-6 py-2">标题 / 上课时间</th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-6 py-2 w-20 hidden sm:table-cell">时长</th>
            <th className="text-left font-mono text-xs text-[var(--text-muted)] px-6 py-2 w-48">操作</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v, i) => {
            const dlBusy = downloading.has(v.id)
            const trBusy = transcribing.has(v.id)
            const isDl = isDownloaded(v)
            return (
              <tr
                key={v.id}
                className="border-b border-[var(--border)]/50 hover:bg-[var(--surface2)]/50 group transition-colors animate-fade-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <td className="font-mono text-xs text-[var(--text-muted)] px-6 py-3 align-middle">
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td className="px-6 py-3 align-middle">
                  <p className="text-sm text-[var(--text)] leading-snug group-hover:text-amber transition-colors">
                    {v.title || '（无标题）'}
                  </p>
                  <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                    {fmtDate(v.courseBeginTime || '')}
                  </p>
                </td>
                <td className="px-6 py-3 align-middle hidden sm:table-cell">
                  <span className="font-mono text-xs text-[var(--text-muted)]">{fmtDur(v.duration)}</span>
                </td>
                <td className="px-6 py-3 align-middle">
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      disabled={dlBusy || isDl}
                      onClick={() => download(v)}
                      className={`font-mono text-xs px-2.5 py-1 rounded border transition-all ${
                        isDl
                          ? 'border-sage/30 text-sage/70 cursor-default'
                          : dlBusy
                          ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                          : 'border-amber/30 text-amber hover:bg-amber/10'
                      }`}
                    >
                      {isDl ? '✓' : dlBusy ? '…' : '↓'}
                    </button>
                    <button
                      disabled={trBusy}
                      onClick={() => transcribe(v)}
                      className={`font-mono text-xs px-2.5 py-1 rounded border transition-all ${
                        trBusy
                          ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                          : 'border-sage/30 text-sage hover:bg-sage/10'
                      }`}
                    >
                      {trBusy ? '⟳' : '◎'}
                    </button>
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
                    play.index === 0 ? 'border-amber/30 text-amber bg-amber/5' : 'border-sage/30 text-sage bg-sage/5'
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
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="p-6 space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-4 border-b border-[var(--border)]/30">
          <div className="w-6 h-4 bg-[var(--surface2)] rounded animate-pulse" />
          <div className="flex-1 h-4 bg-[var(--surface2)] rounded animate-pulse" style={{ width: `${70 - i * 5}%` }} />
          <div className="w-12 h-4 bg-[var(--surface2)] rounded animate-pulse hidden sm:block" />
          <div className="w-16 h-6 bg-[var(--surface2)] rounded animate-pulse" />
        </div>
      ))}
    </div>
  )
}
