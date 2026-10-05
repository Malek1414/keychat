import { Download, X } from 'lucide-react'
import { useEffect } from 'react'

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <a className="icon-btn light" href={src} download="image" aria-label="Download">
          <Download size={20} />
        </a>
        <button type="button" className="icon-btn light" aria-label="Close" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
