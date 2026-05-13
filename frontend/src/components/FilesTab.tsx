import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../api'
import { pushToast } from './Toast'
import { Skeleton } from './ui/Skeleton'
import { Icons } from './icons'
import type { CanvasFile, Course } from '../types'

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
      pushToast({ type: 'info', message: `Downloading ${f.display_name}...` })

      const poll = setInterval(async () => {
        const t = await api.task(task_id).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          pushToast({ type: 'success', message: `${f.display_name}` })
          setDownloading(p => { const n = new Set(p); n.delete(f.id); return n })
        }
        if (t.status === 'error') {
          clearInterval(poll)
          pushToast({ type: 'error', message: `${f.display_name}: ${t.error}` })
          setDownloading(p => { const n = new Set(p); n.delete(f.id); return n })
        }
      }, 2000)
    } catch {
      pushToast({ type: 'error', message: `Failed to queue ${f.display_name}` })
      setDownloading(p => { const n = new Set(p); n.delete(f.id); return n })
    }
  }

  if (loading) return (
    <div className="p-6 space-y-3">
      <Skeleton lines={8} />
    </div>
  )

  return (
    <div className="h-full overflow-auto">
      {/* Stats bar */}
      <div className="sticky top-0 z-10 bg-surface border-b border-border px-4 sm:px-6 py-2 flex items-center gap-4">
        <span className="font-mono text-xs text-muted">{files.length} files</span>
        <span className="font-mono text-xs text-muted">
          {fmtSize(files.reduce((a, f) => a + f.size, 0))} total
        </span>
      </div>

      {/* Desktop table */}
      <table className="w-full hidden md:table">
        <thead>
          <tr className="border-b border-border">
            {['', 'Name', 'Size', 'Type', ''].map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left font-mono text-xs text-muted font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => {
            const busy = downloading.has(f.id)
            return (
              <tr
                key={f.id}
                className="border-b border-border/50 hover:bg-surface2 transition-colors animate-fade-in"
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <td className="px-4 py-3 w-10">
                  <Icons.FileText size={16} className="text-muted" strokeWidth={1.5} />
                </td>
                <td className="px-4 py-3 text-sm text-text max-w-xs">
                  <span className="truncate block">{f.display_name}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted whitespace-nowrap">
                  {fmtSize(f.size)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted max-w-[140px]">
                  <span className="truncate block">{f['content-type'] ?? ''}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    disabled={busy}
                    onClick={() => download(f)}
                    className={`font-mono text-xs px-3 py-1.5 rounded-lg border transition-all inline-flex items-center gap-1 ${
                      busy
                        ? 'border-border text-muted cursor-wait'
                        : 'border-brand/30 text-brand hover:bg-brand-bg'
                    }`}
                  >
                    {busy ? <Icons.Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    <span>{busy ? '...' : 'get'}</span>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border/50">
        {files.map((f, i) => {
          const busy = downloading.has(f.id)
          return (
            <div
              key={f.id}
              className="px-4 py-3 flex items-center gap-3 animate-fade-in hover:bg-surface2 transition-colors"
              style={{ animationDelay: `${i * 20}ms` }}
            >
              <Icons.FileText size={18} className="text-muted shrink-0" strokeWidth={1.5} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text truncate">{f.display_name}</p>
                <p className="font-mono text-xs text-muted">{fmtSize(f.size)}</p>
              </div>
              <button
                disabled={busy}
                onClick={() => download(f)}
                className={`shrink-0 font-mono text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  busy
                    ? 'border-border text-muted'
                    : 'border-brand/30 text-brand hover:bg-brand-bg'
                }`}
              >
                {busy ? <Icons.Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
