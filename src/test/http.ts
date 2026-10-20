/*
 * Test helpers for faking the network. Both provider SDKs call the global
 * `fetch`, so tests replace it with `vi.stubGlobal('fetch', ...)` and answer
 * with these canned responses. Nothing here ever touches a real API.
 */

const enc = new TextEncoder()

/** A Server-Sent Events body, optionally cut into tiny byte chunks to mimic a slow network. */
export function sseResponse(events: string[], chunkSize = 0): Response {
  const bytes = enc.encode(events.join(''))
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      if (!chunkSize) c.enqueue(bytes)
      else for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Tell the SDKs not to retry 429/5xx, so error tests stay instant.
    headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
  })
}

/** One OpenAI-style SSE event (`data: {...}`). */
export const openaiChunk = (content: string | undefined, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-test',
    choices: content === undefined ? [] : [{ index: 0, delta: { content }, finish_reason: null }],
    ...extra,
  })}\n\n`

export const OPENAI_DONE = 'data: [DONE]\n\n'

/** One Anthropic-style SSE event (`event: type` + `data: {...}`). */
export const anthropicEvent = (data: { type: string } & Record<string, unknown>) =>
  `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`

/** A full Anthropic Messages stream: optional thinking block, then text deltas, then a stop reason. */
export function anthropicStream(opts: { text: string[]; thinking?: boolean; stopReason?: string }): string[] {
  const events = [
    anthropicEvent({
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 1 },
      },
    }),
  ]
  let index = 0
  if (opts.thinking) {
    events.push(
      anthropicEvent({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      anthropicEvent({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: 'Let me think.' } }),
      anthropicEvent({ type: 'content_block_stop', index }),
    )
    index++
  }
  events.push(anthropicEvent({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }))
  for (const t of opts.text) events.push(anthropicEvent({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } }))
  events.push(
    anthropicEvent({ type: 'content_block_stop', index }),
    anthropicEvent({
      type: 'message_delta',
      delta: { stop_reason: opts.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    }),
    anthropicEvent({ type: 'message_stop' }),
  )
  return events
}

/** What a fetch mock was called with, normalised so tests can assert on it. */
export interface Captured {
  url: string
  method: string
  headers: Headers
  body: unknown
  signal?: AbortSignal | null
}

export function capture(input: RequestInfo | URL, init?: RequestInit): Captured {
  const raw = init?.body
  let body: unknown = raw
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }
  return {
    url: String(input instanceof Request ? input.url : input),
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: new Headers(init?.headers),
    body,
    signal: init?.signal,
  }
}
