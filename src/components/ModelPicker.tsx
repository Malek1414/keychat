import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelOption } from '../lib/types'

interface Props {
  models: ModelOption[]
  value: ModelOption | undefined
  loading: boolean
  onChange: (id: string) => void
  onRefresh: () => void
}

export function ModelPicker({ models, value, loading, onChange, onRefresh }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle ? models.filter((m) => (m.label + m.model).toLowerCase().includes(needle)) : models
    return (
      [
        ['Anthropic', list.filter((m) => m.provider === 'anthropic')],
        ['OpenAI', list.filter((m) => m.provider === 'openai')],
      ] as const
    ).filter(([, l]) => l.length)
  }, [models, q])

  return (
    <div className="model-picker no-drag" ref={root}>
      <button type="button" className="model-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span>{value?.label ?? 'Choose a model'}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="popover model-menu" role="listbox">
          {models.length > 8 && (
            <input className="model-search" autoFocus placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <div className="model-scroll">
            {models.length === 0 && <div className="model-empty">Add an API key in Settings to see models.</div>}
            {groups.map(([label, list]) => (
              <div key={label}>
                <div className="menu-label">{label}</div>
                {list.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    role="option"
                    aria-selected={m.id === value?.id}
                    className="model-item"
                    onClick={() => {
                      onChange(m.id)
                      setOpen(false)
                      setQ('')
                    }}
                  >
                    <div>
                      <div className="model-name">{m.label}</div>
                      {m.label !== m.model && <div className="model-id">{m.model}</div>}
                    </div>
                    {m.id === value?.id && <Check size={18} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <button type="button" className="model-refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh model list
          </button>
        </div>
      )}
    </div>
  )
}
