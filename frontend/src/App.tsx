import { useState } from 'react'
import { Sun, Moon, Menu } from 'lucide-react'
import { api } from './api'
import { Sidebar } from './components/Sidebar'
import { FilesTab } from './components/FilesTab'
import { FileManager } from './components/FileManager'
import { VideosTab } from './components/VideosTab'
import { TranscriptionsTab } from './components/TranscriptionsTab'
import { NotesTab } from './components/NotesTab'
import { ToastContainer } from './components/Toast'
import { SettingsModal } from './components/SettingsModal'
import { useTheme, useKeyboard } from './hooks'
import { Icons } from './components/icons'
import type { Course, TabId } from './types'

const TABS: { id: TabId; label: string; icon: keyof typeof Icons }[] = [
  { id: 'files',          label: 'Canvas',        icon: 'LayoutPanelLeft' },
  { id: 'local',          label: 'Local',         icon: 'FolderOpen' },
  { id: 'videos',         label: 'Videos',        icon: 'Play' },
  { id: 'transcriptions', label: 'Transcriptions', icon: 'Mic' },
  { id: 'notes',          label: 'Notes',         icon: 'Sparkles' },
]

export default function App() {
  const [course, setCourse] = useState<Course | null>(null)
  const [tab, setTab] = useState<TabId>('files')
  const [transcriptRefresh, setTranscriptRefresh] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { theme, toggle: toggleTheme } = useTheme()

  // Batch transcribe state
  const [batchTaskId, setBatchTaskId] = useState<string | null>(null)
  const [batchItems, setBatchItems] = useState<any[]>([])
  const [batchDone, setBatchDone] = useState(0)
  const [batchTotal, setBatchTotal] = useState(0)
  const [batchCurrent, setBatchCurrent] = useState('')

  // Keyboard shortcuts
  useKeyboard(
    TABS.map((t, i) => ({
      key: String(i + 1),
      ctrl: true,
      handler: () => course && setTab(t.id),
      description: `Switch to ${t.label}`,
    })),
    !!course,
  )

  const Icon = (name: keyof typeof Icons, size = 14) => {
    const C = Icons[name]
    return <C size={size} strokeWidth={1.5} />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Mobile sidebar overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity lg:hidden
          ${sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className={`shrink-0 lg:relative fixed z-50 h-full transition-transform duration-200 lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar
          selected={course}
          onSelect={c => { setCourse(c); setTab('files'); setSidebarOpen(false) }}
          onClose={() => setSidebarOpen(false)}
          batchTaskId={batchTaskId}
          batchItems={batchItems}
          batchDone={batchDone}
          batchTotal={batchTotal}
          batchCurrent={batchCurrent}
        />
      </div>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="shrink-0 border-b border-border bg-surface px-3 sm:px-6 py-0 flex items-stretch gap-0">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex items-center px-2 mr-1 text-muted hover:text-brand transition-colors"
          >
            <Menu size={18} strokeWidth={1.5} />
          </button>

          {course ? (
            <>
              <div className="flex items-center mr-3 sm:mr-6 py-3 border-r border-border pr-3 sm:pr-6">
                <div>
                  <p className="text-sm font-medium text-text leading-tight truncate max-w-[120px] sm:max-w-[200px]">{course.name}</p>
                  <p className="font-mono text-xs text-muted hidden sm:block">{course.course_code} · id {course.id}</p>
                </div>
              </div>

              {/* Tabs */}
              <nav className="flex items-stretch overflow-x-auto">
                {TABS.map(t => {
                  const active = tab === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`px-3 sm:px-5 h-full font-mono text-xs tracking-wider flex items-center gap-1.5 sm:gap-2 border-b-[2px] transition-all whitespace-nowrap ${
                        active
                          ? 'border-brand text-brand bg-brand-bg'
                          : 'border-transparent text-muted hover:text-text hover:border-border2'
                      }`}
                    >
                      {Icon(t.icon, 14)}
                      <span className="hidden sm:inline">{t.label}</span>
                    </button>
                  )
                })}
              </nav>
            </>
          ) : (
            <div className="flex items-center py-3">
              <p className="font-mono text-xs text-muted">
                ← select a course to begin
              </p>
            </div>
          )}

          {/* Right actions */}
          <div className="ml-auto flex items-stretch">
            <button
              onClick={toggleTheme}
              className="flex items-center px-3 text-muted hover:text-brand transition-colors"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 sm:px-4 font-mono text-xs text-muted hover:text-brand border-l border-border transition-colors"
              title="Settings"
            >
              <Icons.Settings size={14} strokeWidth={1.5} />
              <span className="hidden sm:inline">SETTINGS</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {!course && <Welcome onSettings={() => setSettingsOpen(true)} />}
          {course && tab === 'files'          && <FilesTab   key={course.id} course={course} />}
          {course && tab === 'local'          && <FileManager />}
          {course && tab === 'videos'         && (
            <VideosTab
              key={course.id}
              course={course}
              onTranscribed={() => setTranscriptRefresh(r => r + 1)}
              batchTaskId={batchTaskId}
              batchItems={batchItems}
              batchDone={batchDone}
              batchTotal={batchTotal}
              batchCurrent={batchCurrent}
              onBatchStart={({ task_id, items }) => {
                setBatchTaskId(task_id)
                setBatchItems(items)
                setBatchTotal(items.length)
                setBatchDone(0)
                setBatchCurrent('')
                const poll = setInterval(async () => {
                  const t: any = await api.task(task_id).catch(() => null)
                  if (!t) return
                  if (t.status === 'done' || t.status === 'error') {
                    clearInterval(poll)
                    setBatchDone(t.status === 'done' ? (t.total_count ?? t.done_count ?? 0) : (t.done_count ?? 0))
                    setBatchCurrent('')
                    if (t.status === 'done') setTranscriptRefresh(r => r + 1)
                    setTimeout(() => setBatchTaskId(null), 3000)
                    return
                  }
                  setBatchItems(t.items || [])
                  setBatchDone(t.done_count || 0)
                  setBatchCurrent(t.current || '')
                }, 2000)
              }}
            />
          )}
          {course && tab === 'transcriptions' && <TranscriptionsTab course={course} refresh={transcriptRefresh} />}
          {course && tab === 'notes'          && <NotesTab key={course.id} course={course} />}
        </div>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ToastContainer />
    </div>
  )
}

function Welcome({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none">
      <div className="relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full border border-brand/10 animate-pulse" />
          <div className="absolute w-20 h-20 rounded-full border border-accent/20" />
        </div>
        <span className="relative text-6xl text-accent/40">
          <Icons.Sparkles size={56} strokeWidth={1} />
        </span>
      </div>

      <div className="text-center space-y-1.5">
        <h1 className="font-mono font-semibold text-text tracking-[0.25em] text-base uppercase">Canvas2Note</h1>
        <p className="font-mono text-xs text-muted tracking-widest">
          download · transcribe · generate · chat
        </p>
      </div>

      <div className="font-mono text-xs text-faint space-y-1 text-center">
        <p>Select a course from the sidebar</p>
        <p className="text-border tracking-widest">────────────────</p>
        <p>Files · Videos · ASR · LLM Notes</p>
      </div>

      <button
        onClick={onSettings}
        className="mt-2 font-mono text-xs px-4 py-2 rounded-lg border border-brand/20 text-accent hover:border-brand/40 hover:text-brand transition-all"
      >
        <Icons.Settings size={12} className="inline mr-1.5" strokeWidth={1.5} />
        configure API keys
      </button>
    </div>
  )
}
