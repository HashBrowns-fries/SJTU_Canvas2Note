import { useEffect, useRef, useState } from 'react'

interface Settings {
  canvas_base_url:    string
  canvas_token:       string
  ja_auth_cookie:     string
  ja_session_cookie:  string   // translate.sjtu.edu.cn Cookie
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

interface Props { onClose: () => void }

const LLM_PRESETS = [
  { label: 'Ollama (localhost)', base_url: 'http://localhost:11434/v1', api_key: 'ollama' },
  { label: 'OpenAI',             base_url: 'https://api.openai.com/v1',  api_key: '' },
  { label: 'DeepSeek',           base_url: 'https://api.deepseek.com/v1', api_key: '' },
  { label: 'SiliconFlow',        base_url: 'https://api.siliconflow.cn/v1', api_key: '' },
  { label: 'MiniMax (Anthropic)', base_url: 'https://api.minimaxi.com/anthropic', api_key: '' },
  { label: 'Custom',             base_url: '', api_key: '' },
]

const ASR_ENGINE_PRESETS = [
  { label: '🎓 交大转录站',     value: 'translate' },
  { label: '⚡ faster-whisper',  value: 'faster-whisper' },
  { label: '☁️  API',             value: 'api' },
]

const ASR_WHISPER_PRESETS = [
  { label: 'base    (74M)',    value: 'base' },
  { label: 'small   (244M)',   value: 'small' },
  { label: 'medium  (769M)',   value: 'medium' },
  { label: 'large-v3 (1.5B)',  value: 'large-v3' },
]

const ASR_API_PRESETS = [
  { label: 'OpenAI Whisper',    value: 'whisper-1' },
  { label: 'SiliconFlow',       value: 'paraformer-zh' },
  { label: 'Custom',             value: '' },
]

type VideoLoginStatus = 'idle' | 'logging_in' | 'done' | 'error'

export function SettingsModal({ onClose }: Props) {
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
  const [testMsg, setTestMsg] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [showJaPwd, setShowJaPwd] = useState(false)
  const [showJaSession, setShowJaSession] = useState(false)
  const [videoLoginStatus, setVideoLoginStatus] = useState<VideoLoginStatus>('idle')
  const [asrApiTestMsg, setAsrApiTestMsg] = useState('')
  const [translateTestMsg, setTranslateTestMsg] = useState('')
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
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      await fetch('/api/video/login', { method: 'POST' })
      const poll = setInterval(async () => {
        const t = await fetch('/api/tasks/video_login').then(r => r.json()).catch(() => null)
        if (!t) return
        if (t.status === 'done') { clearInterval(poll); setVideoLoginStatus('done') }
        if (t.status === 'error') { clearInterval(poll); setVideoLoginStatus('error') }
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

  const isApiMode    = settings.asr_engine === 'api'
  const isWhisperMode = settings.asr_engine === 'faster-whisper'

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
            <span className="text-[var(--green)] font-mono">◈</span>
            <h2 className="font-mono text-sm font-bold text-[var(--green)] tracking-widest">SETTINGS</h2>
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
              <h3 className="font-mono text-xs text-[var(--green)]/80 tracking-wider mb-3 uppercase">
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
              <h3 className="font-mono text-xs text-[var(--green)]/80 tracking-wider mb-3 uppercase">
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
                    color: videoLoginStatus === 'done' ? 'var(--moss)' :
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
              <h3 className="font-mono text-xs text-[var(--green)]/80 tracking-wider mb-3 uppercase">
                LLM
              </h3>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {LLM_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className="font-mono text-xs px-3 py-1.5 rounded border transition-all"
                    style={{
                      background: settings.llm_base_url === p.base_url ? 'rgba(212,168,71,0.12)' : 'transparent',
                      borderColor: settings.llm_base_url === p.base_url ? 'rgba(212,168,71,0.5)' : 'var(--border)',
                      color: settings.llm_base_url === p.base_url ? 'var(--moss)' : 'var(--text-muted)',
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
                    Ollama: <code className="text-[var(--moss)]/60">ollama pull qwen3:14b</code>
                    &nbsp;·&nbsp; MiniMax: <code className="text-[var(--moss)]/60">MiniMax-M2.7</code>（推理）或 <code className="text-[var(--moss)]/60">MiniMax-Text-01</code>（对话）
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
                  className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--moss)]/30 text-[var(--moss)] hover:bg-[var(--moss)]/10 transition-all"
                >
                  ◎ 测试连接
                </button>
              </div>
            </section>

            <div className="border-t border-[var(--border)]" />

            {/* ── Translate Cookie ── */}
            <section>
              <h3 className="font-mono text-xs text-[var(--green)]/80 tracking-wider mb-3 uppercase">
                AI 转录站（translate.sjtu.edu.cn）
              </h3>
              <Field label="JA_SESSION_COOKIE">
                <div className="relative">
                  <input
                    type={showJaSession ? 'text' : 'password'}
                    value={settings.ja_session_cookie}
                    onChange={e => set('ja_session_cookie', e.target.value)}
                    className="field-input"
                    placeholder="粘贴 Cookie（包含 JSESSIONID、keepalive 等）"
                  />
                  <button
                    onClick={() => setShowJaSession(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    {showJaSession ? 'hide' : 'show'}
                  </button>
                </div>
                <p className="field-hint">
                  获取方式：浏览器登录 <strong>translate.sjtu.edu.cn</strong> 后
                  F12 → Application → Cookies → 找 <code>JSESSIONID</code> 和 <code>keepalive</code>，复制完整 Cookie 值粘贴至此
                </p>
              </Field>
              <button
                onClick={async () => {
                  setTranslateTestMsg('')
                  try {
                    const r = await fetch('/api/settings/test_translate', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ cookie: settings.ja_session_cookie }),
                    })
                    const data = await r.json()
                    setTranslateTestMsg(r.ok ? '✓ Cookie 有效' : `✕ ${data.error ?? '无效'}`)
                  } catch (e: unknown) {
                    setTranslateTestMsg(`✕ ${e instanceof Error ? e.message : String(e)}`)
                  }
                }}
                className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--moss)]/30 text-[var(--moss)] hover:bg-[var(--moss)]/10 transition-all"
                disabled={!settings.ja_session_cookie}
              >
                ◎ 测试
              </button>
              {translateTestMsg && (
                <p className={`font-mono text-xs ${translateTestMsg.startsWith('✓') ? 'text-[var(--moss)]' : 'text-[var(--rust)]'}`}>
                  {translateTestMsg}
                </p>
              )}
            </section>

            <div className="border-t border-[var(--border)]" />

            {/* ── ASR ── */}
            <section>
              <h3 className="font-mono text-xs text-[var(--green)]/80 tracking-wider mb-3 uppercase">
                ASR
              </h3>

              {/* 引擎切换 */}
              <Field label="引擎">
                <div className="flex gap-2 mb-3">
                  {ASR_ENGINE_PRESETS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => set('asr_engine', m.value)}
                      className="font-mono text-xs px-4 py-2 rounded border transition-all flex-1"
                      style={{
                        background:  settings.asr_engine === m.value ? 'rgba(122,171,138,0.15)' : 'transparent',
                        borderColor: settings.asr_engine === m.value ? 'rgba(122,171,138,0.5)' : 'var(--border)',
                        color:        settings.asr_engine === m.value ? 'var(--moss)' : 'var(--text-muted)',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Field>

              {isApiMode ? (
                /* ── API 模式配置 ── */
                <div className="space-y-3">
                  <Field label="API Base URL">
                    <input
                      value={settings.asr_api_base}
                      onChange={e => set('asr_api_base', e.target.value)}
                      className="field-input"
                      placeholder="https://api.openai.com/v1"
                    />
                    <p className="field-hint">
                      支持 OpenAI 兼容的 Whisper API（如 OpenAI、SiliconFlow、火山引擎等）
                    </p>
                  </Field>
                  <Field label="API Key">
                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={settings.asr_api_key}
                        onChange={e => set('asr_api_key', e.target.value)}
                        className="field-input pr-10"
                        placeholder="sk-..."
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
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ASR_API_PRESETS.map(p => (
                        <button
                          key={p.label}
                          onClick={() => p.value && set('asr_api_model', p.value)}
                          className="font-mono text-xs px-3 py-1.5 rounded border transition-all"
                          style={{
                            background:  settings.asr_api_model === p.value ? 'rgba(122,171,138,0.15)' : 'transparent',
                            borderColor: settings.asr_api_model === p.value ? 'rgba(122,171,138,0.5)' : 'var(--border)',
                            color:        settings.asr_api_model === p.value ? 'var(--moss)' : 'var(--text-muted)',
                            cursor: p.value === '' ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      value={settings.asr_api_model}
                      onChange={e => set('asr_api_model', e.target.value)}
                      className="field-input"
                      placeholder="whisper-1"
                    />
                  </Field>
                  <button
                    onClick={async () => {
                      setAsrApiTestMsg('')
                      try {
                        const r = await fetch('/api/settings/test_asr', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            base_url: settings.asr_api_base,
                            api_key: settings.asr_api_key,
                            model: settings.asr_api_model,
                          }),
                        })
                        const data = await r.json()
                        setAsrApiTestMsg(r.ok ? '✓ 连接成功' : `✕ ${data.detail ?? 'failed'}`)
                      } catch (e: unknown) {
                        setAsrApiTestMsg(`✕ ${e instanceof Error ? e.message : String(e)}`)
                      }
                    }}
                    className="font-mono text-xs px-3 py-1.5 rounded border border-[var(--moss)]/30 text-[var(--moss)] hover:bg-[var(--moss)]/10 transition-all"
                    disabled={!settings.asr_api_base || !settings.asr_api_key}
                  >
                    ◎ 测试连接
                  </button>
                  {asrApiTestMsg && (
                    <p className={`font-mono text-xs ${asrApiTestMsg.startsWith('✓') ? 'text-[var(--moss)]' : 'text-[var(--rust)]'}`}>
                      {asrApiTestMsg}
                    </p>
                  )}
                </div>
              ) : (
                /* ── 本地模式配置 ── */
                <div className="space-y-3">
                  <Field label="模型">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ASR_WHISPER_PRESETS.map(p => (
                        <button
                          key={p.value}
                          onClick={() => set('asr_model', p.value)}
                          className="font-mono text-xs px-3 py-1.5 rounded border transition-all"
                          style={{
                            background:  settings.asr_model === p.value ? 'rgba(122,171,138,0.15)' : 'transparent',
                            borderColor: settings.asr_model === p.value ? 'rgba(122,171,138,0.5)' : 'var(--border)',
                            color:        settings.asr_model === p.value ? 'var(--moss)' : 'var(--text-muted)',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <p className="field-hint">
                      {isWhisperMode
                        ? <>Whisper 模型精度：base → small → medium → large-v3<br/>显存需求：base≈1.5GB · small≈2.5GB · medium≈3.5GB · large-v3≈5.5GB</>
                        : <>{settings.asr_engine === 'translate' ? '直接上传视频/音频文件，由交大转录站完成转写，无需本地模型' : '使用 OpenAI 兼容 API 进行转写'}</>}
                    </p>
                  </Field>
                  <Field label="硬件">
                    <div className="flex gap-2">
                      {['cuda', 'cpu'].map(d => (
                        <button
                          key={d}
                          onClick={() => set('asr_device', d)}
                          className="font-mono text-xs px-4 py-2 rounded border transition-all"
                          style={{
                            background:  settings.asr_device === d ? 'rgba(122,171,138,0.15)' : 'transparent',
                            borderColor: settings.asr_device === d ? 'rgba(122,171,138,0.5)' : 'var(--border)',
                            color:        settings.asr_device === d ? 'var(--moss)' : 'var(--text-muted)',
                          }}
                        >
                          {d === 'cuda' ? '⚡ GPU ★' : '💻 CPU'}
                        </button>
                      ))}
                    </div>
                    {settings.asr_device === 'cpu' && (
                      <p className="field-hint text-[var(--rust)]/80">⚠ CPU 模式速度较慢，建议使用 GPU</p>
                    )}
                  </Field>
                </div>
              )}
            </section>

          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-4">
          {testMsg && (
            <span className={`font-mono text-xs ${testMsg.startsWith('✓') ? 'text-[var(--moss)]' : 'text-[var(--rust)]'}`}>
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
              className="font-mono text-xs px-5 py-2 rounded border border-[var(--green)]/40 text-[var(--green)] hover:bg-[var(--green)]/10 disabled:opacity-40 transition-all"
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
