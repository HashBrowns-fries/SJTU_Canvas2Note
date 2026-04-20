import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { pushToast } from './Toast'
import type { FileNode } from '../types'

const TEXT_EXTS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'py', 'js', 'ts'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a'])
const DOC_EXTS   = new Set(['pdf', 'pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls'])
const ZIP_EXTS   = new Set(['zip', 'tar', 'gz', '7z'])

function fileIcon(node: FileNode): string {
  if (node.type === 'dir') return '📁'
  const e = node.ext?.toLowerCase() ?? ''
  if (TEXT_EXTS.has(e))  return '📝'
  if (IMAGE_EXTS.has(e)) return '🖼'
  if (VIDEO_EXTS.has(e)) return '🎬'
  if (AUDIO_EXTS.has(e)) return '🎵'
  if (DOC_EXTS.has(e))   return '📄'
  if (ZIP_EXTS.has(e))   return '📦'
  return '📎'
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024)          return `${bytes} B`
  if (bytes < 1024 ** 2)       return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3)       return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Context Menu ─────────────────────────────────────────────────────────────

interface CtxMenu {
  x: number; y: number; node: FileNode
}

function useCtxMenu() {
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const close = useCallback(() => setCtx(null), [])
  useEffect(() => { document.addEventListener('click', close); return () => document.removeEventListener('click', close) }, [close])
  return { ctx, setCtx, close }
}

// ── Rename Modal ─────────────────────────────────────────────────────────────

function RenameModal({ node, onConfirm, onCancel }: { node: FileNode; onConfirm: (n: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(node.name)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.select() }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl w-80 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="font-mono text-xs text-[var(--text-muted)]">Rename</p>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(value); if (e.key === 'Escape') onCancel() }}
          className="w-full font-mono text-sm px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface2)] focus:border-amber/60 focus:outline-none"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border2)]">Cancel</button>
          <button onClick={() => onConfirm(value)} className="font-mono text-xs px-3 py-1.5 rounded border border-amber/40 text-amber hover:bg-amber/10">Rename</button>
        </div>
      </div>
    </div>
  )
}

// ── Mkdir Modal ──────────────────────────────────────────────────────────────

function MkdirModal({ onConfirm, onCancel }: { onConfirm: (n: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl w-80 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="font-mono text-xs text-[var(--text-muted)]">New folder</p>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()); if (e.key === 'Escape') onCancel() }}
          placeholder="folder name"
          className="w-full font-mono text-sm px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface2)] focus:border-amber/60 focus:outline-none"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-muted)]">Cancel</button>
          <button onClick={() => value.trim() && onConfirm(value.trim())} disabled={!value.trim()} className="font-mono text-xs px-3 py-1.5 rounded border border-amber/40 text-amber hover:bg-amber/10 disabled:opacity-40">Create</button>
        </div>
      </div>
    </div>
  )
}

// ── Preview Panel ────────────────────────────────────────────────────────────

function PreviewPanel({ path, name, ext, content, onClose }: { path: string; name: string; ext: string; content: string; onClose: () => void }) {
  const isMd = ext === 'md'
  return (
    <div className="h-full flex flex-col border-l border-[var(--border)]">
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface2)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">📄</span>
          <span className="font-mono text-xs text-[var(--text)] truncate">{name}</span>
          <span className="font-mono text-xs text-[var(--text-muted)]">.{ext}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <a href={api.fileDownloadUrl(path)} download className="font-mono text-xs px-2.5 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-amber/40 hover:text-amber transition-colors">↓</a>
          <button onClick={onClose} className="font-mono text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-rust/40 hover:text-rust transition-colors">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isMd
          ? <div className="prose-notes"><MarkdownDisplay text={content} /></div>
          : <pre className="font-mono text-xs text-[var(--text-mid)] whitespace-pre-wrap break-all leading-relaxed">{content}</pre>
        }
      </div>
    </div>
  )
}

// ── Markdown display ─────────────────────────────────────────────────────────

function MarkdownDisplay({ text }: { text: string }) {
  // Simple markdown renderer for preview
  const lines = text.split('\n')
  return (
    <div className="font-mono text-xs text-[var(--text-mid)] whitespace-pre-wrap leading-relaxed">
      {lines.map((line: string, i: number) => {
        if (line.startsWith('# '))       return <h1 key={i} className="text-base font-bold text-[var(--text)] mt-4 mb-2 border-b border-[var(--border)] pb-1">{line.slice(2)}</h1>
        if (line.startsWith('## '))      return <h2 key={i} className="text-sm font-semibold text-[var(--text)] mt-3 mb-1">{line.slice(3)}</h2>
        if (line.startsWith('### '))     return <h3 key={i} className="text-xs font-semibold text-[var(--text-mid)] mt-2 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('> '))       return <blockquote key={i} className="border-l-2 border-amber pl-3 text-[var(--text-muted)] italic my-2">{line.slice(2)}</blockquote>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-3">{line.slice(2)}</li>
        if (/^\d+\.\s/.test(line))       return <li key={i} className="ml-3 list-decimal">{line.replace(/^\d+\.\s/, '')}</li>
        if (line.trim() === '')          return <br key={i} />
        return <p key={i} className="my-0.5">{line}</p>
      })}
    </div>
  )
}

