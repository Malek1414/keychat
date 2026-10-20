// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserRecognition, plainForSpeech, Recorder, speakWithSystemVoice } from './voice'

/*
 * The Recorder wraps getUserMedia, Web Audio (AnalyserNode), MediaRecorder and
 * the browser SpeechRecognition API. jsdom has none of these, so each test
 * installs small fakes and checks how the Recorder drives them.
 */

type Listener = ((e: { data: Blob }) => void) | null

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = (m: string) => m === 'audio/webm'
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: Listener = null
  onstop: (() => void) | null = null
  timeslice = 0
  constructor(
    public stream: unknown,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }
  start(timeslice: number) {
    this.timeslice = timeslice
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => this.onstop?.())
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) })
  }
}

class FakeRecognition {
  static last: FakeRecognition | null = null
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  abort = vi.fn()
  stop = vi.fn(() => queueMicrotask(() => this.onend?.()))
  constructor() {
    FakeRecognition.last = this
  }
  /** Simulate a `result` event; each item is [transcript, isFinal]. */
  result(resultIndex: number, items: [string, boolean][]) {
    this.onresult?.({ resultIndex, results: items.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })) })
  }
}

const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] }
const ctxClose = vi.fn(async () => undefined)
class FakeAudioContext {
  createMediaStreamSource = () => ({ connect: vi.fn() })
  createAnalyser = () => ({ fftSize: 0, smoothingTimeConstant: 0, getByteTimeDomainData: vi.fn() })
  close = ctxClose
}

const getUserMedia = vi.fn(async (_: MediaStreamConstraints) => stream)
const setMediaDevices = (value: unknown) => Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true })

beforeEach(() => {
  FakeMediaRecorder.instances = []
  FakeRecognition.last = null
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  setMediaDevices({ getUserMedia })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  setMediaDevices(undefined)
  delete (window as { desktop?: unknown }).desktop
})

describe('Recorder', () => {
  it('explains when the browser has no microphone API', async () => {
    setMediaDevices(undefined)
    await expect(new Recorder().start()).rejects.toThrow('This browser can’t access the microphone.')
  })

  it('explains when microphone permission is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await expect(new Recorder().start()).rejects.toThrow('Microphone access was blocked.')
  })

  it('records with noise suppression, picks a supported codec and returns the audio as one Blob', async () => {
    const r = new Recorder()
    await r.start()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const rec = FakeMediaRecorder.instances[0]
    // 'audio/webm;codecs=opus' is not supported by the fake, so the next option wins.
    expect(rec.mimeType).toBe('audio/webm')
    expect(rec.timeslice).toBe(250)
    expect(r.hasRecognition).toBe(false)

    rec.emit('abc')
    rec.emit('')
    rec.emit('de')
    const blob = await r.stop()
    expect(blob.size).toBe(5)
    expect(blob.type).toBe('audio/webm')
    // Everything is released: mic tracks stopped, audio graph closed.
    expect(track.stop).toHaveBeenCalled()
    expect(ctxClose).toHaveBeenCalled()
    expect(r.analyser).toBeNull()
    expect(r.level()).toBe(0)
  })

  it('runs browser speech recognition alongside when asked, merging final and interim text', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const r = new Recorder()
    await r.start(true)
    const sr = FakeRecognition.last!
    expect(sr).toMatchObject({ continuous: true, interimResults: true, lang: navigator.language })
    expect(sr.start).toHaveBeenCalled()
    expect(r.hasRecognition).toBe(true)

    sr.result(0, [['hello', true], ['wor', false]])
    expect(r.recognitionText).toBe('hello wor')
    sr.result(1, [['hello', true], ['world', true]])
    expect(r.recognitionText).toBe('hello world')

    await r.stop()
    expect(sr.stop).toHaveBeenCalled()
    expect(r.recognitionText).toBe('hello world')
  })

  it('cancel() stops everything without waiting', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const r = new Recorder()
    await r.start(true)
    r.cancel()
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
    expect(FakeRecognition.last!.abort).toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    expect(r.hasRecognition).toBe(false)
  })

  it('level() turns the waveform into a 0..1 loudness value (RMS x 4, capped)', () => {
    const r = new Recorder()
    const withSamples = (fill: (i: number) => number) => {
      r.analyser = {
        fftSize: 8,
        getByteTimeDomainData: (buf: Uint8Array) => buf.forEach((_, i) => (buf[i] = fill(i))),
      } as unknown as AnalyserNode
      return r.level()
    }
    expect(withSamples(() => 128)).toBe(0) // silence sits at the 128 midpoint
    expect(withSamples((i) => (i % 2 ? 136 : 120))).toBeCloseTo(0.25) // RMS 1/16, times 4
    expect(withSamples((i) => (i % 2 ? 255 : 0))).toBe(1) // clipped loud signal is capped
  })
})

describe('browserRecognition', () => {
  it('returns null when the browser has no SpeechRecognition', () => {
    expect(browserRecognition()).toBeNull()
  })

  it('is disabled inside the Electron app (window.desktop is set by the preload script)', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    ;(window as { desktop?: unknown }).desktop = { platform: 'darwin' }
    expect(browserRecognition()).toBeNull()
  })
})

describe('speakWithSystemVoice', () => {
  it('finishes immediately when the browser has no speech synthesis', () => {
    const onEnd = vi.fn()
    speakWithSystemVoice('hello', onEnd)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('cancels anything already speaking, speaks, and returns a stop function', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() }
    class Utterance {
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(public text: string) {}
    }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    const onEnd = vi.fn()

    const stop = speakWithSystemVoice('hello', onEnd)
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    const u = synth.speak.mock.calls[0][0] as Utterance
    expect(u.text).toBe('hello')
    expect(u.onend).toBe(onEnd)
    expect(u.onerror).toBe(onEnd)

    stop()
    expect(synth.cancel).toHaveBeenCalledTimes(2)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})

describe('plainForSpeech', () => {
  it('replaces code blocks instead of reading them out', () => {
    expect(plainForSpeech('Run this:\n```bash\nnpm test\n```')).toBe('Run this:\n (code omitted)')
  })

  it('keeps the words of inline code and links, and drops images', () => {
    expect(plainForSpeech('Use `npm test`. ![chart](a.png)See [the docs](https://example.com).')).toBe(
      'Use npm test. See the docs.',
    )
  })

  it('strips headings, emphasis, quotes and table pipes, and collapses blank lines', () => {
    expect(plainForSpeech('## Summary\n\n\n**Bold** and _italic_ ~~gone~~\n> quoted | cell')).toBe(
      'Summary\nBold and italic gone\n quoted  cell',
    )
  })
})
