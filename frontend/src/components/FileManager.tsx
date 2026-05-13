import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Folder, File, Download, Trash2, Pencil, Eye, Search,
  FolderPlus, RefreshCw, X, Folders as FolderOpenIcon,
} from 'lucide-react'
import { api } from '../api'
import { pushToast } from './Toast'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Skeleton } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import type { FileNode } from '../types'

const TEXT_EXTS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'py', 'js', 'ts'])

function extIcon(node: FileNode) {
  if (node.type === 'dir') return Folder
  const e = node.ext?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return Eye
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(e)) return File
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(e)) return File
  if (['pdf', 'pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls'].includes(e)) return File
  if (['zip', 'tar', 'gz', '7z'].includes(e)) return File
  return File
}

function fmtSize(bytes: number): string {
  if (!bytes) return '-'
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

// ── Preview Panel ────────────────────────────────────────────────────────────

function PreviewPanel({ path, name, ext, content, onClose }: { path: string; name: string; ext: string; content: string; onClose: () => void }) {
  const isMd = ext === 'md'
  return (
    <div className="h-full flex flex-col border-l border-border animate-slide-in-right">
      <div className="shrink-0 px-4 py-2.5 border-b border-border flex items-center justify-between bg-surface2">
        <div className="flex items-center gap-2 min-w-0">
          <File size={16} className="text-muted" />
          <span className="font-mono text-xs text-text truncate">{name}</span>
          <span className="font-mono text-xs text-muted">.{ext}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <a href={api.fileDownloadUrl(path)} download className="p-1.5 rounded-lg text-muted hover:text-brand hover:bg-brand-bg transition-colors" title="Download">
            <Download size={14} />
          </a>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-error transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isMd
          ? <div className="prose-notes"><MarkdownDisplay text={content} /></div>
          : <pre className="font-mono text-xs text-text-mid whitespace-pre-wrap break-all leading-relaxed">{content}</pre>
        }
      </div>
    </div>
  )
}

