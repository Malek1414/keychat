import { ArrowUp, AudioLines, Camera, Check, Loader2, Mic, Paperclip, Plus, Square, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { isImageFile, processFile, uid } from '../lib/attachments'
import { transcribe } from '../lib/providers'
import type { Attachment, Settings } from '../lib/types'
import { browserRecognition, Recorder } from '../lib/voice'
import { AttachmentTray, type PendingAttachment } from './AttachmentViews'
import { Waveform } from './Waveform'

export interface ComposerHandle {
  addFiles: (files: File[]) => void
  focus: () => void
}

interface Props {
  settings: Settings
  busy: boolean
  placeholder: string
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onVoiceMode: () => void
  onOpenImage: (src: string) => void
  onError: (msg: string) => void
}

const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { settings, busy, placeholder, onSend, onStop, onVoiceMode, onOpenImage, onError },
  ref,
) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [menu, setMenu] = useState(false)
  const [dictation, setDictation] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const recorder = useRef<Recorder | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const resize = useCallback(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [])

  useEffect(resize, [text, resize])

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      const items: PendingAttachment[] = files.map((f) => ({
        id: uid(),
        name: f.name || 'pasted image',
        isImage: isImageFile(f),
        previewUrl: isImageFile(f) ? URL.createObjectURL(f) : undefined,
      }))
      setPending((p) => [...p, ...items].slice(0, 10))
      items.forEach((item, i) => {
        processFile(files[i])
          .then((ready) => setPending((p) => p.map((x) => (x.id === item.id ? { ...x, ready } : x))))
          .catch((e: Error) => {
            onError(e.message)
            setPending((p) => p.filter((x) => x.id !== item.id))
          })
          .finally(() => item.previewUrl && setTimeout(() => URL.revokeObjectURL(item.previewUrl!), 4000))
      })
      textarea.current?.focus()
    },
    [onError],
  )

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textarea.current?.focus() }), [addFiles])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const uploading = pending.some((p) => !p.ready)
  const hasContent = text.trim().length > 0 || pending.length > 0
  const canSend = hasContent && !uploading && !busy && dictation === 'idle'

  const send = () => {
    if (!canSend) return
    onSend(
      text.trim(),
      pending.map((p) => p.ready!).filter(Boolean),
    )
    setText('')
    setPending([])
  }

  const startDictation = async () => {
    const useBrowser = !settings.openaiKey
    if (useBrowser && !browserRecognition()) {
      onError('Voice typing needs an OpenAI API key (for transcription). Add one in Settings.')
      return
    }
    const r = new Recorder()
    try {
      await r.start(useBrowser)
      recorder.current = r
      setDictation('recording')
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const cancelDictation = () => {
    recorder.current?.cancel()
    recorder.current = null
    setDictation('idle')
  }

  const finishDictation = async () => {
    const r = recorder.current
    if (!r) return
    setDictation('transcribing')
    try {
      const blob = await r.stop()
      const said = settings.openaiKey ? await transcribe(settings, blob) : r.recognitionText
      if (said) {
        setText((t) => (t.trim() ? t.replace(/\s*$/, ' ') : '') + said)
        requestAnimationFrame(() => {
          const el = textarea.current
          el?.focus()
          el?.setSelectionRange(el.value.length, el.value.length)
        })
      }
    } catch (e) {
      onError('Couldn’t transcribe that: ' + (e as Error).message)
    } finally {
      recorder.current = null
      setDictation('idle')
    }
  }

  const level = useCallback(() => recorder.current?.level() ?? 0, [])

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dictation !== 'idle' ? 'dictating' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) textarea.current?.focus()
        }}
      >
        <AttachmentTray items={pending} onRemove={(id) => setPending((p) => p.filter((x) => x.id !== id))} onOpenImage={onOpenImage} />

        <textarea
          ref={textarea}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
              e.preventDefault()
              send()
            }
          }}
        />

        <div className="composer-row">
          <div className="menu-anchor" ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Add photos and files"
              data-tip="Add photos & files"
              onClick={() => setMenu((m) => !m)}
            >
              <Plus size={20} />
            </button>
            {menu && (
              <div className="popover up" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false)
                    fileInput.current?.click()
                  }}
                >
                  <Paperclip size={18} /> Add photos & files
                </button>
                {isTouch() && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      cameraInput.current?.click()
                    }}
                  >
                    <Camera size={18} /> Take photo
                  </button>
                )}
              </div>
            )}
          </div>

          {dictation !== 'idle' ? (
            <div className="dictation">
              <Waveform level={level} active={dictation === 'recording'} />
              <button type="button" className="icon-btn" aria-label="Cancel dictation" data-tip="Cancel" onClick={cancelDictation} disabled={dictation === 'transcribing'}>
                <X size={20} />
              </button>
              <button type="button" className="round-btn" aria-label="Done" data-tip="Done" onClick={finishDictation} disabled={dictation === 'transcribing'}>
                {dictation === 'transcribing' ? <Loader2 size={18} className="spin" /> : <Check size={18} strokeWidth={2.6} />}
              </button>
            </div>
          ) : (
            <div className="composer-right">
              <button type="button" className="icon-btn" aria-label="Dictate" data-tip="Dictate" onClick={startDictation}>
                <Mic size={20} />
              </button>
              {busy ? (
                <button type="button" className="round-btn" aria-label="Stop generating" data-tip="Stop" onClick={onStop}>
                  <Square size={13} fill="currentColor" />
                </button>
              ) : hasContent ? (
                <button type="button" className="round-btn" aria-label="Send" data-tip="Send" disabled={!canSend} onClick={send}>
                  <ArrowUp size={20} strokeWidth={2.4} />
                </button>
              ) : (
                <button type="button" className="round-btn" aria-label="Start voice mode" data-tip="Use voice mode" onClick={onVoiceMode}>
                  <AudioLines size={19} />
                </button>
              )}
            </div>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept="image/*,.heic,.heif,application/pdf,.pdf,text/*,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.java,.go,.rs,.rb,.php,.c,.cpp,.h,.cs,.swift,.kt,.sql,.yml,.yaml,.xml,.html,.css,.sh,.toml"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      <div className="disclaimer">AI can make mistakes. Check important info.</div>
    </div>
  )
})
