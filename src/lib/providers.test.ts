import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OPENAI_DONE,
  anthropicStream,
  capture,
  jsonResponse,
  openaiChunk,
  sseResponse,
  type Captured,
} from '../test/http'
import { FALLBACK_MODELS, friendlyError, listModels, speak, streamChat, transcribe } from './providers'
import { DEFAULT_SETTINGS, type Message, type ModelOption, type Settings } from './types'

/*
 * streamChat / listModels / transcribe / speak talk to the providers through the
 * official SDKs, which use the global `fetch`. These tests swap `fetch` for a
 * fake that records each request and answers with canned JSON or SSE bytes, so
 * the whole path (message conversion -> HTTP request -> SSE parsing -> onText
 * callbacks) runs for real without any network access.
 */

type Handler = (req: Captured) => Response | Promise<Response>
let requests: Captured[]

function mockFetch(handler: Handler) {
  requests = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = capture(input, init)
    requests.push(req)
    return handler(req)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

const GPT: ModelOption = { id: 'openai:gpt-4o', provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' }
const GROK: ModelOption = { id: 'xai:grok-4', provider: 'xai', model: 'grok-4', label: 'Grok 4' }
const CLAUDE: ModelOption = {
  id: 'anthropic:claude-test',
  provider: 'anthropic',
  model: 'claude-test',
  label: 'Claude Test',
  maxTokens: 128000,
}

const IMG = 'data:image/png;base64,iVBORw0KGgo='
const PDF = 'data:application/pdf;base64,JVBERi0xLjQ='

const msg = (m: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({
  id: Math.random().toString(36).slice(2),
  createdAt: 0,
  ...m,
})

/** A realistic history: a user turn with three attachment kinds, an answer, an empty (stopped) answer, a follow-up. */
const HISTORY: Message[] = [
  msg({
    role: 'user',
    content: 'What is in these?',
    attachments: [
      { id: 'a1', kind: 'image', name: 'cat.png', mime: 'image/png', size: 10, dataUrl: IMG },
      { id: 'a2', kind: 'pdf', name: 'paper.pdf', mime: 'application/pdf', size: 10, dataUrl: PDF },
      { id: 'a3', kind: 'text', name: 'main.py', mime: 'text/x-python', size: 8, text: 'print(1)' },
    ],
  }),
  msg({ role: 'assistant', content: 'A cat, a paper and some Python.' }),
  msg({ role: 'assistant', content: '' }),
  msg({ role: 'user', content: 'Thanks!' }),
]

function collect() {
  const deltas: string[] = []
  return { deltas, onText: (d: string) => deltas.push(d), onThinking: vi.fn() }
}

beforeEach(() => {
  requests = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('streamChat: OpenAI', () => {
  const sse = [openaiChunk(''), openaiChunk('Hel'), openaiChunk('lo, '), openaiChunk('world'), openaiChunk(undefined), OPENAI_DONE]

  it('streams text deltas from the SSE body in order', async () => {
    mockFetch(() => sseResponse(sse))
    const c = collect()
    const result = await streamChat({
      settings: settings({ openaiKey: 'sk-test' }),
      model: GPT,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...c,
    })
    // Empty deltas and the usage-only chunk (no `choices`) are skipped.
    expect(c.deltas).toEqual(['Hel', 'lo, ', 'world'])
    expect(result).toEqual({})
  })

  it('reassembles events that arrive split across tiny network chunks', async () => {
    mockFetch(() => sseResponse(sse, 5))
    const c = collect()
    await streamChat({
      settings: settings({ openaiKey: 'sk-test' }),
      model: GPT,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...c,
    })
    expect(c.deltas.join('')).toBe('Hello, world')
  })

  it('sends the key only to api.openai.com and converts history to the Chat Completions format', async () => {
    mockFetch(() => sseResponse([OPENAI_DONE]))
    await streamChat({
      settings: settings({ openaiKey: 'sk-test', systemPrompt: 'Be brief.' }),
      model: GPT,
      messages: HISTORY,
      signal: new AbortController().signal,
      ...collect(),
    })
    expect(requests).toHaveLength(1)
    const [req] = requests
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.method).toBe('POST')
    expect(req.headers.get('authorization')).toBe('Bearer sk-test')
    expect(req.body).toMatchObject({ model: 'gpt-4o', stream: true })
    expect((req.body as { messages: unknown }).messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: IMG } },
          { type: 'file', file: { filename: 'paper.pdf', file_data: PDF } },
          { type: 'text', text: '<file name="main.py">\nprint(1)\n</file>' },
          { type: 'text', text: 'What is in these?' },
        ],
      },
      { role: 'assistant', content: 'A cat, a paper and some Python.' },
      // The empty assistant turn (a reply stopped before any text) is dropped,
      // and a text-only user turn is sent as a plain string.
      { role: 'user', content: 'Thanks!' },
    ])
  })

  it('omits a blank system prompt', async () => {
    mockFetch(() => sseResponse([OPENAI_DONE]))
    await streamChat({
      settings: settings({ openaiKey: 'sk-test', systemPrompt: '   ' }),
      model: GPT,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...collect(),
    })
    expect((requests[0].body as { messages: unknown[] }).messages).toEqual([{ role: 'user', content: 'Hi' }])
  })

  it('works keyless against a custom OpenAI-compatible endpoint (e.g. local Ollama), trimming trailing slashes', async () => {
    mockFetch(() => sseResponse([openaiChunk('ok'), OPENAI_DONE]))
    const c = collect()
    await streamChat({
      settings: settings({ openaiBaseUrl: ' http://localhost:11434/v1// ' }),
      model: { ...GPT, model: 'llama3.2' },
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...c,
    })
    expect(requests[0].url).toBe('http://localhost:11434/v1/chat/completions')
    expect(requests[0].headers.get('authorization')).toBe('Bearer no-key')
    expect(c.deltas).toEqual(['ok'])
  })

  it('refuses to call out without a key or endpoint', async () => {
    const fetch = mockFetch(() => sseResponse([OPENAI_DONE]))
    await expect(
      streamChat({ settings: settings(), model: GPT, messages: [], signal: new AbortController().signal, ...collect() }),
    ).rejects.toThrow('Add an OpenAI API key')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops mid-stream when the AbortController fires (the Stop button), keeping the partial text', async () => {
    mockFetch((req) => hangingStream(req, openaiChunk('first') + openaiChunk('second')))
    const ctrl = new AbortController()
    const deltas: string[] = []
    const result = await streamChat({
      settings: settings({ openaiKey: 'sk-test' }),
      model: GPT,
      messages: [msg({ role: 'user', content: 'Write a novel' })],
      signal: ctrl.signal,
      onThinking: () => undefined,
      onText: (d) => {
        deltas.push(d)
        ctrl.abort()
      },
    })
    // The OpenAI SDK ends its async iterator quietly on abort, so the call resolves.
    expect(result).toEqual({})
    expect(deltas).toEqual(['first'])
  })

  it('rejects when aborted before the response arrives (App ignores it because signal.aborted is set)', async () => {
    mockFetch((req) => new Promise<Response>((_, reject) => req.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    const ctrl = new AbortController()
    const run = streamChat({
      settings: settings({ openaiKey: 'sk-test' }),
      model: GPT,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: ctrl.signal,
      ...collect(),
    })
    ctrl.abort()
    await expect(run).rejects.toThrow('Request was aborted.')
    expect(ctrl.signal.aborted).toBe(true)
  })
})

/** A streaming response that sends `first` and then hangs until the request is aborted. */
function hangingStream(req: Captured, first: string) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(first))
        req.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')))
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('streamChat: xAI (Grok)', () => {
  it('uses the OpenAI wire format against api.x.ai with the xAI key', async () => {
    mockFetch(() => sseResponse([openaiChunk('Grok'), openaiChunk(' here'), OPENAI_DONE]))
    const c = collect()
    await streamChat({
      settings: settings({ xaiKey: 'xai-test', openaiKey: 'sk-should-not-be-used' }),
      model: GROK,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...c,
    })
    expect(requests[0].url).toBe('https://api.x.ai/v1/chat/completions')
    expect(requests[0].headers.get('authorization')).toBe('Bearer xai-test')
    expect(c.deltas.join('')).toBe('Grok here')
  })

  it('needs an xAI key', async () => {
    const fetch = mockFetch(() => sseResponse([OPENAI_DONE]))
    await expect(
      streamChat({ settings: settings(), model: GROK, messages: [], signal: new AbortController().signal, ...collect() }),
    ).rejects.toThrow('Add an xAI API key')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects PDFs anywhere in the history before sending anything', async () => {
    const fetch = mockFetch(() => sseResponse([OPENAI_DONE]))
    await expect(
      streamChat({
        settings: settings({ xaiKey: 'xai-test' }),
        model: GROK,
        messages: HISTORY,
        signal: new AbortController().signal,
        ...collect(),
      }),
    ).rejects.toThrow('Grok can’t read PDFs')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('streamChat: Anthropic', () => {
  it('streams text_delta events and reports no notice on a normal stop', async () => {
    mockFetch(() => sseResponse(anthropicStream({ text: ['Hi', ' there', '!'] })))
    const c = collect()
    const result = await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Hello' })],
      signal: new AbortController().signal,
      ...c,
    })
    expect(c.deltas).toEqual(['Hi', ' there', '!'])
    expect(c.onThinking).not.toHaveBeenCalled()
    expect(result).toEqual({ thoughtFor: undefined })
  })

  it('handles the stream when it is split into 3-byte network chunks', async () => {
    mockFetch(() => sseResponse(anthropicStream({ text: ['Split ', 'safely'] }), 3))
    const c = collect()
    await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Hello' })],
      signal: new AbortController().signal,
      ...c,
    })
    expect(c.deltas.join('')).toBe('Split safely')
  })

  it('sends the key with the direct-browser-access header and converts attachments to content blocks', async () => {
    mockFetch(() => sseResponse(anthropicStream({ text: ['ok'] })))
    await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test', systemPrompt: 'Be brief.' }),
      model: CLAUDE,
      messages: HISTORY,
      signal: new AbortController().signal,
      ...collect(),
    })
    const [req] = requests
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers.get('x-api-key')).toBe('sk-ant-test')
    expect(req.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    expect(req.headers.get('authorization')).toBeNull()
    expect(req.body).toMatchObject({
      model: 'claude-test',
      // The model advertises 128k output tokens; the app caps requests at 64k.
      max_tokens: 64000,
      system: 'Be brief.',
      stream: true,
    })
    expect((req.body as { messages: unknown }).messages).toEqual([
      {
        role: 'user',
        content: [
          // The data: URL prefix is stripped down to raw base64.
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
          { type: 'document', title: 'paper.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } },
          { type: 'document', title: 'main.py', source: { type: 'text', media_type: 'text/plain', data: 'print(1)' } },
          { type: 'text', text: 'What is in these?' },
        ],
      },
      { role: 'assistant', content: 'A cat, a paper and some Python.' },
      { role: 'user', content: [{ type: 'text', text: 'Thanks!' }] },
    ])
  })

  it('defaults max_tokens to 8192 and leaves out a blank system prompt', async () => {
    mockFetch(() => sseResponse(anthropicStream({ text: ['ok'] })))
    await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test', systemPrompt: '  ' }),
      model: { ...CLAUDE, maxTokens: undefined },
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...collect(),
    })
    expect(requests[0].body).toMatchObject({ max_tokens: 8192 })
    expect(requests[0].body).not.toHaveProperty('system')
  })

  it('accepts a gateway URL pasted with /v1 and a trailing slash', async () => {
    mockFetch(() => sseResponse(anthropicStream({ text: ['ok'] })))
    await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test', anthropicBaseUrl: 'https://gateway.example.com/v1/' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...collect(),
    })
    expect(requests[0].url).toBe('https://gateway.example.com/v1/messages')
  })

  it('signals thinking once and measures "Thought for Ns" up to the first visible token', async () => {
    // started = 0 ms, thinking starts = 1000 ms, first text = 4600 ms -> 5 s.
    const clock = [0, 1000, 4600]
    vi.spyOn(performance, 'now').mockImplementation(() => clock.shift() ?? 4600)
    mockFetch(() => sseResponse(anthropicStream({ thinking: true, text: ['Answer'] })))
    const c = collect()
    const result = await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Hard question' })],
      signal: new AbortController().signal,
      ...c,
    })
    expect(c.onThinking).toHaveBeenCalledTimes(1)
    // Thinking text itself is never shown, only the answer.
    expect(c.deltas).toEqual(['Answer'])
    expect(result.thoughtFor).toBe(5)
  })

  it.each([
    ['max_tokens', 'The reply hit the maximum length and was cut off.'],
    ['refusal', 'The model declined to answer this request.'],
  ])('turns stop_reason=%s into a user-facing notice', async (stopReason, notice) => {
    mockFetch(() => sseResponse(anthropicStream({ text: ['partial'], stopReason })))
    const result = await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...collect(),
    })
    expect(result.notice).toBe(notice)
  })

  it('rejects with an abort error when stopped mid-stream (App then keeps the partial text)', async () => {
    const events = anthropicStream({ text: ['first', 'second'] })
    // message_start, content_block_start, first text_delta; then the stream hangs.
    mockFetch((req) => hangingStream(req, events.slice(0, 3).join('')))
    const ctrl = new AbortController()
    const deltas: string[] = []
    const run = streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Write a novel' })],
      signal: ctrl.signal,
      onThinking: () => undefined,
      onText: (d) => {
        deltas.push(d)
        ctrl.abort()
      },
    })
    await expect(run).rejects.toThrow('Request was aborted.')
    expect(deltas).toEqual(['first'])
  })

  it('needs an Anthropic key', async () => {
    const fetch = mockFetch(() => sseResponse([]))
    await expect(
      streamChat({ settings: settings(), model: CLAUDE, messages: [], signal: new AbortController().signal, ...collect() }),
    ).rejects.toThrow('Add an Anthropic API key')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('friendlyError', () => {
  async function failWith(status: number, body: unknown = { error: { message: 'boom' } }) {
    mockFetch(() => jsonResponse(body, status))
    try {
      await streamChat({
        settings: settings({ openaiKey: 'sk-test' }),
        model: GPT,
        messages: [msg({ role: 'user', content: 'Hi' })],
        signal: new AbortController().signal,
        ...collect(),
      })
    } catch (e) {
      return friendlyError(e)
    }
    throw new Error('expected streamChat to fail')
  }

  it.each([
    [401, 'That API key was rejected. Check it in Settings.'],
    [429, 'Rate limited or out of credits on this key. Try again shortly, or check your billing.'],
    [404, 'This model isn’t available on your key. Pick another model.'],
    [503, 'The provider is having trouble right now. Try again in a moment.'],
  ])('maps HTTP %i from the provider to a plain-language message', async (status, text) => {
    expect(await failWith(status)).toBe(text)
  })

  it('shows the provider’s own message for other errors', async () => {
    // The OpenAI SDK's message carries a status prefix ("400 Image too large").
    expect(await failWith(400, { error: { message: 'Image too large' } })).toContain('Image too large')
  })

  async function anthropicFailWith(status: number, message: string) {
    mockFetch(() => jsonResponse({ type: 'error', error: { type: 'some_error', message } }, status))
    const err = await streamChat({
      settings: settings({ anthropicKey: 'sk-ant-test' }),
      model: CLAUDE,
      messages: [msg({ role: 'user', content: 'Hi' })],
      signal: new AbortController().signal,
      ...collect(),
    }).catch((e: unknown) => e)
    return friendlyError(err)
  }

  it('handles Anthropic errors the same way, unwrapping the nested error message', async () => {
    expect(await anthropicFailWith(401, 'invalid x-api-key')).toBe('That API key was rejected. Check it in Settings.')
    expect(await anthropicFailWith(400, 'Image too large')).toBe('Image too large')
  })

  it('falls back for plain errors and unknown values', () => {
    expect(friendlyError(new Error('Nope'))).toBe('Nope')
    expect(friendlyError('weird')).toBe('Something went wrong.')
  })
})

describe('listModels', () => {
  const anthropicModels = {
    data: [
      { type: 'model', id: 'claude-b', display_name: 'Claude B', created_at: '2026-01-01T00:00:00Z', max_tokens: 64000 },
      { type: 'model', id: 'claude-a', display_name: '', created_at: '2025-01-01T00:00:00Z' },
    ],
    has_more: false,
    first_id: 'claude-b',
    last_id: 'claude-a',
  }
  const openaiModels = {
    object: 'list',
    data: [
      { id: 'gpt-4o', created: 1, object: 'model', owned_by: 'openai' },
      { id: 'gpt-5-mini', created: 3, object: 'model', owned_by: 'openai' },
      { id: 'o3', created: 2, object: 'model', owned_by: 'openai' },
      { id: 'chatgpt-4o-latest', created: 0, object: 'model', owned_by: 'openai' },
      // Everything below is filtered out: not chat models, or dated snapshots.
      { id: 'gpt-4o-2024-08-06', created: 9, object: 'model', owned_by: 'openai' },
      { id: 'gpt-4o-realtime-preview', created: 9, object: 'model', owned_by: 'openai' },
      { id: 'gpt-4o-mini-tts', created: 9, object: 'model', owned_by: 'openai' },
      { id: 'text-embedding-3-small', created: 9, object: 'model', owned_by: 'openai' },
      { id: 'dall-e-3', created: 9, object: 'model', owned_by: 'openai' },
      { id: 'whisper-1', created: 9, object: 'model', owned_by: 'openai' },
    ],
  }
  const xaiModels = {
    object: 'list',
    data: [
      { id: 'grok-4', created: 2, object: 'model', owned_by: 'xai' },
      { id: 'grok-3-mini', created: 3, object: 'model', owned_by: 'xai' },
      { id: 'grok-2-image-1212', created: 9, object: 'model', owned_by: 'xai' },
      { id: 'grok-2-1212', created: 9, object: 'model', owned_by: 'xai' },
    ],
  }

  it('queries each configured provider in parallel, filters to chat models and groups them by provider', async () => {
    mockFetch((req) => {
      if (req.url.startsWith('https://api.anthropic.com/v1/models')) return jsonResponse(anthropicModels)
      if (req.url.startsWith('https://api.openai.com/v1/models')) return jsonResponse(openaiModels)
      if (req.url.startsWith('https://api.x.ai/v1/models')) return jsonResponse(xaiModels)
      throw new Error(`unexpected request to ${req.url}`)
    })
    const list = await listModels(settings({ anthropicKey: 'a', openaiKey: 'o', xaiKey: 'x' }))
    expect(list).toEqual([
      { id: 'anthropic:claude-b', provider: 'anthropic', model: 'claude-b', label: 'Claude B', maxTokens: 64000 },
      { id: 'anthropic:claude-a', provider: 'anthropic', model: 'claude-a', label: 'claude-a', maxTokens: undefined },
      // Newest first, with friendly labels.
      { id: 'openai:gpt-5-mini', provider: 'openai', model: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'openai:o3', provider: 'openai', model: 'o3', label: 'o3' },
      { id: 'openai:gpt-4o', provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
      { id: 'openai:chatgpt-4o-latest', provider: 'openai', model: 'chatgpt-4o-latest', label: 'ChatGPT-4o-latest' },
      { id: 'xai:grok-3-mini', provider: 'xai', model: 'grok-3-mini', label: 'Grok 3 mini' },
      { id: 'xai:grok-4', provider: 'xai', model: 'grok-4', label: 'Grok 4' },
    ])
    expect(requests.map((r) => new URL(r.url).host).sort()).toEqual(['api.anthropic.com', 'api.openai.com', 'api.x.ai'])
  })

  it('only contacts providers that have a key, and never sends one key to another host', async () => {
    mockFetch(() => jsonResponse(anthropicModels))
    await listModels(settings({ anthropicKey: 'only-anthropic' }))
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).host).toBe('api.anthropic.com')
    expect(requests[0].headers.get('x-api-key')).toBe('only-anthropic')
  })

  it('makes no requests at all without keys', async () => {
    const fetch = mockFetch(() => jsonResponse({}))
    expect(await listModels(settings())).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to the built-in model list when a provider rejects the listing', async () => {
    mockFetch(() => jsonResponse({ error: { message: 'nope' } }, 401))
    const list = await listModels(settings({ anthropicKey: 'a', openaiKey: 'o', xaiKey: 'x' }))
    expect(list).toEqual([
      ...FALLBACK_MODELS.filter((m) => m.provider === 'anthropic'),
      ...FALLBACK_MODELS.filter((m) => m.provider === 'openai'),
      ...FALLBACK_MODELS.filter((m) => m.provider === 'xai'),
    ])
  })

  it('lists every model from a custom endpoint unfiltered, with no fallback if it is down', async () => {
    mockFetch(() =>
      jsonResponse({ object: 'list', data: [{ id: 'llama3.2:latest', created: 0, object: 'model', owned_by: 'me' }] }),
    )
    const list = await listModels(settings({ openaiBaseUrl: 'http://localhost:11434/v1' }))
    expect(requests[0].url).toBe('http://localhost:11434/v1/models')
    expect(list).toEqual([{ id: 'openai:llama3.2:latest', provider: 'openai', model: 'llama3.2:latest', label: 'llama3.2:latest' }])

    mockFetch(() => jsonResponse({ error: { message: 'down' } }, 404))
    expect(await listModels(settings({ openaiBaseUrl: 'http://localhost:11434/v1' }))).toEqual([])
  })
})

describe('voice API calls', () => {
  it('transcribe tries gpt-4o-transcribe, then falls back to whisper-1', async () => {
    const models: unknown[] = []
    mockFetch(async (req) => {
      // The SDK first probes `fetch('data:,')` to check FormData support; ignore that.
      if (req.url === 'data:,') return new Response('')
      const form = req.body as FormData
      models.push(form.get('model'))
      const file = form.get('file') as File
      expect(file.name).toBe('voice.mp4')
      return models.length === 1 ? jsonResponse({ error: { message: 'no access' } }, 403) : jsonResponse({ text: '  hello there \n' })
    })
    const text = await transcribe(settings({ openaiKey: 'sk-test' }), new Blob(['x'], { type: 'audio/mp4' }))
    expect(text).toBe('hello there')
    expect(models).toEqual(['gpt-4o-transcribe', 'whisper-1'])
    const api = requests.filter((r) => r.url !== 'data:,')
    expect(api.map((r) => r.url)).toEqual([
      'https://api.openai.com/v1/audio/transcriptions',
      'https://api.openai.com/v1/audio/transcriptions',
    ])
    expect(api[0].headers.get('authorization')).toBe('Bearer sk-test')
  })

  it('speak requests mp3 TTS (default voice, input capped at 4000 chars) and returns an object URL', async () => {
    mockFetch(() => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })))
    const url = await speak(settings({ openaiKey: 'sk-test', voice: '' }), 'a'.repeat(5000))
    expect(url).toMatch(/^blob:/)
    expect(requests[0].url).toBe('https://api.openai.com/v1/audio/speech')
    expect(requests[0].body).toEqual({ model: 'gpt-4o-mini-tts', voice: 'marin', input: 'a'.repeat(4000), response_format: 'mp3' })
    URL.revokeObjectURL(url)
  })
})
