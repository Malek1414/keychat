// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentError, fileLabel, formatBytes, isImageFile, processFile, uid } from './attachments'
import type { Attachment } from './types'

/*
 * jsdom has FileReader and File, but it cannot decode images or draw on a
 * canvas. So `Image` is replaced with a fake whose size each test picks, and
 * `document.createElement('canvas')` returns a fake canvas that records what
 * the resize code does with it.
 */

let nextImage: { w: number; h: number } | null
class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_: string) {
    queueMicrotask(() => {
      if (!nextImage) return this.onerror?.()
      this.naturalWidth = nextImage.w
      this.naturalHeight = nextImage.h
      this.onload?.()
    })
  }
}

interface FakeCanvas {
  width: number
  height: number
  ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> }
  getContext: () => FakeCanvas['ctx']
  toDataURL: ReturnType<typeof vi.fn<(mime: string, quality: number) => string>>
}
let canvas: FakeCanvas | null
let encoded: (mime: string, quality: number) => string

const createObjectURL = vi.fn((_: Blob) => 'blob:fake-preview')
const revokeObjectURL = vi.fn((_: string) => undefined)

beforeEach(() => {
  nextImage = { w: 800, h: 600 }
  canvas = null
  encoded = (mime) => `data:${mime};base64,AAAA`
  vi.stubGlobal('Image', FakeImage)
  // jsdom has no object URLs.
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag)
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    canvas = { width: 0, height: 0, ctx, getContext: () => ctx, toDataURL: vi.fn((m: string, q: number) => encoded(m, q)) }
    return canvas as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

const file = (name: string, type: string, content: BlobPart = 'x', size?: number) => {
  const f = new File([content], name, { type })
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}
const MB = 1024 * 1024

describe('isImageFile', () => {
  it('accepts any image/* MIME type', () => {
    expect(isImageFile(file('a.png', 'image/png'))).toBe(true)
    expect(isImageFile(file('a.bmp', 'image/bmp'))).toBe(true)
  })

  it('recognises iPhone HEIC/HEIF photos by extension when the browser gives no MIME type', () => {
    expect(isImageFile(file('IMG_0001.HEIC', ''))).toBe(true)
    expect(isImageFile(file('IMG_0002.heif', ''))).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isImageFile(file('paper.pdf', 'application/pdf'))).toBe(false)
    expect(isImageFile(file('notes.heic.txt', 'text/plain'))).toBe(false)
  })
})

