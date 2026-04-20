import { useEffect, useRef, useState } from 'react'

interface Settings {
  canvas_base_url: string
  canvas_token:    string
  ja_auth_cookie:     string
  llm_base_url:    string
  llm_api_key:     string
  llm_model:       string
  asr_model:       string
  asr_device:      string
}

interface Props { onClose: () => void }

const LLM_PRESETS = [
  { label: 'Ollama (localhost)', base_url: 'http://localhost:11434/v1', api_key: 'ollama' },
  { label: 'OpenAI',            base_url: 'https://api.openai.com/v1',  api_key: '' },
  { label: 'DeepSeek',          base_url: 'https://api.deepseek.com/v1', api_key: '' },
  { label: 'SiliconFlow',       base_url: 'https://api.siliconflow.cn/v1', api_key: '' },
  { label: 'MiniMax (Anthropic)', base_url: 'https://api.minimaxi.com/anthropic', api_key: '' },
  { label: 'Custom',           base_url: '', api_key: '' },
]

const ASR_PRESETS = [
  { label: 'base    (74M)',    value: 'base' },
  { label: 'small   (244M)',  value: 'small' },
  { label: 'medium  (769M)',  value: 'medium' },
  { label: 'large-v3 (1.5B)',  value: 'large-v3' },
]

type VideoLoginStatus = 'idle' | 'logging_in' | 'done' | 'error'

