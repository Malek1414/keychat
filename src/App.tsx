import { ArrowDown, ImagePlus, PanelLeft, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { uid } from './lib/attachments'
import { FALLBACK_MODELS, friendlyError, listModels, speak, streamChat } from './lib/providers'
import {
  clearConversations,
  deleteConversation,
  loadConversations,
  loadLastModel,
  loadModelCache,
  loadSettings,
  saveConversation,
  saveLastModel,
  saveModelCache,
  saveSettings,
} from './lib/storage'
import type { Attachment, Conversation, Message, ModelOption, Settings } from './lib/types'
import { plainForSpeech, speakWithSystemVoice } from './lib/voice'
import { Composer, type ComposerHandle } from './components/Composer'
import { Lightbox } from './components/Lightbox'
import { MessageView } from './components/MessageView'
import { ModelPicker } from './components/ModelPicker'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { VoiceMode } from './components/VoiceMode'

const desktop = (window as unknown as { desktop?: { platform: string } }).desktop
const isWide = () => window.matchMedia('(min-width: 768px)').matches

function titleFrom(text: string, attachments: Attachment[]) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t) return t.length > 42 ? t.slice(0, 40).replace(/\s\S*$/, '') + '…' : t
  return attachments[0]?.name ?? 'New chat'
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>(() => loadModelCache())
  const [modelId, setModelId] = useState(loadLastModel)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [sidebar, setSidebar] = useState(isWide)
  const [settingsOpen, setSettingsOpen] = useState(() => {
    const s = loadSettings()
    return !s.openaiKey && !s.anthropicKey && !s.xaiKey && !s.openaiBaseUrl
  })
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [voice, setVoice] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [dragging, setDragging] = useState(false)
  const [atBottom, setAtBottom] = useState(true)

  const convsRef = useRef(conversations)
  convsRef.current = conversations
  const abort = useRef<AbortController | null>(null)
  const stopSpeaking = useRef<(() => void) | null>(null)
  const composer = useRef<ComposerHandle>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const dragDepth = useRef(0)

  const firstRun = !settings.openaiKey && !settings.anthropicKey && !settings.xaiKey && !settings.openaiBaseUrl
  const active = conversations.find((c) => c.id === activeId) ?? null
  const model = useMemo(
    () => models.find((m) => m.id === modelId) ?? models.find((m) => m.provider === 'anthropic') ?? models[0],
    [models, modelId],
  )

  // ---- boot ----------------------------------------------------------------
  useEffect(() => {
    void loadConversations().then(setConversations)
  }, [])

  const refreshModels = useCallback(async (s: Settings) => {
    if (!s.openaiKey && !s.anthropicKey && !s.xaiKey && !s.openaiBaseUrl) return
    setModelsLoading(true)
    const list = await listModels(s)
    setModelsLoading(false)
    if (list.length) {
      setModels(list)
      saveModelCache(list)
    }
  }, [])

  useEffect(() => {
    void refreshModels(settings)
    // Only on boot; Settings → Save refreshes explicitly.
  }, []) // eslint-disable-line

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 4500)
  }, [])

  // ---- persistence helpers -----------------------------------------------------
  const putConversation = useCallback((c: Conversation, persist = true) => {
    setConversations((list) => {
      const rest = list.filter((x) => x.id !== c.id)
      return [c, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
    })
    if (persist) void saveConversation(c)
  }, [])

  // ---- scrolling ---------------------------------------------------------------
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    setAtBottom(near)
  }

  useEffect(() => {
    if (stick.current) scrollToBottom()
  }, [active?.messages, scrollToBottom])

  // ---- the model call ------------------------------------------------------------
  /** Streams a reply to `history` into conversation `conv`. Resolves with the reply text. */
  const run = useCallback(
    async (conv: Conversation, history: Message[]): Promise<string> => {
      if (!model) {
        setSettingsOpen(true)
        return ''
      }
      const reply: Message = { id: uid(), role: 'assistant', content: '', model: model.label, createdAt: Date.now() }
      let current: Conversation = { ...conv, messages: [...history, reply], modelId: model.id, updatedAt: Date.now() }
      putConversation(current)
      stick.current = true
      setStreamingId(reply.id)
      setThinking(false)

      const ctrl = new AbortController()
      abort.current = ctrl
      let buffer = ''
      let frame = 0
      const flush = () => {
        frame = 0
        current = {
          ...current,
          messages: current.messages.map((m) => (m.id === reply.id ? { ...m, content: m.content + buffer } : m)),
        }
        buffer = ''
        putConversation(current, false)
      }

      let notice: string | undefined
      let thoughtFor: number | undefined
      let error: string | undefined
      try {
        const r = await streamChat({
          settings,
          model,
          messages: history,
          signal: ctrl.signal,
          onThinking: () => setThinking(true),
          onText: (d) => {
            buffer += d
            if (!frame) frame = requestAnimationFrame(flush)
          },
        })
        notice = r.notice
        thoughtFor = r.thoughtFor
      } catch (e) {
        if (!ctrl.signal.aborted) error = friendlyError(e)
      }
      if (frame) cancelAnimationFrame(frame)
      flush()
      current = {
        ...current,
        updatedAt: Date.now(),
        messages: current.messages
          .map((m) => (m.id === reply.id ? { ...m, thoughtFor, error: error ?? notice } : m))
          // Stopped before any text arrived: drop the empty reply, like ChatGPT.
          .filter((m) => m.id !== reply.id || m.content || m.error),
      }
      putConversation(current)
      setStreamingId(null)
      setThinking(false)
      abort.current = null
      return current.messages.find((m) => m.id === reply.id)?.content ?? ''
    },
    [model, settings, putConversation],
  )

  const send = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (streamingId) return Promise.resolve('')
      const user: Message = { id: uid(), role: 'user', content: text, attachments, createdAt: Date.now() }
      const existing = convsRef.current.find((c) => c.id === activeId)
      const conv: Conversation = existing ?? {
        id: uid(),
        title: titleFrom(text, attachments),
        messages: [],
        modelId: model?.id ?? '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      setActiveId(conv.id)
      if (!isWide()) setSidebar(false)
      return run(conv, [...conv.messages, user])
    },
    [activeId, model, run, streamingId],
  )

  const editMessage = useCallback(
    (id: string, text: string) => {
      const conv = convsRef.current.find((c) => c.id === activeId)
      if (!conv || streamingId) return
      const i = conv.messages.findIndex((m) => m.id === id)
      if (i < 0) return
      const edited = { ...conv.messages[i], content: text }
      void run(conv, [...conv.messages.slice(0, i), edited])
    },
    [activeId, run, streamingId],
  )

  const regenerate = useCallback(() => {
    const conv = convsRef.current.find((c) => c.id === activeId)
    if (!conv || streamingId) return
    const lastUser = conv.messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) return
    void run(conv, conv.messages.slice(0, lastUser + 1))
  }, [activeId, run, streamingId])

  const stop = () => abort.current?.abort()

  // ---- read aloud --------------------------------------------------------------------
  const toggleSpeak = useCallback(
    async (m: Message) => {
      stopSpeaking.current?.()
      if (speakingId === m.id) return
      const text = plainForSpeech(m.content)
      setSpeakingId(m.id)
      const done = () => setSpeakingId((s) => (s === m.id ? null : s))
      if (!settings.openaiKey) {
        stopSpeaking.current = speakWithSystemVoice(text, done)
        return
      }
      const ctrl = new AbortController()
      let audio: HTMLAudioElement | null = null
      stopSpeaking.current = () => {
        ctrl.abort()
        audio?.pause()
        done()
      }
      try {
        const url = await speak(settings, text, ctrl.signal)
        audio = new Audio(url)
        audio.onended = () => {
          URL.revokeObjectURL(url)
          done()
        }
        await audio.play()
      } catch (e) {
        if (!ctrl.signal.aborted) {
          showToast(friendlyError(e))
          done()
        }
      }
    },
    [settings, speakingId, showToast],
  )

  // ---- conversations ---------------------------------------------------------------------
  const newChat = () => {
    stop()
    setActiveId(null)
    if (!isWide()) setSidebar(false)
    setTimeout(() => composer.current?.focus(), 50)
  }

  const selectChat = (id: string) => {
    stop()
    setActiveId(id)
    const c = convsRef.current.find((x) => x.id === id)
    if (c && models.some((m) => m.id === c.modelId)) setModelId(c.modelId)
    stick.current = true
    if (!isWide()) setSidebar(false)
    requestAnimationFrame(() => scrollToBottom())
  }

  const renameChat = (id: string, title: string) => {
    const c = convsRef.current.find((x) => x.id === id)
    if (c) putConversation({ ...c, title })
  }

  const deleteChat = (id: string) => {
    setConversations((l) => l.filter((c) => c.id !== id))
    void deleteConversation(id)
    if (id === activeId) setActiveId(null)
  }

  // ---- keyboard shortcuts ------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        newChat()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        setSidebar((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- drag & drop anywhere ---------------------------------------------------------------
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const mainClass = ['main', active?.messages.length ? '' : 'empty'].join(' ')
  const lastId = active?.messages[active.messages.length - 1]?.id

  return (
    <div
      className={`app ${desktop?.platform === 'darwin' ? 'mac-desktop' : ''} ${sidebar ? 'with-sidebar' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        composer.current?.addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <Sidebar
        open={sidebar}
        conversations={conversations}
        activeId={activeId}
        onToggle={() => setSidebar((s) => !s)}
        onNew={newChat}
        onSelect={selectChat}
        onRename={renameChat}
        onDelete={deleteChat}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className={mainClass}>
        <header className="topbar drag">
          <div className="topbar-left no-drag">
            {!sidebar && (
              <>
                <button type="button" className="icon-btn" aria-label="Open sidebar" data-tip="Open sidebar" onClick={() => setSidebar(true)}>
                  <PanelLeft size={20} />
                </button>
                <button type="button" className="icon-btn hide-mobile" aria-label="New chat" data-tip="New chat" onClick={newChat}>
                  <SquarePen size={19} />
                </button>
              </>
            )}
            <ModelPicker
              models={models.length ? models : firstRun ? [] : FALLBACK_MODELS}
              value={model}
              loading={modelsLoading}
              onChange={(id) => {
                setModelId(id)
                saveLastModel(id)
              }}
              onRefresh={() => void refreshModels(settings)}
            />
          </div>
          <button type="button" className="icon-btn show-mobile no-drag" aria-label="New chat" onClick={newChat}>
            <SquarePen size={19} />
          </button>
        </header>

        <div className="scroller" ref={scroller} onScroll={onScroll}>
          {active?.messages.length ? (
            <div className="thread">
              {active.messages.map((m) => (
                <MessageView
                  key={m.id}
                  message={m}
                  streaming={m.id === streamingId}
                  thinking={thinking}
                  isLast={m.id === lastId}
                  speaking={m.id === speakingId}
                  onEdit={editMessage}
                  onRegenerate={regenerate}
                  onSpeak={toggleSpeak}
                  onOpenImage={setLightbox}
                />
              ))}
            </div>
          ) : (
            <div className="hero">
              <h1>What can I help with?</h1>
            </div>
          )}
        </div>

        <div className="bottom">
          {!atBottom && active?.messages.length ? (
            <button
              type="button"
              className="to-bottom"
              aria-label="Scroll to bottom"
              onClick={() => {
                stick.current = true
                scrollToBottom(true)
              }}
            >
              <ArrowDown size={18} />
            </button>
          ) : null}
          <Composer
            ref={composer}
            settings={settings}
            busy={Boolean(streamingId)}
            placeholder="Ask anything"
            onSend={(t, a) => void send(t, a)}
            onStop={stop}
            onVoiceMode={() => {
              stopSpeaking.current?.()
              setVoice(true)
            }}
            onOpenImage={setLightbox}
            onError={showToast}
          />
        </div>
      </main>

      {dragging && (
        <div className="drop-overlay">
          <div>
            <ImagePlus size={44} strokeWidth={1.5} />
            <h3>Add anything</h3>
            <p>Drop any file here to add it to the conversation</p>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          firstRun={firstRun}
          onClose={() => setSettingsOpen(false)}
          onSave={(s, list) => {
            setSettings(s)
            saveSettings(s)
            setModels(list)
            saveModelCache(list)
            if (!list.some((m) => m.id === modelId)) {
              const pick = list.find((m) => m.provider === 'anthropic') ?? list[0]
              setModelId(pick.id)
              saveLastModel(pick.id)
            }
            setSettingsOpen(false)
          }}
          onClearChats={() => {
            void clearConversations()
            setConversations([])
            setActiveId(null)
          }}
        />
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {voice && <VoiceMode settings={settings} onUtterance={(t) => send(t, [])} onClose={() => setVoice(false)} />}

      {toast && (
        <div className="toast" role="status" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
    </div>
  )
}