// ── Main FileManager ─────────────────────────────────────────────────────────

export function FileManager() {
  const [tree,     setTree]     = useState<FileNode[]>([])
  const [cwd,      setCwd]      = useState<FileNode[]>([])   // path segments from root
  const [items,    setItems]    = useState<FileNode[]>([])
  const [loading,  setLoading]  = useState(false)
  const [preview,  setPreview]  = useState<{ name: string; path: string; ext: string; content: string } | null>(null)
  const [rename,   setRename]   = useState<FileNode | null>(null)
  const [mkdir,    setMkdir]    = useState(false)
  const { ctx, setCtx } = useCtxMenu()
  const listRef = useRef<HTMLDivElement>(null)

  async function loadAt(path = '') {
    setLoading(true)
    try {
      const nodes = await api.files(path)
      setItems(nodes)
    } catch {
      pushToast({ type: 'error', message: 'Failed to load files' })
    } finally {
      setLoading(false)
    }
  }

  async function loadTree() {
    try { setTree(await api.files()) } catch { /* ignore */ }
  }

  useEffect(() => { loadAt(cwd.map(s => s.name).join('/')); loadTree() }, [])

  function navigateTo(node: FileNode) {
    if (node.type === 'dir') {
      const parts = node.path.split('/')
      setCwd(parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/'), type: 'dir' as const, modified: '' })))
      loadAt(node.path)
      setPreview(null)
    } else {
      openFile(node)
    }
  }

  function navigateBreadcrumb(index: number) {
    const newCwd = cwd.slice(0, index + 1)
    setCwd(newCwd)
    loadAt(newCwd.map(s => s.name).join('/'))
    setPreview(null)
  }

  async function openFile(node: FileNode) {
    if (node.fileType === 'binary' || node.fileType === 'other') {
      pushToast({ type: 'info', message: `Opening ${node.name}…` })
      window.open(api.fileDownloadUrl(node.path), '_blank')
      return
    }
    try {
      const p = await api.filePreview(node.path)
      setPreview(p)
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Cannot preview: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function doDelete(node: FileNode) {
    if (!confirm(`Delete "${node.name}"${node.type === 'dir' ? ' and all its contents' : ''}?`)) return
    try {
      await api.fileDelete(node.path)
      pushToast({ type: 'success', message: `✓ Deleted ${node.name}` })
      loadAt(cwd.map(s => s.name).join('/'))
      loadTree()
      if (preview?.path === node.path) setPreview(null)
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function doRename(node: FileNode, newName: string) {
    if (newName === node.name) { setRename(null); return }
    try {
      await api.fileRename(node.path, newName)
      pushToast({ type: 'success', message: `✓ Renamed to "${newName}"` })
      loadAt(cwd.map(s => s.name).join('/'))
      loadTree()
      if (preview) setPreview(null)
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Rename failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function doMkdir(name: string) {
    try {
      await api.fileMkdir(cwd.map(s => s.name).join('/'), name)
      pushToast({ type: 'success', message: `✓ Folder "${name}" created` })
      loadAt(cwd.map(s => s.name).join('/'))
      loadTree()
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Create folder failed: ${e instanceof Error ? e.message : String(e)}` })
    }
    setMkdir(false)
  }

  function handleCtx(e: React.MouseEvent, node: FileNode) {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, node })
  }

  // Keyboard: Delete selected
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Tree sidebar ─────────────────────────────── */}
      <div className="w-44 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        <div className="shrink-0 px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <span className="font-mono text-xs text-[var(--text-muted)] tracking-widest">FILES</span>
          <button onClick={() => setMkdir(true)} title="New folder" className="font-mono text-xs text-[var(--text-muted)] hover:text-amber transition-colors">+ ▤</button>
        </div>
        <div className="flex-1 overflow-auto py-1.5">
          <TreeNode nodes={tree} cwd={cwd} onNavigate={n => { setCwd([n]); loadAt(n.path) }} />
        </div>
      </div>

      {/* ── Right: list + preview ─────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Breadcrumbs + toolbar */}
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-2 flex items-center gap-1 bg-[var(--surface)]">
          <button onClick={() => { setCwd([]); loadAt(''); setPreview(null) }} className="font-mono text-xs text-[var(--text-muted)] hover:text-amber">data</button>
          {cwd.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="font-mono text-xs text-[var(--border2)]">›</span>
              <button
                onClick={() => navigateBreadcrumb(i)}
                className={`font-mono text-xs hover:text-amber transition-colors ${i === cwd.length - 1 ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}
              >
                {seg.name}
              </button>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => { setMkdir(true) }} title="New folder" className="font-mono text-xs px-2.5 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-amber/40 hover:text-amber transition-colors">+ folder</button>
            <button onClick={() => { loadAt(cwd.map(s => s.name).join('/')); loadTree() }} title="Refresh" className="font-mono text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-amber/40 hover:text-amber transition-colors">↺</button>
          </div>
        </div>

        {/* File list + preview side by side */}
        <div className="flex-1 flex overflow-hidden">
          {/* File table */}
          <div className="flex-1 overflow-auto" ref={listRef}>
            {loading ? <Skeleton /> : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-[var(--text-muted)]">
                <span className="text-2xl opacity-30 mb-2">📂</span>
                <p className="font-mono text-xs">empty folder</p>
              </div>
            ) : (
              <table className="w-full">
                <tbody>
                  {items.map((node, i) => (
                    <tr
                      key={node.path}
                      onClick={() => setSelected(node.path)}
                      onDoubleClick={() => navigateTo(node)}
                      onContextMenu={e => handleCtx(e, node)}
                      className={`border-b border-[var(--border)]/40 cursor-pointer transition-colors group ${selected === node.path ? 'bg-amber/5' : 'hover:bg-[var(--surface2)]'}`}
                      style={{ animationDelay: `${i * 15}ms` }}
                    >
                      <td className="px-4 py-2.5 w-8 text-base">{fileIcon(node)}</td>
                      <td className="px-2 py-2.5">
                        <span className="font-sans text-sm text-[var(--text)] truncate block">{node.name}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {node.type === 'dir' ? '—' : fmtSize(node.size ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap hidden md:table-cell">
                        {fmtDate(node.modified)}
                      </td>
                      <td className="px-3 py-2.5 w-16">
                        {node.type === 'file' && (
                          <a
                            href={api.fileDownloadUrl(node.path)}
                            download={node.name}
                            onClick={e => e.stopPropagation()}
                            title="Download"
                            className="font-mono text-xs text-[var(--border)] hover:text-amber transition-colors"
                          >↓</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Preview pane */}
          {preview && (
            <PreviewPanel
              path={preview.path}
              name={preview.name}
              ext={preview.ext}
              content={preview.content}
              onClose={() => setPreview(null)}
            />
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctx && (
        <div
          className="fixed z-50 bg-[var(--surface)] border border-[var(--border)] rounded shadow-lg py-1 min-w-36"
          style={{ left: ctx.x, top: ctx.y }}
          onClick={e => e.stopPropagation()}
        >
          {ctx.node.type === 'file' && (
            <button
              className="w-full text-left px-4 py-2 font-mono text-xs text-[var(--text)] hover:bg-[var(--surface2)]"
              onClick={() => { openFile(ctx.node); setCtx(null) }}
            >👁  Preview</button>
          )}
          <button
            className="w-full text-left px-4 py-2 font-mono text-xs text-[var(--text)] hover:bg-[var(--surface2)]"
            onClick={() => { setRename(ctx.node); setCtx(null) }}
          >✏  Rename</button>
          <button
            className="w-full text-left px-4 py-2 font-mono text-xs text-[var(--text)] hover:bg-[var(--surface2)]"
            onClick={() => { window.open(api.fileDownloadUrl(ctx.node.path), '_blank'); setCtx(null) }}
          >↓  Download</button>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            className="w-full text-left px-4 py-2 font-mono text-xs text-rust hover:bg-rust/5"
            onClick={() => { doDelete(ctx.node); setCtx(null) }}
          >🗑  Delete</button>
        </div>
      )}

      {/* Modals */}
      {rename && <RenameModal node={rename} onConfirm={n => { doRename(rename, n); setRename(null) }} onCancel={() => setRename(null)} />}
      {mkdir  && <MkdirModal   onConfirm={doMkdir} onCancel={() => setMkdir(false)} />}
    </div>
  )
}

// ── Tree Node ────────────────────────────────────────────────────────────────

function TreeNode({ nodes, cwd, onNavigate, depth = 0 }: {
  nodes: FileNode[]; cwd: FileNode[]; onNavigate: (n: FileNode) => void; depth?: number
}) {
  const dirs = nodes.filter(n => n.type === 'dir')
  if (dirs.length === 0) return null
  return (
    <>
      {dirs.map(node => {
        const isActive = cwd[0]?.name === node.name
        const label = node.name === 'downloads' ? '↓ downloads'
          : node.name === 'notes' ? '◈ notes'
          : node.name === 'audio' ? '◎ audio'
          : node.name
        return (
          <div key={node.path}>
            <button
              onClick={() => onNavigate(node)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 font-mono text-xs transition-colors ${
                isActive ? 'text-amber bg-amber/8' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface2)]'
              }`}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <span>{isActive ? '▣' : '▢'}</span>
              <span className="truncate">{label}</span>
            </button>
          </div>
        )
      })}
    </>
  )
}

function Skeleton() {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="h-8 bg-[var(--surface2)] rounded animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  )
}