describe('processFile: images', () => {
  it('passes a small JPEG through untouched and frees its object URL', async () => {
    const a = await processFile(file('cat.jpg', 'image/jpeg', 'jpegbytes'))
    expect(a).toMatchObject({ kind: 'image', name: 'cat.jpg', mime: 'image/jpeg', size: 9, width: 800, height: 600 })
    expect(a.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(canvas).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview')
  })

  it('downscales a large PNG to 2048px on the long edge and keeps transparency as WebP', async () => {
    nextImage = { w: 4096, h: 2048 }
    const a = await processFile(file('screenshot.png', 'image/png'))
    expect(canvas).toMatchObject({ width: 2048, height: 1024 })
    expect(canvas!.ctx.fillRect).not.toHaveBeenCalled()
    expect(canvas!.toDataURL).toHaveBeenCalledWith('image/webp', 0.9)
    expect(a).toMatchObject({ kind: 'image', mime: 'image/webp', width: 2048, height: 1024 })
  })

  it('re-encodes HEIC as JPEG on a white background', async () => {
    nextImage = { w: 3024, h: 4032 }
    const a = await processFile(file('IMG_0001.HEIC', ''))
    expect(canvas).toMatchObject({ width: 1536, height: 2048 })
    expect(canvas!.ctx.fillStyle).toBe('#fff')
    expect(canvas!.ctx.fillRect).toHaveBeenCalledWith(0, 0, 1536, 2048)
    expect(a.mime).toBe('image/jpeg')
  })

  it('re-encodes an image that is small in pixels but too heavy in bytes (> 3.5 MB)', async () => {
    nextImage = { w: 1200, h: 900 }
    const a = await processFile(file('raw.jpg', 'image/jpeg', 'x', 4 * MB))
    expect(canvas).toMatchObject({ width: 1200, height: 900 })
    expect(a.size).toBe(Math.round(a.dataUrl!.length * 0.75))
  })

  it('lowers JPEG quality step by step until the result fits', async () => {
    nextImage = { w: 5000, h: 5000 }
    const huge = 'x'.repeat(5 * MB)
    encoded = (mime, q) => (q > 0.75 ? huge : `data:${mime};base64,small`)
    const a = await processFile(file('big.jpg', 'image/jpeg'))
    const qualities = canvas!.toDataURL.mock.calls.map((c) => c[1])
    expect(qualities).toHaveLength(3)
    expect(qualities[0]).toBe(0.9)
    expect(qualities[1]).toBeCloseTo(0.8)
    expect(qualities[2]).toBeCloseTo(0.7)
    expect(a.dataUrl).toBe('data:image/jpeg;base64,small')
  })

  it('stops lowering quality at a floor instead of looping forever', async () => {
    nextImage = { w: 5000, h: 5000 }
    const huge = 'x'.repeat(5 * MB)
    encoded = () => huge
    await processFile(file('noise.jpg', 'image/jpeg'))
    const qualities = canvas!.toDataURL.mock.calls.map((c) => c[1])
    // 0.9 -> 0.4: the floor check is `quality > 0.5`, and 0.9 - 4 * 0.1 is
    // 0.5000000000000001 in floating point, so one more step is taken.
    expect(qualities).toHaveLength(6)
    expect(qualities.at(-1)).toBeCloseTo(0.4)
  })

  it('reports images the browser cannot decode, and still frees the object URL', async () => {
    nextImage = null
    const err = await processFile(file('weird.tiff', 'image/tiff')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AttachmentError)
    expect((err as Error).message).toContain('can’t be opened')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview')
  })
})

describe('processFile: PDFs and text', () => {
  it('reads a PDF (by MIME type or by extension) as a data URL', async () => {
    const byType = await processFile(file('paper.pdf', 'application/pdf', '%PDF-1.4'))
    const byExt = await processFile(file('SCAN.PDF', '', '%PDF-1.4'))
    for (const a of [byType, byExt]) {
      expect(a).toMatchObject({ kind: 'pdf', mime: 'application/pdf', size: 8 })
      expect(a.dataUrl).toMatch(/^data:.*;base64,JVBERi0xLjQ=$/)
    }
  })

  it('rejects PDFs over 30 MB before reading them', async () => {
    await expect(processFile(file('book.pdf', 'application/pdf', 'x', 31 * MB))).rejects.toThrow('book.pdf is larger than 30 MB.')
  })

  it('decodes text and code files to a string', async () => {
    const md = await processFile(file('notes.md', '', '# Hello'))
    expect(md).toMatchObject({ kind: 'text', name: 'notes.md', mime: 'text/plain', text: '# Hello' })
    const json = await processFile(file('data.json', 'application/json', '{"a":1}'))
    expect(json).toMatchObject({ kind: 'text', mime: 'application/json', text: '{"a":1}' })
    const csv = await processFile(file('table', 'text/csv', 'a,b'))
    expect(csv.text).toBe('a,b')
  })

  it('rejects text files over 2 MB', async () => {
    await expect(processFile(file('log.txt', 'text/plain', 'x', 3 * MB))).rejects.toThrow('log.txt is larger than 2 MB.')
  })

  it('rejects unsupported types with a helpful message', async () => {
    const err = await processFile(file('archive.zip', 'application/zip')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AttachmentError)
    expect((err as Error).message).toBe('archive.zip: this file type isn’t supported. Try images, PDFs, or text and code files.')
  })
})

describe('labels and helpers', () => {
  const att = (kind: Attachment['kind'], name: string): Attachment => ({ id: '1', kind, name, mime: '', size: 0 })

  it('fileLabel shows PDF, a short extension, or a generic label', () => {
    expect(fileLabel(att('pdf', 'anything'))).toBe('PDF')
    expect(fileLabel(att('text', 'main.py'))).toBe('PY')
    expect(fileLabel(att('text', 'README'))).toBe('File')
    expect(fileLabel(att('text', 'notes.markdown'))).toBe('File')
  })

  it('formatBytes picks B, KB or MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5.5 * MB)).toBe('5.5 MB')
  })

  it('uid produces distinct short ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, uid))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/)
  })
})
