import type { Attachment } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const MAX_EDGE = 2048
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024
const MAX_PDF_BYTES = 30 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const PASSTHROUGH = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|yml|yaml|toml|ini|env|sql|log|tex|r|lua|dart|vue|svelte)$/i

export class AttachmentError extends Error {}

function readAs(file: Blob, mode: 'dataUrl' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    if (mode === 'dataUrl') r.readAsDataURL(file)
    else r.readAsText(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new AttachmentError('This image format can’t be opened here. Try a JPG or PNG.'))
    img.src = src
  })
}

/**
 * Images are normalised the way ChatGPT does it: anything huge or in an exotic
 * format (HEIC, BMP, TIFF) is redrawn to at most 2048px on the long edge and
 * re-encoded, so it stays under the providers' size limits.
 */
async function processImage(file: File): Promise<Attachment> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const { naturalWidth: w, naturalHeight: h } = img
    const fits = PASSTHROUGH.has(file.type) && Math.max(w, h) <= MAX_EDGE && file.size <= MAX_IMAGE_BYTES
    if (fits) {
      return {
        id: uid(), kind: 'image', name: file.name || 'image', mime: file.type,
        size: file.size, dataUrl: await readAs(file, 'dataUrl'), width: w, height: h,
      }
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
    const cw = Math.round(w * scale)
    const ch = Math.round(h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp'
    const mime = keepAlpha ? 'image/webp' : 'image/jpeg'
    if (!keepAlpha) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, cw, ch)
    }
    ctx.drawImage(img, 0, 0, cw, ch)
    let quality = 0.9
    let dataUrl = canvas.toDataURL(mime, quality)
    while (dataUrl.length * 0.75 > MAX_IMAGE_BYTES && quality > 0.5) {
      quality -= 0.1
      dataUrl = canvas.toDataURL(mime, quality)
    }
    return {
      id: uid(), kind: 'image', name: file.name || 'image', mime,
      size: Math.round(dataUrl.length * 0.75), dataUrl, width: cw, height: ch,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function isImageFile(f: File) {
  return f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)
}

export async function processFile(file: File): Promise<Attachment> {
  if (isImageFile(file)) return processImage(file)

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new AttachmentError(`${file.name} is larger than 30 MB.`)
    return {
      id: uid(), kind: 'pdf', name: file.name, mime: 'application/pdf',
      size: file.size, dataUrl: await readAs(file, 'dataUrl'),
    }
  }

  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json') {
    if (file.size > MAX_TEXT_BYTES) throw new AttachmentError(`${file.name} is larger than 2 MB.`)
    return {
      id: uid(), kind: 'text', name: file.name, mime: file.type || 'text/plain',
      size: file.size, text: await readAs(file, 'text'),
    }
  }

  throw new AttachmentError(`${file.name}: this file type isn’t supported. Try images, PDFs, or text and code files.`)
}

export function fileLabel(a: Attachment) {
  if (a.kind === 'pdf') return 'PDF'
  const ext = a.name.split('.').pop()?.toUpperCase()
  if (ext && ext.length <= 5 && ext !== a.name.toUpperCase()) return ext
  return 'File'
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
