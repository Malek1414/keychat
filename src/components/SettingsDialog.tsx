import { Eye, EyeOff, KeyRound, Loader2, Lock, SlidersHorizontal, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listModels } from '../lib/providers'
import type { ModelOption, Settings } from '../lib/types'

const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']

function KeyField({ label, value, onChange, placeholder, href }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; href: string }) {
  const [show, setShow] = useState(false)
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <a href={href} target="_blank" rel="noreferrer noopener">
          Get a key
        </a>
      </span>
      <div className="key-input">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <button type="button" className="icon-btn sm" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  )
}

interface Props {
  settings: Settings
  firstRun: boolean
  onClose: () => void
  onSave: (s: Settings, models: ModelOption[]) => void
  onClearChats: () => void
}

export function SettingsDialog({ settings, firstRun, onClose, onSave, onClearChats }: Props) {
  const [tab, setTab] = useState<'keys' | 'personal' | 'general'>('keys')
  const [draft, setDraft] = useState(settings)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }))

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !firstRun && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [firstRun, onClose])

  const save = async () => {
    setError('')
    if (!draft.openaiKey && !draft.anthropicKey) {
      setError('Add at least one API key.')
      return
    }
    setChecking(true)
    const models = await listModels(draft)
    setChecking(false)
    if (!models.length) {
      setError('Couldn’t load any models with these keys. Double-check them and try again.')
      return
    }
    onSave(draft, models)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !firstRun && onClose()}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-head">
          <h2>{firstRun ? 'Welcome to KeyChat' : 'Settings'}</h2>
          {!firstRun && (
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>

        <div className="settings-body">
          {!firstRun && (
            <div className="settings-tabs">
              <button type="button" className={tab === 'keys' ? 'on' : ''} onClick={() => setTab('keys')}>
                <KeyRound size={17} /> API keys
              </button>
              <button type="button" className={tab === 'personal' ? 'on' : ''} onClick={() => setTab('personal')}>
                <UserRound size={17} /> Personalization
              </button>
              <button type="button" className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>
                <SlidersHorizontal size={17} /> General
              </button>
            </div>
          )}

          <div className="settings-pane">
            {tab === 'keys' && (
              <>
                {firstRun && <p className="lede">Paste an OpenAI key, an Anthropic key, or both. You only pay the provider for what you use.</p>}
                <KeyField
                  label="OpenAI API key"
                  value={draft.openaiKey}
                  onChange={(v) => set('openaiKey', v)}
                  placeholder="sk-..."
                  href="https://platform.openai.com/api-keys"
                />
                <KeyField
                  label="Anthropic API key"
                  value={draft.anthropicKey}
                  onChange={(v) => set('anthropicKey', v)}
                  placeholder="sk-ant-..."
                  href="https://console.anthropic.com/settings/keys"
                />
                <details className="advanced">
                  <summary>Advanced: custom endpoint</summary>
                  <label className="field">
                    <span className="field-label">OpenAI-compatible base URL</span>
                    <input
                      value={draft.openaiBaseUrl}
                      placeholder="https://openrouter.ai/api/v1"
                      spellCheck={false}
                      onChange={(e) => set('openaiBaseUrl', e.target.value.trim())}
                    />
                    <span className="hint">
                      Leave empty for OpenAI. Set it to use OpenRouter, Groq, Together, or a local Ollama/LM Studio server, with
                      that service’s key in the OpenAI field.
                    </span>
                  </label>
                </details>
                <p className="privacy">
                  <Lock size={14} /> Keys are saved only on this device and sent only to the provider you call. There is no
                  server in between.
                </p>
                <p className="hint">Voice typing and read-aloud use your OpenAI key. Without one, the browser’s built-in speech is used where available.</p>
              </>
            )}

            {tab === 'personal' && (
              <label className="field">
                <span className="field-label">Custom instructions</span>
                <span className="hint">What should the model know about you, and how should it respond?</span>
                <textarea
                  rows={8}
                  value={draft.systemPrompt}
                  placeholder="e.g. I'm a student in Berlin. Keep answers short and use simple English."
                  onChange={(e) => set('systemPrompt', e.target.value)}
                />
              </label>
            )}

            {tab === 'general' && (
              <>
                <div className="row-setting">
                  <span>Theme</span>
                  <select value={draft.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                <div className="row-setting">
                  <span>Voice</span>
                  <select value={draft.voice} onChange={(e) => set('voice', e.target.value)}>
                    {VOICES.map((v) => (
                      <option key={v} value={v}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="row-setting">
                  <span>Delete all chats</span>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      if (window.confirm('Delete all chats? This can’t be undone.')) onClearChats()
                    }}
                  >
                    Delete all
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot">
          {!firstRun && (
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="button" className="btn primary" onClick={save} disabled={checking}>
            {checking ? <Loader2 size={16} className="spin" /> : null}
            {firstRun ? 'Start chatting' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
