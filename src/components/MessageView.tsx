import { Check, Copy, Pencil, RefreshCw, Square, Volume2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { Message } from '../lib/types'
import { FileCard } from './AttachmentViews'
import { Markdown } from './Markdown'

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="icon-btn sm"
      aria-label="Copy"
      data-tip={done ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  )
}

interface Props {
  message: Message
  streaming: boolean
  thinking: boolean
  isLast: boolean
  speaking: boolean
  onEdit: (id: string, text: string) => void
  onRegenerate: () => void
  onSpeak: (m: Message) => void
  onOpenImage: (src: string) => void
}

export const MessageView = memo(function MessageView({
  message: m,
  streaming,
  thinking,
  isLast,
  speaking,
  onEdit,
  onRegenerate,
  onSpeak,
  onOpenImage,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing || !editRef.current) return
    const el = editRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [editing])

  if (m.role === 'user') {
    const images = m.attachments?.filter((a) => a.kind === 'image') ?? []
    const files = m.attachments?.filter((a) => a.kind !== 'image') ?? []
    return (
      <div className="turn user">
        {images.length > 0 && (
          <div className={`sent-images n${Math.min(images.length, 4)}`}>
            {images.map((a) => (
              <img key={a.id} src={a.dataUrl} alt={a.name} onClick={() => onOpenImage(a.dataUrl!)} />
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="sent-files">
            {files.map((a) => (
              <FileCard key={a.id} a={a} />
            ))}
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (draft.trim()) {
                    setEditing(false)
                    onEdit(m.id, draft.trim())
                  }
                }
              }}
            />
            <div className="edit-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!draft.trim()}
                onClick={() => {
                  setEditing(false)
                  onEdit(m.id, draft.trim())
                }}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            {m.content && <div className="bubble">{m.content}</div>}
            <div className="actions user-actions">
              {m.content && <CopyButton text={m.content} />}
              <button
                type="button"
                className="icon-btn sm"
                aria-label="Edit message"
                data-tip="Edit message"
                onClick={() => {
                  setDraft(m.content)
                  setEditing(true)
                }}
              >
                <Pencil size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  const empty = !m.content && !m.error
  return (
    <div className="turn assistant">
      {m.thoughtFor ? <div className="thought">Thought for {m.thoughtFor}s</div> : null}
      {empty && streaming ? (
        thinking ? <div className="shimmer">Thinking</div> : <div className="dot-pulse" aria-label="Waiting for reply" />
      ) : (
        <Markdown text={m.content} streaming={streaming} />
      )}
      {m.error && (
        <div className="error-card">
          <span>{m.error}</span>
          {isLast && (
            <button type="button" className="btn ghost" onClick={onRegenerate}>
              Retry
            </button>
          )}
        </div>
      )}
      {!streaming && m.content && (
        <div className={`actions ${isLast ? 'always' : ''}`}>
          <CopyButton text={m.content} />
          <button
            type="button"
            className="icon-btn sm"
            aria-label={speaking ? 'Stop reading' : 'Read aloud'}
            data-tip={speaking ? 'Stop' : 'Read aloud'}
            onClick={() => onSpeak(m)}
          >
            {speaking ? <Square size={14} fill="currentColor" /> : <Volume2 size={16} />}
          </button>
          {isLast && (
            <button type="button" className="icon-btn sm" aria-label="Regenerate" data-tip="Try again" onClick={onRegenerate}>
              <RefreshCw size={16} />
            </button>
          )}
          {m.model && <span className="model-tag">{m.model}</span>}
        </div>
      )}
    </div>
  )
})
