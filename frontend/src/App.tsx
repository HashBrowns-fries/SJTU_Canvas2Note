import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { FilesTab } from './components/FilesTab'
import { FileManager } from './components/FileManager'
import { VideosTab } from './components/VideosTab'
import { TranscriptionsTab } from './components/TranscriptionsTab'
import { NotesTab } from './components/NotesTab'
import { ToastContainer } from './components/Toast'
import { SettingsModal } from './components/SettingsModal'
import type { Course, TabId } from './types'

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: 'files',          label: 'Canvas',        glyph: '◧' },
  { id: 'local',          label: 'Local',         glyph: '▤' },
  { id: 'videos',         label: 'Videos',        glyph: '▶' },
  { id: 'transcriptions', label: 'Transcriptions', glyph: '◎' },
  { id: 'notes',          label: 'Notes',         glyph: '◈' },
]

export default function App() {
  const [course, setCourse] = useState<Course | null>(null)
  const [tab, setTab] = useState<TabId>('files')
  const [transcriptRefresh, setTranscriptRefresh] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar selected={course} onSelect={c => { setCourse(c); setTab('files') }} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-0 flex items-stretch">
          {course ? (
            <>
              <div className="flex items-center mr-6 py-3 border-r border-[var(--border)] pr-6">
                <div>
                  <p className="text-sm font-medium text-[var(--text)] leading-tight">{course.name}</p>
                  <p className="font-mono text-xs text-[var(--text-muted)]">{course.course_code} · id {course.id}</p>
                </div>
              </div>

              {/* Tabs */}
              <nav className="flex items-stretch">
                {TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`px-5 h-full font-mono text-xs tracking-wider flex items-center gap-2 border-b-2 transition-all ${
                      tab === t.id
                        ? 'border-amber text-amber bg-amber/5'
                        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border)]'
                    }`}
                  >
                    <span>{t.glyph}</span>
                    <span className="hidden sm:inline">{t.label.toUpperCase()}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <div className="flex items-center py-3">
              <p className="font-mono text-xs text-[var(--text-muted)]">
                ← select a course to begin
              </p>
            </div>
          )}

          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="ml-auto flex items-center gap-2 px-4 h-full font-mono text-xs text-[var(--text-muted)] hover:text-amber border-l border-[var(--border)] transition-colors"
            title="Settings"
          >
            <span>◎</span>
            <span className="hidden sm:inline">SETTINGS</span>
          </button>
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
            />
          )}
          {course && tab === 'transcriptions' && <TranscriptionsTab course={course} refresh={transcriptRefresh} />}
          {course && tab === 'notes'          && <NotesTab key={course.id} course={course} />}
        </div>
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <ToastContainer />
    </div>
  )
}

function Welcome({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none">
      {/* Decorative grid */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full border border-amber/10 animate-pulse" />
          <div className="absolute w-20 h-20 rounded-full border border-amber/20" />
        </div>
        <span className="relative text-6xl text-amber opacity-60">◈</span>
      </div>

      <div className="text-center space-y-2">
        <h1 className="font-mono text-xl font-bold text-amber tracking-widest">CANVAS2NOTE</h1>
        <p className="font-mono text-sm text-[var(--text-muted)]">
          download · transcribe · generate · chat
        </p>
      </div>

      <div className="font-mono text-xs text-[var(--text-muted)] space-y-1 text-center">
        <p>Select a course from the sidebar</p>
        <p className="text-[var(--border)]">──────────────────────</p>
        <p>Files  ·  Videos  ·  ASR  ·  LLM Notes</p>
      </div>

      {/* Quick setup hint */}
      <button
        onClick={onSettings}
        className="mt-2 font-mono text-xs px-4 py-2 rounded border border-amber/20 text-amber/80 hover:border-amber/40 hover:text-amber transition-all"
      >
        ◎ configure API keys
      </button>
    </div>
  )
}
