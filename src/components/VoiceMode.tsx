import { Mic, MicOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { speak, transcribe } from '../lib/providers'
import type { Settings } from '../lib/types'
import { browserRecognition, plainForSpeech, Recorder, speakWithSystemVoice } from '../lib/voice'

type Phase = 'starting' | 'listening' | 'thinking' | 'speaking' | 'error'

const SPEECH_ON = 0.1
const SPEECH_OFF = 0.05
const END_SILENCE_MS = 1100

interface Props {
  settings: Settings
  /** Sends the transcript as a chat message and resolves with the reply text. */
  onUtterance: (text: string) => Promise<string>
  onClose: () => void
}

/**
 * Hands-free conversation like ChatGPT's voice mode: it listens, notices when
 * you stop talking, sends what you said, reads the answer back, and listens
 * again. Tap the orb to interrupt while it's talking.
 */
export function VoiceMode({ settings, onUtterance, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [muted, setMuted] = useState(false)
  const [caption, setCaption] = useState('')
  const [error, setError] = useState('')
  const orb = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(false)
  const interrupt = useRef<(() => void) | null>(null)
  const alive = useRef(true)
  const utter = useRef(onUtterance)
  utter.current = onUtterance

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    alive.current = true
    const hasOpenAI = Boolean(settings.openaiKey)
    if (!hasOpenAI && !browserRecognition()) {
      setPhase('error')
      setError('Voice mode needs an OpenAI API key for speech. Add one in Settings.')
      return
    }

    let recorder: Recorder | null = null
    let raf = 0

    const setScale = (v: number) => orb.current?.style.setProperty('--level', v.toFixed(3))

    const listen = () =>
      new Promise<string>((resolve, reject) => {
        recorder = new Recorder()
        recorder
          .start(!hasOpenAI)
          .then(() => {
            if (!alive.current) return
            setPhase('listening')
            let speaking = false
            let loudSince = 0
            let quietSince = 0
            const started = performance.now()
            const tick = async () => {
              if (!alive.current || !recorder) return
              const now = performance.now()
              const lvl = mutedRef.current ? 0 : recorder.level()
              setScale(lvl)
              if (lvl > SPEECH_ON) {
                loudSince ||= now
                quietSince = 0
                if (now - loudSince > 120) speaking = true
              } else if (lvl < SPEECH_OFF) {
                loudSince = 0
                quietSince ||= now
              }
              const done = (speaking && quietSince && now - quietSince > END_SILENCE_MS) || now - started > 90000
              if (!done) {
                raf = requestAnimationFrame(tick)
                return
              }
              const r = recorder
              recorder = null
              setScale(0)
              setPhase('thinking')
              const blob = await r.stop()
              if (!speaking) return resolve('')
              try {
                resolve(hasOpenAI ? await transcribe(settings, blob) : r.recognitionText)
              } catch (e) {
                reject(e)
              }
            }
            raf = requestAnimationFrame(tick)
          })
          .catch(reject)
      })

    const say = (text: string) =>
      new Promise<void>((resolve) => {
        setPhase('speaking')
        const spoken = plainForSpeech(text)
        if (!spoken) return resolve()
        if (!hasOpenAI) {
          const stop = speakWithSystemVoice(spoken, resolve)
          interrupt.current = stop
          return
        }
        const ctrl = new AbortController()
        let audio: HTMLAudioElement | null = null
        interrupt.current = () => {
          ctrl.abort()
          audio?.pause()
          resolve()
        }
        speak(settings, spoken, ctrl.signal)
          .then((url) => {
            if (!alive.current || ctrl.signal.aborted) return resolve()
            audio = new Audio(url)
            audio.onended = () => {
              URL.revokeObjectURL(url)
              resolve()
            }
            audio.onerror = () => resolve()
            void audio.play().catch(() => resolve())
          })
          .catch(() => {
            // Fall back to the system voice if TTS fails, so the turn still lands.
            interrupt.current = speakWithSystemVoice(spoken, resolve)
          })
      })

    ;(async () => {
      while (alive.current) {
        try {
          const heard = await listen()
          if (!alive.current) break
          if (!heard) continue
          setCaption(heard)
          setPhase('thinking')
          const reply = await utter.current(heard)
          if (!alive.current) break
          setCaption('')
          await say(reply)
          interrupt.current = null
        } catch (e) {
          if (!alive.current) break
          setPhase('error')
          setError((e as Error).message || 'Voice mode stopped.')
          break
        }
      }
    })()

    return () => {
      alive.current = false
      cancelAnimationFrame(raf)
      recorder?.cancel()
      interrupt.current?.()
    }
    // Voice mode runs once per open; settings changes take effect next time.
  }, [])

  const label =
    phase === 'starting'
      ? 'Connecting…'
      : phase === 'listening'
        ? muted
          ? 'Microphone off'
          : 'Listening'
        : phase === 'thinking'
          ? 'Thinking'
          : phase === 'speaking'
            ? 'Tap to interrupt'
            : error

  return (
    <div className="voice-mode" role="dialog" aria-label="Voice mode">
      <div className="voice-center">
        <div
          ref={orb}
          className={`orb ${phase}`}
          onClick={() => phase === 'speaking' && interrupt.current?.()}
          role={phase === 'speaking' ? 'button' : undefined}
          aria-label={phase === 'speaking' ? 'Interrupt' : undefined}
        />
        <div className="voice-label" aria-live="polite">
          {label}
        </div>
        {caption && <div className="voice-caption">“{caption}”</div>}
      </div>
      <div className="voice-controls">
        <button type="button" className={`voice-btn ${muted ? 'on' : ''}`} aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)}>
          {muted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        <button type="button" className="voice-btn end" aria-label="End voice mode" onClick={onClose}>
          <X size={26} />
        </button>
      </div>
    </div>
  )
}
