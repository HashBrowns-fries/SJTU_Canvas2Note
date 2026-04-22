import { useEffect, useState } from 'react'
import { api } from '../api'
import { pushToast } from './Toast'
import type { CanvasFile, Course } from '../types'

const EXT_ICONS: Record<string, string> = {
  pdf: '📄', pptx: '📊', ppt: '📊', docx: '📝', doc: '📝',
  xlsx: '📈', xls: '📈', mp4: '🎬', zip: '📦',
}

function extIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_ICONS[ext] ?? '📎'
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

interface Props { course: Course }

export function FilesTab({ course }: Props) {
  const [files, setFiles] = useState<CanvasFile[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<Set<number>>(new Set())

  useEffect(() => {
    setLoading(true)
    api.courseFiles(course.id)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false))
  }, [course.id])

  async function download(f: CanvasFile) {
    setDownloading(p => new Set(p).add(f.id))
    try {
      const { task_id } = await api.download({
        type: 'file', course_id: course.id,
        course_name: course.name, item: f as unknown as object,
      })
      pushToast({ type: 'info', message: `Downloading ${f.display_name}…` })

      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: `✓ ${f.display_name}` })
          setDownloading(p => { const n = new Set(p); n.delete(f.id); return n })
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `✗ ${f.display_name}: ${t.error}` })
          setDownloading(p => { const n = new Set(p); n.delete(f.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: `Failed to queue ${f.display_name}` })
      setDownloading(p => { const n = new Set(p); n.delete(f.id); return n })
    }
  }

  if (loading) return <Skeleton />

  return (
    <div className="h-full overflow-auto">
      {/* Stats bar */}
      <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-6 py-2 flex items-center gap-4">
        <span className="font-mono text-xs text-[var(--text-muted)]">{files.length} files</span>
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {fmtSize(files.reduce((a, f) => a + f.size, 0))} total
        </span>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {['', 'Name', 'Size', 'Type', ''].map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left font-mono text-xs text-[var(--text-muted)] font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => {
            const busy = downloading.has(f.id)
            const ct = f['content-type'] ?? ''
            return (
              <tr
                key={f.id}
                className="border-b border-[var(--border)]/50 hover:bg-[var(--surface2)] transition-colors group animate-fade-in"
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <td className="px-4 py-3 text-lg w-10">{extIcon(f.display_name)}</td>
                <td className="px-4 py-3 font-sans text-sm text-[var(--text)] max-w-xs">
                  <span className="truncate block">{f.display_name}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">
                  {fmtSize(f.size)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)] max-w-[140px]">
                  <span className="truncate block">{ct}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    disabled={busy}
                    onClick={() => download(f)}
                    className={`font-mono text-xs px-3 py-1.5 rounded border transition-all ${
                      busy
                        ? 'border-[var(--border)] text-[var(--text-muted)] cursor-wait'
                        : 'border-[var(--green)]/30 text-[var(--green)] hover:bg-[var(--green)]/10 hover:border-[var(--green)]/60'
                    }`}
                  >
                    {busy ? '…' : '↓ get'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 bg-[var(--surface2)] rounded animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}
