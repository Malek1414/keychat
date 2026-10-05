import { FileCode2, FileText, Loader2, X } from 'lucide-react'
import { fileLabel } from '../lib/attachments'
import type { Attachment } from '../lib/types'

export interface PendingAttachment {
  id: string
  name: string
  /** Local preview while an image is still being processed. */
  previewUrl?: string
  isImage: boolean
  ready?: Attachment
}

function FileIcon({ a }: { a: Pick<Attachment, 'kind' | 'name'> }) {
  const pdf = a.kind === 'pdf'
  return (
    <div className={`file-icon ${pdf ? 'pdf' : 'doc'}`}>
      {pdf ? <FileText size={20} /> : <FileCode2 size={20} />}
    </div>
  )
}

export function FileCard({ a, onRemove, loading }: { a: Pick<Attachment, 'kind' | 'name'> & Partial<Attachment>; onRemove?: () => void; loading?: boolean }) {
  return (
    <div className="file-card">
      {loading ? (
        <div className="file-icon doc">
          <Loader2 size={18} className="spin" />
        </div>
      ) : (
        <FileIcon a={a} />
      )}
      <div className="file-meta">
        <div className="file-name" title={a.name}>
          {a.name}
        </div>
        <div className="file-type">{loading ? 'Uploading…' : fileLabel(a as Attachment)}</div>
      </div>
      {onRemove && (
        <button type="button" className="remove-chip" aria-label={`Remove ${a.name}`} onClick={onRemove}>
          <X size={12} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

/** The tray above the composer, styled like ChatGPT's: square photo thumbnails and file cards. */
export function AttachmentTray({
  items,
  onRemove,
  onOpenImage,
}: {
  items: PendingAttachment[]
  onRemove: (id: string) => void
  onOpenImage: (src: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="tray">
      {items.map((p) =>
        p.isImage ? (
          <div key={p.id} className="thumb">
            {(p.ready?.dataUrl || p.previewUrl) && (
              <img
                src={p.ready?.dataUrl || p.previewUrl}
                alt={p.name}
                onClick={() => onOpenImage(p.ready?.dataUrl || p.previewUrl!)}
              />
            )}
            {!p.ready && (
              <div className="thumb-loading">
                <Loader2 size={18} className="spin" />
              </div>
            )}
            <button type="button" className="remove-chip" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>
              <X size={12} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <FileCard
            key={p.id}
            a={p.ready ?? { kind: /\.pdf$/i.test(p.name) ? 'pdf' : 'text', name: p.name }}
            loading={!p.ready}
            onRemove={() => onRemove(p.id)}
          />
        ),
      )}
    </div>
  )
}
