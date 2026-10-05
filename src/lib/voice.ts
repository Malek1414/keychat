/* Microphone capture shared by dictation and voice mode. */

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

const isDesktop = () => Boolean((window as unknown as { desktop?: unknown }).desktop)

/** Browser speech recognition (Chrome, Edge, Safari). Not available inside Electron. */
export function browserRecognition(): SR | null {
  if (isDesktop()) return null
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.continuous = true
  r.interimResults = true
  r.lang = navigator.language || 'en-US'
  return r
}

function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || ''
}

export class Recorder {
  analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private sr: SR | null = null
  private srText = ''
  private srInterim = ''

  /** `withRecognition` runs browser speech recognition alongside, for when there is no OpenAI key. */
  async start(withRecognition = false) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t access the microphone.')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      throw new Error('Microphone access was blocked. Allow it in your browser or system settings.')
    }
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.6
    src.connect(this.analyser)

    const mime = pickMime()
    this.chunks = []
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined)
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.start(250)

    if (withRecognition) {
      this.srText = ''
      this.srInterim = ''
      this.sr = browserRecognition()
      if (this.sr) {
        this.sr.onresult = (e) => {
          let interim = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i]
            if (res.isFinal) this.srText += res[0].transcript + ' '
            else interim += res[0].transcript
          }
          this.srInterim = interim
        }
        this.sr.onerror = () => undefined
        this.sr.start()
      }
    }
  }

  /** Current input level, 0..1. */
  level(): number {
    if (!this.analyser) return 0
    const buf = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += ((v - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / buf.length) * 4)
  }

  get recognitionText() {
    return (this.srText + this.srInterim).trim()
  }

  get hasRecognition() {
    return Boolean(this.sr)
  }

  async stop(): Promise<Blob> {
    const rec = this.rec
    const done = new Promise<Blob>((resolve) => {
      if (!rec || rec.state === 'inactive') return resolve(new Blob(this.chunks))
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }))
      rec.stop()
    })
    if (this.sr) {
      // Give recognition a beat to flush its last final result.
      await new Promise<void>((r) => {
        const sr = this.sr!
        sr.onend = () => r()
        sr.stop()
        setTimeout(r, 700)
      })
    }
    const blob = await done
    this.release()
    return blob
  }

  cancel() {
    try {
      if (this.rec && this.rec.state !== 'inactive') this.rec.stop()
      this.sr?.abort()
    } catch {
      /* already stopped */
    }
    this.release()
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close().catch(() => undefined)
    this.stream = null
    this.ctx = null
    this.analyser = null
    this.rec = null
    this.sr = null
  }
}

/** Speaks text with the system voice: the no-OpenAI-key fallback for read aloud. */
export function speakWithSystemVoice(text: string, onEnd: () => void): () => void {
  if (!('speechSynthesis' in window)) {
    onEnd()
    return () => undefined
  }
  const u = new SpeechSynthesisUtterance(text)
  u.lang = navigator.language || 'en-US'
  u.onend = onEnd
  u.onerror = onEnd
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
  return () => {
    speechSynthesis.cancel()
    onEnd()
  }
}

/** Strips markdown so read-aloud doesn't pronounce asterisks and code fences. */
export function plainForSpeech(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
