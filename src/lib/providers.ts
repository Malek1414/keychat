import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Attachment, Message, ModelOption, Settings } from './types'

// Keys never leave the device except in the request to the provider itself,
// which is why the browser-access flags are on: there is no server in between.
function openai(s: Settings) {
  return new OpenAI({
    apiKey: s.openaiKey,
    baseURL: s.openaiBaseUrl.trim() || undefined,
    dangerouslyAllowBrowser: true,
  })
}

function anthropic(s: Settings) {
  return new Anthropic({ apiKey: s.anthropicKey, dangerouslyAllowBrowser: true })
}

export const FALLBACK_MODELS: ModelOption[] = [
  { id: 'anthropic:claude-opus-5', provider: 'anthropic', model: 'claude-opus-5', label: 'Claude Opus 5', maxTokens: 64000 },
  { id: 'anthropic:claude-sonnet-5', provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5', maxTokens: 64000 },
  { id: 'anthropic:claude-haiku-4-5', provider: 'anthropic', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', maxTokens: 64000 },
  { id: 'openai:gpt-4o', provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
  { id: 'openai:gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini' },
]

const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/
const OPENAI_SKIP =
  /(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|dall-e|whisper|computer-use|deep-research|-\d{4}-\d{2}-\d{2}$|-\d{4}$)/

function prettyOpenAI(id: string) {
  return id
    .replace(/^gpt-/, 'GPT-')
    .replace(/^chatgpt-/, 'ChatGPT-')
    .replace(/-mini$/, ' mini')
    .replace(/-nano$/, ' nano')
    .replace(/-pro$/, ' pro')
}

/** Lists the chat models each configured key can actually use. */
export async function listModels(s: Settings): Promise<ModelOption[]> {
  const out: ModelOption[] = []
  const jobs: Promise<void>[] = []

  if (s.anthropicKey) {
    jobs.push(
      (async () => {
        const found: ModelOption[] = []
        for await (const m of anthropic(s).models.list({ limit: 100 })) {
          found.push({
            id: `anthropic:${m.id}`,
            provider: 'anthropic',
            model: m.id,
            label: m.display_name || m.id,
            maxTokens: m.max_tokens ?? undefined,
          })
        }
        out.push(...found)
      })().catch(() => {
        out.push(...FALLBACK_MODELS.filter((m) => m.provider === 'anthropic'))
      }),
    )
  }

  if (s.openaiKey) {
    const custom = Boolean(s.openaiBaseUrl.trim())
    jobs.push(
      (async () => {
        const found: (ModelOption & { created: number })[] = []
        for await (const m of openai(s).models.list()) {
          if (!custom && (!OPENAI_CHAT.test(m.id) || OPENAI_SKIP.test(m.id))) continue
          found.push({
            id: `openai:${m.id}`,
            provider: 'openai',
            model: m.id,
            label: custom ? m.id : prettyOpenAI(m.id),
            created: m.created ?? 0,
          })
        }
        found.sort((a, b) => b.created - a.created)
        out.push(...found.map(({ created: _c, ...rest }) => rest))
      })().catch(() => {
        if (!custom) out.push(...FALLBACK_MODELS.filter((m) => m.provider === 'openai'))
      }),
    )
  }

  await Promise.all(jobs)
  return out
}

function textFileBlock(a: Attachment) {
  return `<file name="${a.name}">\n${a.text ?? ''}\n</file>`
}

function toOpenAI(messages: Message[], system: string): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = []
  if (system.trim()) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content })
      continue
    }
    const parts: ChatCompletionContentPart[] = []
    for (const a of m.attachments ?? []) {
      if (a.kind === 'image' && a.dataUrl) parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
      else if (a.kind === 'pdf' && a.dataUrl) parts.push({ type: 'file', file: { filename: a.name, file_data: a.dataUrl } })
      else if (a.kind === 'text') parts.push({ type: 'text', text: textFileBlock(a) })
    }
    if (m.content) parts.push({ type: 'text', text: m.content })
    out.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts })
  }
  return out
}

