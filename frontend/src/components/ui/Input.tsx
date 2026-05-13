import { type InputHTMLAttributes, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  hint?: string
  error?: string
  icon?: React.ReactNode
}

export function Input({ hint, error, icon, className = '', id, ...rest }: Props) {
  const [show, setShow] = useState(false)
  const isPassword = rest.type === 'password'
  const inputType = isPassword ? (show ? 'text' : 'password') : rest.type

  return (
    <div>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">{icon}</span>
        )}
        <input
          id={id}
          {...rest}
          type={inputType}
          className={`field-input ${icon ? 'pl-9' : ''} ${isPassword ? 'pr-10' : ''}
            ${error ? '!border-error focus:!shadow-[0_0_0_3px_var(--error-bg)]' : ''}
            ${className}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted hover:text-text transition-colors"
            tabIndex={-1}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {error && <p className="field-hint text-error">{error}</p>}
      {hint && !error && <p className="field-hint">{hint}</p>}
    </div>
  )
}