export function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>({
    canvas_base_url: 'https://oc.sjtu.edu.cn',
    canvas_token:    '',
    ja_auth_cookie:      '',
    llm_base_url:   'http://localhost:11434/v1',
    llm_api_key:    'ollama',
    llm_model:      'qwen3:8b',
    asr_model:      'base',
    asr_device:    'cuda',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [showJaPwd, setShowJaPwd] = useState(false)
  const [videoLoginStatus, setVideoLoginStatus] = useState<VideoLoginStatus>('idle')
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((s: Settings) => setSettings(prev => ({ ...prev, ...s })))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings(prev => ({ ...prev, [k]: v }))
  }

  function applyPreset(p: typeof LLM_PRESETS[number]) {
    if (p.label === 'Custom') return
    setSettings(prev => ({ ...prev, llm_base_url: p.base_url, llm_api_key: p.api_key }))
  }

  async function loginVideo() {
    setVideoLoginStatus('logging_in')
    try {
      // Save settings first, then login (login reads from settings.json)
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      await fetch('/api/video/login', { method: 'POST' })
      // Poll task status
      const poll = setInterval(async () => {
        const t = await fetch('/api/tasks/video_login').then(r => r.json()).catch(() => null)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(poll)
          setVideoLoginStatus('done')
        }
        if (t.status === 'error') {
          clearInterval(poll)
          setVideoLoginStatus('error')
        }
      }, 1500)
    } catch {
      setVideoLoginStatus('error')
    }
  }

  async function save() {
    setSaving(true)
    setTestMsg('')
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (r.ok) {
        setTestMsg('✓ Settings saved successfully')
        setTimeout(onClose, 800)
      } else {
        setTestMsg('✕ Save failed')
      }
    } catch {
      setTestMsg('✕ Network error')
    } finally {
      setSaving(false)
    }
  }

  function overlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={overlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative w-full max-w-lg mx-4 rounded-xl border overflow-hidden"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          animation: 'slideUp 0.2s ease forwards',
        }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber font-mono">◈</span>
            <h2 className="font-mono text-sm font-bold text-amber tracking-widest">SETTINGS</h2>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-2 py-1 rounded hover:bg-[var(--surface2)]"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center font-mono text-xs text-[var(--text-muted)] animate-pulse">
            loading<span className="cursor" />
          </div>
        ) : (
          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* ── Canvas ── */}
            <section>
              <h3 className="font-mono text-xs text-amber/80 tracking-wider mb-3 uppercase">
                Canvas API
              </h3>
              <div className="space-y-3">
                <Field label="Base URL">
                  <input
                    value={settings.canvas_base_url}
                    onChange={e => set('canvas_base_url', e.target.value)}
                    className="field-input"
                    placeholder="https://oc.sjtu.edu.cn"
                  />
                </Field>
                <Field label="Access Token">
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={settings.canvas_token}
                      onChange={e => set('canvas_token', e.target.value)}
                      className="field-input pr-10"
                      placeholder="tok_xxxxxxxxxxxxxxxx"
                    />
                    <button
                      onClick={() => setShowToken(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      {showToken ? 'hide' : 'show'}
                    </button>
                  </div>
                  <p className="field-hint">
                    Get from Canvas → Account → Settings → New Access Token
                  </p>
                </Field>
              </div>
            </section>

            <div className="border-t border-[var(--border)]" />

            {/* ── jAccount 录屏登录 ── */}
            <section>
              <h3 className="font-mono text-xs text-amber/80 tracking-wider mb-3 uppercase">
                课堂录屏（jAccount Cookie）
              </h3>
              <Field label="JAAuthCookie（从已登录浏览器复制）">
                <div className="relative">
                  <input
                    type={showJaPwd ? 'text' : 'password'}
                    value={settings.ja_auth_cookie}
                    onChange={e => set('ja_auth_cookie', e.target.value)}
                    className="field-input"
                    placeholder="粘贴 JAAuthCookie 的值"
                  />
                  <button
                    onClick={() => setShowJaPwd(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    {showJaPwd ? 'hide' : 'show'}
                  </button>
                </div>
                <p className="field-hint">
                  获取方式：浏览器登录 <strong>my.sjtu.edu.cn</strong> →
                  F12 开发者工具 → Application → Cookies →
                  找 <code>JAAuthCookie</code>，复制其 Value 值粘贴至此
                </p>
              </Field>
              <div>
                <button
                  onClick={loginVideo}
                  disabled={videoLoginStatus === 'logging_in' || !settings.ja_auth_cookie}
                  className="font-mono text-xs px-4 py-2 rounded border transition-all"
                  style={{
                    background: videoLoginStatus === 'done' ? 'rgba(58,122,80,0.12)' : 'transparent',
                    borderColor: videoLoginStatus === 'done' ? 'rgba(58,122,80,0.5)' :
                                 videoLoginStatus === 'error' ? 'rgba(176,64,48,0.5)' : 'var(--border)',
                    color: videoLoginStatus === 'done' ? 'var(--sage)' :
                           videoLoginStatus === 'error' ? 'var(--rust)' : 'var(--text-muted)',
                  }}
                >
                  {videoLoginStatus === 'idle' && '◎ 登录视频平台'}
                  {videoLoginStatus === 'logging_in' && '⟳ 登录中…'}
                  {videoLoginStatus === 'done' && '✓ 已登录'}
                  {videoLoginStatus === 'error' && '✕ 登录失败'}
                </button>
              </div>
            </section>

            <div className="border-t border-[var(--border)]" />

            {/* ── LLM ── */}
            <section>
              <h3 className="font-mono text-xs text-amber/80 tracking-wider mb-3 uppercase">
                LLM
              </h3>

              {/* Presets */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {LLM_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className="font-mono text-xs px-3 py-1.5 rounded border transition-all"
                    style={{
                      background: settings.llm_base_url === p.base_url ? 'rgba(212,168,71,0.12)' : 'transparent',
                      borderColor: settings.llm_base_url === p.base_url ? 'rgba(212,168,71,0.5)' : 'var(--border)',
                      color: settings.llm_base_url === p.base_url ? 'var(--amber)' : 'var(--text-muted)',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <Field label="API Base URL">
                  <input
                    value={settings.llm_base_url}
                    onChange={e => set('llm_base_url', e.target.value)}
                    className="field-input"
                    placeholder="http://localhost:11434/v1"
                  />
                </Field>
                <Field label="API Key">
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={settings.llm_api_key}
                      onChange={e => set('llm_api_key', e.target.value)}
                      className="field-input pr-10"
                      placeholder="ollama / sk-..."
                    />
                    <button
                      onClick={() => setShowKey(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      {showKey ? 'hide' : 'show'}
                    </button>
                  </div>
                </Field>
                <Field label="Model">
                  <input
                    value={settings.llm_model}
                    onChange={e => set('llm_model', e.target.value)}
                    className="field-input"
                    placeholder="qwen3:8b"
                  />
                  <p className="field-hint">
                    Ollama: <code className="text-amber/60">ollama pull qwen3:14b</code>
                    &nbsp;·&nbsp; MiniMax: <code className="text-amber/60">MiniMax-M2.7</code>（推理）或 <code className="text-amber/60">MiniMax-Text-01</code>（对话）
                  </p>
                </Field>
                <button
                  onClick={async () => {
                    setTestMsg('')
                    try {
                      const r = await fetch('/api/settings/test_llm', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          base_url: settings.llm_base_url,
                          api_key: settings.llm_api_key,
                          model: settings.llm_model,
                        }),
                      })
                      const data = await r.json()
                      setTestMsg(r.ok ? `✓ 连接成功：${data.reply ?? 'ok'}` : `✕ ${data.error ?? 'failed'}`)
                    } catch (e: unknown) {
                      setTestMsg(`✕ ${e instanceof Error ? e.message : String(e)}`)
                    }
                  }}
                  className="font-mono text-xs px-3 py-1.5 rounded border border-sage/30 text-sage hover:bg-sage/10 transition-all"
                >
                  ◎ 测试连接
                </button>
              </div>
            </section>

            <div className="border-t border-[var(--border)]" />

            {/* ── ASR ── */}
            <section>
              <h3 className="font-mono text-xs text-amber/80 tracking-wider mb-3 uppercase">
                ASR
              </h3>
              <div className="space-y-3">
                <Field label="Model">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {ASR_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => set('asr_model', p.value)}
                        className="font-mono text-xs px-3 py-1.5 rounded border transition-all"
                        style={{
                          background:  settings.asr_model === p.value ? 'rgba(122,171,138,0.15)' : 'transparent',
                          borderColor: settings.asr_model === p.value ? 'rgba(122,171,138,0.5)' : 'var(--border)',
                          color:        settings.asr_model === p.value ? 'var(--sage)' : 'var(--text-muted)',
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">
                    Whisper 模型精度从低到高：base → small → medium → large-v3<br/>
                    显存需求：base≈1.5GB · small≈2.5GB · medium≈3.5GB · large-v3≈5.5GB
                  </p>
                </Field>
                <Field label="Device">
                  <div className="flex gap-2">
                    {['cuda', 'cpu'].map(d => (
                      <button
                        key={d}
                        onClick={() => set('asr_device', d)}
                        className="font-mono text-xs px-4 py-2 rounded border transition-all"
                        style={{
                          background:  settings.asr_device === d ? 'rgba(122,171,138,0.15)' : 'transparent',
                          borderColor: settings.asr_device === d ? 'rgba(122,171,138,0.5)' : 'var(--border)',
                          color:        settings.asr_device === d ? 'var(--sage)' : 'var(--text-muted)',
                        }}
                      >
                        {d.toUpperCase()}
                        {d === 'cuda' ? ' ★' : ''}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </section>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-4">
          {testMsg && (
            <span className={`font-mono text-xs ${testMsg.startsWith('✓') ? 'text-sage' : 'text-rust'}`}>
              {testMsg}
            </span>
          )}
          <div className="flex gap-3 ml-auto">
            <button
              onClick={onClose}
              className="font-mono text-xs px-4 py-2 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all"
            >
              cancel
            </button>
            <button
              disabled={saving}
              onClick={save}
              className="font-mono text-xs px-5 py-2 rounded border border-amber/40 text-amber hover:bg-amber/10 disabled:opacity-40 transition-all"
            >
              {saving ? 'saving…' : '✓ save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block font-mono text-xs text-[var(--text-muted)] mb-1.5 tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
