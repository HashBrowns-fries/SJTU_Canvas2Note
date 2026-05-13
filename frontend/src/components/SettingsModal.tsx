import { useEffect, useRef, useState } from 'react'
import {
  X, Globe, Video, Brain, Mic, Settings, Check, Loader2, Eye, EyeOff, Server,
} from 'lucide-react'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { api } from '../api'

interface Settings {
  canvas_base_url:    string
  canvas_token:       string
  ja_auth_cookie:     string
  ja_session_cookie:  string
  llm_base_url:       string
  llm_api_key:        string
  llm_model:          string
  asr_model:          string
  asr_engine:         string
  asr_device:         string
  asr_api_base:       string
  asr_api_key:        string
  asr_api_model:      string
}

interface Props { open: boolean; onClose: () => void }

const LLM_PRESETS = [
  { label: 'Ollama', base_url: 'http://localhost:11434/v1', api_key: 'ollama' },
  { label: 'OpenAI', base_url: 'https://api.openai.com/v1',  api_key: '' },
  { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', api_key: '' },
  { label: 'SiliconFlow', base_url: 'https://api.siliconflow.cn/v1', api_key: '' },
  { label: 'MiniMax', base_url: 'https://api.minimaxi.com/anthropic', api_key: '' },
]

const ASR_ENGINES = [
  { label: 'SJTU Transcriber', value: 'translate' },
  { label: 'faster-whisper',   value: 'faster-whisper' },
  { label: 'API',              value: 'api' },
]

const ASR_MODELS = [
  { label: 'base (74M)',    value: 'base' },
  { label: 'small (244M)',  value: 'small' },
  { label: 'medium (769M)', value: 'medium' },
  { label: 'large-v3 (1.5B)', value: 'large-v3' },
]

type SettingsTab = 'server' | 'canvas' | 'video' | 'llm' | 'asr'

const TAB_ITEMS: { id: SettingsTab; label: string; icon: typeof Globe }[] = [
  { id: 'server', label: 'Server', icon: Server },
  { id: 'canvas', label: 'Canvas', icon: Globe },
  { id: 'video',  label: 'Video',  icon: Video },
  { id: 'llm',    label: 'LLM',    icon: Brain },
  { id: 'asr',    label: 'ASR',    icon: Mic },
]

export function SettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>('server')
  const [apiHost, setApiHost] = useState(() => { try { return localStorage.getItem('apiHost') || '' } catch { return '' } })
  const [settings, setSettings] = useState<Settings>({
    canvas_base_url: 'https://oc.sjtu.edu.cn',
    canvas_token:    '',
    ja_auth_cookie:     '',
    ja_session_cookie: '',
    llm_base_url:   'http://localhost:11434/v1',
    llm_api_key:    'ollama',
    llm_model:      'qwen3:8b',
    asr_model:      'base',
    asr_engine:        'translate',
    asr_device:     'cuda',
    asr_api_base:   '',
    asr_api_key:    '',
    asr_api_model:  'whisper-1',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Password visibility
  const [showToken, setShowToken] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [showJa, setShowJa] = useState(false)
  const [showJaSess, setShowJaSess] = useState(false)

  // Test states
  const [videoLoginStatus, setVideoLoginStatus] = useState<'idle' | 'logging_in' | 'done' | 'error'>('idle')

  // QR login state
  const [qrOpen, setQrOpen] = useState(false)
  const [qrUuid, setQrUuid] = useState('')
  const [qrStatus, setQrStatus] = useState('')
  const [qrPolling, setQrPolling] = useState(false)
  const [llmTestMsg, setLlmTestMsg] = useState('')
  const [asrTestMsg, setAsrTestMsg] = useState('')

  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/settings')
      .then(r => r.json())
      .then((s: Settings) => setSettings(prev => ({ ...prev, ...s })))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handle)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings(prev => ({ ...prev, [k]: v }))
  }

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (r.ok) {
        setMsg('Settings saved')
        setTimeout(onClose, 800)
      } else {
        setMsg('Save failed')
      }
    } catch {
      setMsg('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function loginVideo() {
    setVideoLoginStatus('logging_in')
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const { task_id } = await fetch('/api/video/login', { method: 'POST' }).then(r => r.json())
      const poll = setInterval(async () => {
        const t = await fetch(`/api/tasks/${task_id}`).then(r => r.json()).catch(() => null)
        if (!t) return
        if (t.status === 'done') { clearInterval(poll); setVideoLoginStatus('done') }
        if (t.status === 'error') { clearInterval(poll); setVideoLoginStatus('error') }
      }, 1500)
    } catch {
      setVideoLoginStatus('error')
    }
  }

  async function startQrLogin() {
    setQrOpen(true)
    setQrStatus('loading')
    try {
      const r = await fetch('/api/auth/qrcode', { method: 'POST' })
      const data = await r.json()
      setQrUuid(data.uuid)
      setQrStatus('pending')
      // Start polling
      setQrPolling(true)
      const poll = setInterval(async () => {
        const sr = await fetch(`/api/auth/qrcode/${data.uuid}/status`).catch(() => null)
        if (!sr) return
        const s = await sr.json()
        setQrStatus(s.status)
        if (s.status === 'confirmed') {
          clearInterval(poll)
          setQrPolling(false)
          if (s.cookie) {
            set('ja_auth_cookie', s.cookie)
            setQrStatus('done')
          }
        }
        if (s.status === 'expired' || s.status === 'error') {
          clearInterval(poll)
          setQrPolling(false)
        }
      }, 2000)
    } catch {
      setQrStatus('error')
    }
  }

  const isApiMode = settings.asr_engine === 'api'
  const isWhisper = settings.asr_engine === 'faster-whisper'

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full h-full sm:h-auto sm:max-w-xl sm:max-h-[90vh] bg-surface sm:border border-border sm:rounded-xl shadow-modal flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-brand" />
            <h2 className="font-mono text-sm font-semibold text-brand tracking-widest uppercase">SETTINGS</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface2 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="shrink-0 border-b border-border flex overflow-x-auto">
          {TAB_ITEMS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 font-mono text-xs transition-all border-b-2 whitespace-nowrap ${
                tab === t.id
                  ? 'border-brand text-brand bg-brand-bg'
                  : 'border-transparent text-muted hover:text-text hover:border-border2'
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {loading && (
            <div className="text-center py-8 font-mono text-xs text-muted animate-pulse">loading<span className="cursor" /></div>
          )}

          {!loading && tab === 'server' && (
            <>
              <Field label="Backend API Server URL">
                <input
                  value={apiHost}
                  onChange={e => { setApiHost(e.target.value); localStorage.setItem('apiHost', e.target.value); window.location.reload() }}
                  className="field-input"
                  placeholder="http://localhost:8000"
                />
                <p className="field-hint">
                  Where the Python backend runs. Leave empty if frontend and backend share the same origin.
                  In Tauri app, set to <code>http://localhost:8000</code> or your server address.
                  Changes reload the page immediately.
                </p>
              </Field>
            </>
          )}

          {!loading && tab === 'canvas' && (
            <>
              <Field label="Base URL">
                <input value={settings.canvas_base_url} onChange={e => set('canvas_base_url', e.target.value)} className="field-input" placeholder="https://oc.sjtu.edu.cn" />
              </Field>
              <Field label="Access Token">
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={settings.canvas_token}
                    onChange={e => set('canvas_token', e.target.value)}
                    className="field-input pr-10"
                    placeholder="tok_..."
                  />
                  <button onClick={() => setShowToken(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="field-hint">Canvas → Account → Settings → New Access Token</p>
              </Field>
            </>
          )}

          {!loading && tab === 'video' && (
            <>
              {/* QR Code Login */}
              {!qrOpen ? (
                <button
                  onClick={startQrLogin}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border hover:border-brand/40 hover:bg-brand-bg text-muted hover:text-brand transition-all font-mono text-xs"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  扫码登录 jAccount（无需手动复制 Cookie）
                </button>
              ) : (
                <div className="border border-border rounded-xl p-4 space-y-3 bg-surface2 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-text-mid">jAccount 扫码登录</span>
                    {qrStatus === 'pending' || qrStatus === 'scanned' ? (
                      <span className="font-mono text-xs text-brand animate-pulse">
                        {qrStatus === 'scanned' ? '已扫码，请在手机上确认' : '等待扫码...'}
                      </span>
                    ) : qrStatus === 'done' ? (
                      <span className="font-mono text-xs text-success">已登录 ✓</span>
                    ) : qrStatus === 'expired' ? (
                      <span className="font-mono text-xs text-error">二维码已过期</span>
                    ) : qrStatus === 'error' ? (
                      <span className="font-mono text-xs text-error">获取失败</span>
                    ) : null}
                  </div>

                  {qrStatus !== 'error' && qrUuid && (
                    <div className="flex justify-center bg-white rounded-lg p-3">
                      <img
                        src={`/api/auth/qrcode/${qrUuid}/image`}
                        alt="jAccount QR Code"
                        className="w-48 h-48"
                      />
                    </div>
                  )}

                  {(qrStatus === 'expired' || qrStatus === 'error') && (
                    <button
                      onClick={startQrLogin}
                      className="w-full font-mono text-xs px-3 py-2 rounded-lg border border-border text-muted hover:text-brand transition-colors"
                    >
                      重新获取二维码
                    </button>
                  )}
                  {qrStatus !== 'done' && qrStatus !== 'expired' && qrStatus !== 'error' && (
                    <p className="font-mono text-xs text-faint text-center">
                      使用手机 jAccount 扫描二维码登录
                    </p>
                  )}
                  {qrStatus === 'done' && (
                    <p className="font-mono text-xs text-success text-center">
                      Cookie 已自动填入，可点击下方按钮测试登录
                    </p>
                  )}
                </div>
              )}

              <Field label="JAAuthCookie (from logged-in browser)">
                <div className="relative">
                  <input
                    type={showJa ? 'text' : 'password'}
                    value={settings.ja_auth_cookie}
                    onChange={e => set('ja_auth_cookie', e.target.value)}
                    className="field-input pr-10"
                    placeholder="Paste JAAuthCookie value"
                  />
                  <button onClick={() => setShowJa(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                    {showJa ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="field-hint">
                  Login to <strong>my.sjtu.edu.cn</strong> → F12 DevTools → Application → Cookies → <code>JAAuthCookie</code>
                </p>
              </Field>
              <Button
                variant="secondary"
                onClick={loginVideo}
                disabled={videoLoginStatus === 'logging_in' || !settings.ja_auth_cookie}
              >
                {videoLoginStatus === 'idle' && <><Video size={12} /> Login video platform</>}
                {videoLoginStatus === 'logging_in' && <><Loader2 size={12} className="animate-spin" /> Logging in...</>}
                {videoLoginStatus === 'done' && <><Check size={12} /> Logged in</>}
                {videoLoginStatus === 'error' && <><X size={12} /> Login failed</>}
              </Button>

              <div className="border-t border-border pt-4">
                <Field label="JA_SESSION_COOKIE (translate.sjtu.edu.cn)">
                  <div className="relative">
                    <input
                      type={showJaSess ? 'text' : 'password'}
                      value={settings.ja_session_cookie}
                      onChange={e => set('ja_session_cookie', e.target.value)}
                      className="field-input pr-10"
                      placeholder="Paste Cookie (JSESSIONID, keepalive, etc.)"
                    />
                    <button onClick={() => setShowJaSess(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                      {showJaSess ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="field-hint">
                    Login to <strong>translate.sjtu.edu.cn</strong> → F12 → Cookies → <code>JSESSIONID</code>
                  </p>
                </Field>
              </div>
            </>
          )}

          {!loading && tab === 'llm' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {LLM_PRESETS.map(p => {
                  const active = settings.llm_base_url === p.base_url
                  return (
                    <button
                      key={p.label}
                      onClick={() => { set('llm_base_url', p.base_url); set('llm_api_key', p.api_key) }}
                      className={`font-mono text-xs px-3 py-1.5 rounded-lg border transition-all ${
                        active ? 'border-accent/50 bg-accent-bg text-accent' : 'border-border text-muted hover:border-border2'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>

              <Field label="API Base URL">
                <input value={settings.llm_base_url} onChange={e => set('llm_base_url', e.target.value)} className="field-input" />
              </Field>

              <Field label="API Key">
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.llm_api_key}
                    onChange={e => set('llm_api_key', e.target.value)}
                    className="field-input pr-10"
                  />
                  <button onClick={() => setShowKey(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>

              <Field label="Model">
                <input value={settings.llm_model} onChange={e => set('llm_model', e.target.value)} className="field-input" placeholder="qwen3:8b" />
                <p className="field-hint">
                  Ollama: <code>ollama pull qwen3:14b</code> · MiniMax: <code>MiniMax-M2.7</code>
                </p>
              </Field>

              <Button variant="secondary" onClick={async () => {
                setLlmTestMsg('')
                try {
                  const r = await fetch('/api/settings/test_llm', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ base_url: settings.llm_base_url, api_key: settings.llm_api_key, model: settings.llm_model }),
                  })
                  const d = await r.json()
                  setLlmTestMsg(r.ok ? `Connected: ${d.reply ?? 'ok'}` : `${d.error ?? 'failed'}`)
                } catch (e: unknown) {
                  setLlmTestMsg(`${e instanceof Error ? e.message : String(e)}`)
                }
              }}>
                <Mic size={12} /> Test connection
              </Button>
              {llmTestMsg && (
                <p className={`font-mono text-xs ${llmTestMsg.startsWith('Connected') ? 'text-success' : 'text-error'}`}>{llmTestMsg}</p>
              )}
            </>
          )}

          {!loading && tab === 'asr' && (
            <>
              <Field label="Engine">
                <div className="flex gap-2 flex-wrap">
                  {ASR_ENGINES.map(m => (
                    <button
                      key={m.value}
                      onClick={() => set('asr_engine', m.value)}
                      className={`font-mono text-xs px-4 py-2 rounded-lg border transition-all ${
                        settings.asr_engine === m.value ? 'border-accent/50 bg-accent-bg text-accent' : 'border-border text-muted hover:border-border2'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Field>

              {isApiMode ? (
                <>
                  <Field label="API Base URL">
                    <input value={settings.asr_api_base} onChange={e => set('asr_api_base', e.target.value)} className="field-input" placeholder="https://api.openai.com/v1" />
                  </Field>
                  <Field label="API Key">
                    <input type="password" value={settings.asr_api_key} onChange={e => set('asr_api_key', e.target.value)} className="field-input" placeholder="sk-..." />
                  </Field>
                  <Field label="Model">
                    <input value={settings.asr_api_model} onChange={e => set('asr_api_model', e.target.value)} className="field-input" placeholder="whisper-1" />
                  </Field>
                  <Button variant="secondary" onClick={async () => {
                    setAsrTestMsg('')
                    try {
                      const r = await fetch('/api/settings/test_asr', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ base_url: settings.asr_api_base, api_key: settings.asr_api_key, model: settings.asr_api_model }),
                      })
                      const d = await r.json()
                      setAsrTestMsg(r.ok ? 'Connected' : `${d.detail ?? 'failed'}`)
                    } catch (e: unknown) {
                      setAsrTestMsg(`${e instanceof Error ? e.message : String(e)}`)
                    }
                  }}>
                    <Mic size={12} /> Test connection
                  </Button>
                  {asrTestMsg && (
                    <p className={`font-mono text-xs ${asrTestMsg.startsWith('Connected') ? 'text-success' : 'text-error'}`}>{asrTestMsg}</p>
                  )}
                </>
              ) : (
                <>
                  <Field label="Model">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ASR_MODELS.map(p => (
                        <button
                          key={p.value}
                          onClick={() => set('asr_model', p.value)}
                          className={`font-mono text-xs px-3 py-1.5 rounded-lg border transition-all ${
                            settings.asr_model === p.value ? 'border-accent/50 bg-accent-bg text-accent' : 'border-border text-muted'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <p className="field-hint">
                      {isWhisper ? 'VRAM: base≈1.5GB · small≈2.5GB · medium≈3.5GB · large-v3≈5.5GB' : 'Upload audio/video files directly to SJTU transcription service'}
                    </p>
                  </Field>
                  <Field label="Device">
                    <div className="flex gap-2">
                      {['cuda', 'cpu'].map(d => (
                        <button
                          key={d}
                          onClick={() => set('asr_device', d)}
                          className={`font-mono text-xs px-4 py-2 rounded-lg border transition-all ${
                            settings.asr_device === d ? 'border-accent/50 bg-accent-bg text-accent' : 'border-border text-muted'
                          }`}
                        >
                          {d === 'cuda' ? 'GPU' : 'CPU'}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-4">
          <div>
            {msg && (
              <span className={`font-mono text-xs ${msg.startsWith('Settings') ? 'text-success' : 'text-error'}`}>
                {msg}
              </span>
            )}
          </div>
          <div className="flex gap-3 ml-auto">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={saving}><Check size={14} /> Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-xs text-muted mb-1.5 tracking-wide">{label}</label>
      {children}
    </div>
  )
}