function MarkdownDisplay({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="font-mono text-xs text-text-mid whitespace-pre-wrap leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('# '))       return <h1 key={i} className="text-base font-bold text-text mt-4 mb-2 border-b border-border pb-1">{line.slice(2)}</h1>
        if (line.startsWith('## '))      return <h2 key={i} className="text-sm font-semibold text-text mt-3 mb-1">{line.slice(3)}</h2>
        if (line.startsWith('### '))     return <h3 key={i} className="text-xs font-semibold text-text-mid mt-2 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('> '))       return <blockquote key={i} className="border-l-2 border-l-brand pl-3 text-muted italic my-2">{line.slice(2)}</blockquote>
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
  const [cwd,      setCwd]      = useState<FileNode[]>([])
  const [items,    setItems]    = useState<FileNode[]>([])
  const [loading,  setLoading]  = useState(false)
  const [preview,  setPreview]  = useState<{ name: string; path: string; ext: string; content: string } | null>(null)
  const [rename,   setRename]   = useState<FileNode | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [mkdir,    setMkdir]    = useState(false)
  const [mkdirVal, setMkdirVal] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const { ctx, setCtx } = useCtxMenu()

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
      pushToast({ type: 'info', message: `Opening ${node.name}...` })
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
      pushToast({ type: 'success', message: `Deleted ${node.name}` })
      loadAt(cwd.map(s => s.name).join('/'))
      loadTree()
      if (preview?.path === node.path) setPreview(null)
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function doRename() {
    if (!rename || renameVal === rename.name) { setRename(null); return }
    try {
      await api.fileRename(rename.path, renameVal)
      pushToast({ type: 'success', message: `Renamed to "${renameVal}"` })
      loadAt(cwd.map(s => s.name).join('/'))
      loadTree()
      if (preview) setPreview(null)
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Rename failed: ${e instanceof Error ? e.message : String(e)}` })
    }
    setRename(null)
  }

  async function doMkdir() {
    const name = mkdirVal.trim()
    if (!name) { setMkdir(false); return }
    try {
      await api.fileMkdir(cwd.map(s => s.name).join('/'), name)
      pushToast({ type: 'success', message: `Folder "${name}" created` })
      loadAt(cwd.map(s => s.name).join('/'))
      loadTree()
    } catch (e: unknown) {
      pushToast({ type: 'error', message: `Create folder failed: ${e instanceof Error ? e.message : String(e)}` })
    }
    setMkdir(false)
    setMkdirVal('')
  }

  function handleCtx(e: React.MouseEvent, node: FileNode) {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, node })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Tree sidebar */}
      <div className="w-44 shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="shrink-0 px-3 py-2.5 border-b border-border flex items-center justify-between">
          <span className="font-mono text-xs text-muted tracking-widest">FILES</span>
          <button onClick={() => setMkdir(true)} title="New folder" className="p-1 rounded-lg text-muted hover:text-brand hover:bg-brand-bg transition-colors">
            <FolderPlus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-auto py-1.5">
          <TreeNode nodes={tree} cwd={cwd} onNavigate={n => { setCwd([n]); loadAt(n.path) }} />
        </div>
      </div>

      {/* Right: list + preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Breadcrumbs */}
        <div className="shrink-0 border-b border-border px-4 py-2 flex items-center gap-1 bg-surface">
          <button onClick={() => { setCwd([]); loadAt(''); setPreview(null) }} className="font-mono text-xs text-muted hover:text-brand transition-colors">
            <FolderOpenIcon size={12} className="inline mr-1" />data
          </button>
          {cwd.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="font-mono text-xs text-border2">/</span>
              <button
                onClick={() => navigateBreadcrumb(i)}
                className={`font-mono text-xs hover:text-brand transition-colors ${i === cwd.length - 1 ? 'text-text' : 'text-muted'}`}
              >
                {seg.name}
              </button>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => { setMkdir(true); setMkdirVal('') }}><FolderPlus size={12} /> folder</Button>
            <Button variant="ghost" size="sm" onClick={() => { loadAt(cwd.map(s => s.name).join('/')); loadTree() }}><RefreshCw size={12} /></Button>
          </div>
        </div>

        {/* File list + preview */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="p-4"><Skeleton lines={7} /></div>
            ) : items.length === 0 ? (
              <EmptyState icon={Folder} title="empty folder" />
            ) : (
              <table className="w-full">
                <tbody>
                  {items.map((node, i) => (
                    <tr
                      key={node.path}
                      onClick={() => setSelected(node.path)}
                      onDoubleClick={() => navigateTo(node)}
                      onContextMenu={e => handleCtx(e, node)}
                      className={`border-b border-border/40 cursor-pointer transition-colors ${
                        selected === node.path ? 'bg-brand-bg' : 'hover:bg-surface2'
                      }`}
                      style={{ animationDelay: `${i * 15}ms` }}
                    >
                      <td className="px-4 py-2.5 w-8">
                        {node.type === 'dir' ? <Folder size={16} className="text-accent" /> : <File size={16} className="text-muted" />}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="text-sm text-text truncate block">{node.name}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted whitespace-nowrap hidden sm:table-cell">
                        {node.type === 'dir' ? '-' : fmtSize(node.size ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted whitespace-nowrap hidden md:table-cell">
                        {fmtDate(node.modified)}
                      </td>
                      <td className="px-3 py-2.5 w-12">
                        {node.type === 'file' && (
                          <a
                            href={api.fileDownloadUrl(node.path)}
                            download={node.name}
                            onClick={e => e.stopPropagation()}
                            title="Download"
                            className="text-muted hover:text-brand transition-colors"
                          >
                            <Download size={14} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {preview && (
            <PreviewPanel
              path={preview.path} name={preview.name} ext={preview.ext}
              content={preview.content} onClose={() => setPreview(null)}
            />
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctx && (
        <div
          className="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-36 animate-fade-in"
          style={{ left: ctx.x, top: ctx.y }}
          onClick={e => e.stopPropagation()}
        >
          {ctx.node.type === 'file' && (
            <button
              className="w-full text-left px-4 py-2 font-mono text-xs text-text hover:bg-surface2 flex items-center gap-2"
              onClick={() => { openFile(ctx.node); setCtx(null) }}
            ><Eye size={12} /> Preview</button>
          )}
          <button
            className="w-full text-left px-4 py-2 font-mono text-xs text-text hover:bg-surface2 flex items-center gap-2"
            onClick={() => { setRename(ctx.node); setRenameVal(ctx.node.name); setCtx(null) }}
          ><Pencil size={12} /> Rename</button>
          <button
            className="w-full text-left px-4 py-2 font-mono text-xs text-text hover:bg-surface2 flex items-center gap-2"
            onClick={() => { window.open(api.fileDownloadUrl(ctx.node.path), '_blank'); setCtx(null) }}
          ><Download size={12} /> Download</button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-4 py-2 font-mono text-xs text-error hover:bg-error-bg flex items-center gap-2"
            onClick={() => { doDelete(ctx.node); setCtx(null) }}
          ><Trash2 size={12} /> Delete</button>
        </div>
      )}

      {/* Rename modal */}
      <Modal open={!!rename} onClose={() => setRename(null)} title="Rename" size="sm">
        <div className="space-y-4">
          <input
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRename(null) }}
            className="field-input"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setRename(null)}>Cancel</Button>
            <Button variant="primary" onClick={doRename} disabled={!renameVal.trim()}>Rename</Button>
          </div>
        </div>
      </Modal>

      {/* Mkdir modal */}
      <Modal open={mkdir} onClose={() => setMkdir(false)} title="New Folder" size="sm">
        <div className="space-y-4">
          <input
            value={mkdirVal}
            onChange={e => setMkdirVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doMkdir(); if (e.key === 'Escape') setMkdir(false) }}
            placeholder="folder name"
            className="field-input"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setMkdir(false)}>Cancel</Button>
            <Button variant="primary" onClick={doMkdir} disabled={!mkdirVal.trim()}>Create</Button>
          </div>
        </div>
      </Modal>
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
        const label = node.name === 'downloads' ? 'downloads'
          : node.name === 'notes' ? 'notes'
          : node.name === 'audio' ? 'audio'
          : node.name
        return (
          <div key={node.path}>
            <button
              onClick={() => onNavigate(node)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 font-mono text-xs transition-colors ${
                isActive ? 'text-brand bg-brand-bg' : 'text-muted hover:text-text hover:bg-surface2'
              }`}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <Folder size={12} className={isActive ? 'text-brand' : 'text-faint'} />
              <span className="truncate">{label}</span>
            </button>
          </div>
        )
      })}
    </>
  )
}
