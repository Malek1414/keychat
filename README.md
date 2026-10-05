# KeyChat

A clean, ChatGPT-style chat app for **OpenAI (GPT)**, **Anthropic (Claude)** and **xAI (Grok)** models. Bring your own API key; there's no account, no subscription and no server.

**Use it in the browser:** https://malek1414.github.io/keychat/

It runs on phone and desktop browsers. On a phone, use *Share → Add to Home Screen* to install it like an app.

## What it does

- **Chat with GPT, Claude and Grok models.** The model list loads from your keys, so new models show up on their own. Replies stream in, with markdown, code highlighting, tables and copy buttons.
- **Photos.** Tap **+** → *Add photos & files*, or paste, or drag and drop. On a phone you also get *Take photo*. Thumbnails appear in the message box before you send; tap any image to view it full screen. Big photos are resized automatically to stay under the provider limits.
- **Files.** PDFs plus text and code files (`.txt`, `.md`, `.csv`, `.json`, `.py`, `.js`, …) are read by the model.
- **Voice typing.** Tap the 🎤 mic, talk, then ✓. Your speech becomes text in the box, ready to edit and send, the same way ChatGPT's dictation works.
- **Voice mode.** Tap the round waveform button for a hands-free conversation. It listens, notices when you stop talking, answers out loud, and listens again. Tap the orb to interrupt.
- **Read aloud** on any answer, plus edit and resend, regenerate, and stop.
- Chat history with search, rename and delete. Light and dark themes, custom instructions.

Voice features use your **OpenAI** key (OpenAI transcription and text-to-speech). With only a Claude key, voice falls back to the browser's built-in speech where the browser supports it (Chrome, Safari).

## Getting an API key

- OpenAI: https://platform.openai.com/api-keys
- Anthropic (Claude): https://console.anthropic.com/settings/keys
- xAI (Grok): https://console.x.ai

Paste any of them into the welcome screen. You pay the provider directly for what you use.

**Privacy:** keys and chats are stored only on your device (browser storage). Requests go straight from your device to OpenAI, Anthropic or xAI; nothing passes through anyone else's server.

**Custom endpoints:** each provider in *Settings → API keys* has an optional *API endpoint* field. Point the OpenAI one at any OpenAI-compatible server (OpenRouter, Groq, Together, Azure, local Ollama / LM Studio), or route Claude through a proxy.

Grok reads photos and text files; for PDFs, use a GPT or Claude model.

## Desktop app (macOS, Windows, Linux)

You need [Node.js](https://nodejs.org) 20 or newer and git.

```bash
git clone https://github.com/Malek1414/keychat.git
cd keychat
npm install
npm run desktop
```

That builds the app and opens it in its own window. The first `npm install` downloads Electron (about 100 MB). On macOS, allow microphone access when asked so voice works.

## Development

```bash
npm run dev           # web app at http://localhost:5173
npm run desktop:dev   # desktop window with hot reload
npm run build         # production web build in dist/
```

Every push to `main` deploys the web version to GitHub Pages (`.github/workflows/pages.yml`).

Built with React, Vite, Electron and the official `openai` and `@anthropic-ai/sdk` SDKs.

## License

MIT