function base64Of(dataUrl: string) {
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

function toAnthropic(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content })
      continue
    }
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const a of m.attachments ?? []) {
      if (a.kind === 'image' && a.dataUrl) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: a.mime as Anthropic.Base64ImageSource['media_type'],
            data: base64Of(a.dataUrl),
          },
        })
      } else if (a.kind === 'pdf' && a.dataUrl) {
        blocks.push({
          type: 'document',
          title: a.name,
          source: { type: 'base64', media_type: 'application/pdf', data: base64Of(a.dataUrl) },
        })
      } else if (a.kind === 'text') {
        blocks.push({
          type: 'document',
          title: a.name,
          source: { type: 'text', media_type: 'text/plain', data: a.text ?? '' },
        })
      }
    }
    if (m.content) blocks.push({ type: 'text', text: m.content })
    out.push({ role: 'user', content: blocks })
  }
  return out
}

export interface StreamArgs {
  settings: Settings
  model: ModelOption
  messages: Message[]
  signal: AbortSignal
  onText: (delta: string) => void
  onThinking: () => void
}

export interface StreamResult {
  thoughtFor?: number
  notice?: string
}

export async function streamChat(a: StreamArgs): Promise<StreamResult> {
  const started = performance.now()
  let thinkingAt = 0
  let firstTextAt = 0
  const text = (d: string) => {
    if (!d) return
    if (!firstTextAt) firstTextAt = performance.now()
    a.onText(d)
  }
  const thoughtFor = () =>
    thinkingAt && firstTextAt ? Math.max(1, Math.round((firstTextAt - started) / 1000)) : undefined

  if (a.model.provider === 'openai') {
    if (!a.settings.openaiKey) throw new Error('Add an OpenAI API key in Settings to use this model.')
    const stream = await openai(a.settings).chat.completions.create(
      { model: a.model.model, messages: toOpenAI(a.messages, a.settings.systemPrompt), stream: true },
      { signal: a.signal },
    )
    for await (const chunk of stream) text(chunk.choices[0]?.delta?.content ?? '')
    return {}
  }

  if (!a.settings.anthropicKey) throw new Error('Add an Anthropic API key in Settings to use this model.')
  const stream = anthropic(a.settings).messages.stream(
    {
      model: a.model.model,
      max_tokens: Math.min(a.model.maxTokens ?? 8192, 64000),
      ...(a.settings.systemPrompt.trim() ? { system: a.settings.systemPrompt } : {}),
      messages: toAnthropic(a.messages),
    },
    { signal: a.signal },
  )
  for await (const event of stream) {
    if (event.type === 'content_block_start' && event.content_block.type === 'thinking' && !thinkingAt) {
      thinkingAt = performance.now()
      a.onThinking()
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text(event.delta.text)
    }
  }
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') return { thoughtFor: thoughtFor(), notice: 'The model declined to answer this request.' }
  if (final.stop_reason === 'max_tokens') return { thoughtFor: thoughtFor(), notice: 'The reply hit the maximum length and was cut off.' }
  return { thoughtFor: thoughtFor() }
}

/** Speech to text. Uses OpenAI's transcription models (what ChatGPT's dictation runs on). */
export async function transcribe(s: Settings, audio: Blob): Promise<string> {
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm'
  const file = new File([audio], `voice.${ext}`, { type: audio.type || 'audio/webm' })
  const client = openai(s)
  try {
    const r = await client.audio.transcriptions.create({ file, model: 'gpt-4o-transcribe' })
    return r.text.trim()
  } catch {
    const r = await client.audio.transcriptions.create({ file, model: 'whisper-1' })
    return r.text.trim()
  }
}

/** Text to speech for "Read aloud" and voice mode. Returns an object URL for an <audio> element. */
export async function speak(s: Settings, input: string, signal?: AbortSignal): Promise<string> {
  const r = await openai(s).audio.speech.create(
    {
      model: 'gpt-4o-mini-tts',
      voice: s.voice || 'marin',
      input: input.slice(0, 4000),
      response_format: 'mp3',
    },
    { signal },
  )
  return URL.createObjectURL(await r.blob())
}

export function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.APIError || e instanceof OpenAI.APIError) {
    if (e.status === 401) return 'That API key was rejected. Check it in Settings.'
    if (e.status === 429) return 'Rate limited or out of credits on this key. Try again shortly, or check your billing.'
    if (e.status === 404) return 'This model isn’t available on your key. Pick another model.'
    if (e.status && e.status >= 500) return 'The provider is having trouble right now. Try again in a moment.'
    const inner = (e.error as { error?: { message?: string } } | undefined)?.error?.message
    return inner || e.message
  }
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}
