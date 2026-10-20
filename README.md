<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/banner-dark.svg">
  <img alt="KeyChat: a pixel bird with a key for a tail, lifting its wing while it types a chat bubble" src="assets/readme/banner-light.svg" width="100%">
</picture>
</p>

<p align="center">
  <a href="https://malek1414.github.io/keychat/"><b>Use it in the browser</b></a> &nbsp;·&nbsp;
  <a href="https://github.com/Malek1414/keychat/releases/latest"><b>Desktop downloads</b></a> &nbsp;·&nbsp;
  <a href="#development"><b>Development</b></a>
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-desktop-47848f?style=flat-square&logo=electron&logoColor=white">
  <img alt="Web, macOS, Windows, Linux" src="https://img.shields.io/badge/runs_on-web_·_macOS_·_Windows_·_Linux-555?style=flat-square">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square">
</p>

**A ChatGPT-style chat app for OpenAI (GPT), Anthropic (Claude) and xAI (Grok) models that runs on your own API keys.** There's no account, no subscription and no server. You paste a key, pick a model and chat; requests go straight from your device to the provider.

It runs on phone and desktop browsers at **https://malek1414.github.io/keychat/**. On a phone, use *Share → Add to Home Screen* to install it like an app. There is also a desktop app for macOS, Windows and Linux.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/divider-dark.svg">
  <img alt="" src="assets/readme/divider-light.svg" width="100%">
</picture>

## What it does

- **Chat with GPT, Claude and Grok models.** The model list loads from your keys, so new models show up on their own. Replies stream in, with markdown, code highlighting, tables and copy buttons.
- **Photos.** Tap **+** → *Add photos & files*, or paste, or drag and drop. On a phone you also get *Take photo*. Thumbnails appear in the message box before you send; tap any image to view it full screen. Big photos are resized automatically to stay under the provider limits.
- **Files.** PDFs plus text and code files (`.txt`, `.md`, `.csv`, `.json`, `.py`, `.js`, …) are read by the model.
- **Voice typing.** Tap the mic, talk, then ✓. Your speech becomes text in the box, ready to edit and send, the same way ChatGPT's dictation works.
- **Voice mode.** Tap the round waveform button for a hands-free conversation. It listens, notices when you stop talking, answers out loud, and listens again. Tap the orb to interrupt.
- **Read aloud** on any answer, plus edit and resend, regenerate, and stop.
- Chat history with search, rename and delete. Light and dark themes, custom instructions.

Voice features use your **OpenAI** key (OpenAI transcription and text-to-speech). With only a Claude key, voice falls back to the browser's built-in speech where the browser supports it (Chrome, Safari).

Grok reads photos and text files; for PDFs, use a GPT or Claude model.

## Getting an API key

- OpenAI: https://platform.openai.com/api-keys
- Anthropic (Claude): https://console.anthropic.com/settings/keys
- xAI (Grok): https://console.x.ai

Paste any of them into the welcome screen. You pay the provider directly for what you use.

**Privacy:** keys and chats are stored only on your device (browser storage). Requests go straight from your device to OpenAI, Anthropic or xAI; nothing passes through anyone else's server.

**Custom endpoints:** each provider in *Settings → API keys* has an optional *API endpoint* field. Point the OpenAI one at any OpenAI-compatible server (OpenRouter, Groq, Together, Azure, local Ollama / LM Studio), or route Claude through a proxy.

## How it works

KeyChat is a single-page React app with no backend. `src/lib/providers.ts` talks to each provider from the browser with the official SDKs:

| Provider | Client | Notes |
|---|---|---|
| OpenAI | `openai` SDK | optional custom base URL from Settings |
| Anthropic | `@anthropic-ai/sdk` | optional custom base URL from Settings |
| xAI | `openai` SDK pointed at `https://api.x.ai/v1` | |

- **Models.** Each key's `models.list()` fills the picker; if a list call fails, a small built-in fallback list is used.
- **Storage.** Conversations hold images and PDFs, which outgrow `localStorage` fast, so they live in IndexedDB (`idb-keyval`). Settings and the last-used model stay in `localStorage`.
- **Attachments.** Images larger than 2048 px on the long edge or 3.5 MB are redrawn on a canvas and re-encoded before sending. PDFs are capped at 30 MB and text files at 2 MB (`src/lib/attachments.ts`).
- **Voice.** Dictation uses `gpt-4o-transcribe` (falling back to `whisper-1`); read aloud and voice mode use `gpt-4o-mini-tts`. Without an OpenAI key it uses the browser's `SpeechRecognition` and `speechSynthesis`.
- **Desktop.** `electron/main.cjs` loads the same build from `dist/` in a sandboxed window with context isolation. Links in answers open in your real browser, and the microphone is the only permission it asks for.

The Vite build uses a relative base, so the same `dist/` works on GitHub Pages (`/keychat/`) and inside Electron (`file://`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/divider-dark.svg">
  <img alt="" src="assets/readme/divider-light.svg" width="100%">
</picture>

## Desktop app (macOS, Windows, Linux)

### Download

| Your computer | Download |
|---|---|
| Mac with Apple Silicon (M1–M4) | [KeyChat-mac-arm64.dmg](https://github.com/Malek1414/keychat/releases/latest/download/KeyChat-mac-arm64.dmg) |
| Mac with Intel | [KeyChat-mac-x64.dmg](https://github.com/Malek1414/keychat/releases/latest/download/KeyChat-mac-x64.dmg) |
| Windows | [KeyChat-win-x64.exe](https://github.com/Malek1414/keychat/releases/latest/download/KeyChat-win-x64.exe) |
| Linux | [KeyChat-linux-x86_64.AppImage](https://github.com/Malek1414/keychat/releases/latest/download/KeyChat-linux-x86_64.AppImage) |

The apps aren't code-signed (that needs paid Apple/Microsoft certificates), so the first launch takes one extra step:

- **Mac:** open the `.dmg` and drag KeyChat into Applications. Open it; when macOS says it can't verify the app, click **Done**, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. After that it opens normally.
- **Windows:** run the installer. If a blue "Windows protected your PC" box appears, click **More info → Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x KeyChat-*.AppImage`) and run it.

### Or run from source

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
npm run dist          # desktop installer for this OS in release/
```

Pushing a tag like `v1.0.1` builds the Mac, Windows and Linux installers and attaches them to a GitHub release (`.github/workflows/release.yml`).

Every push to `main` deploys the web version to GitHub Pages (`.github/workflows/pages.yml`).

```
src/
  App.tsx              app shell, chat state
  components/          Composer, MessageView, ModelPicker, Sidebar, SettingsDialog, VoiceMode, Lightbox …
  lib/providers.ts     model lists, streaming, transcription, text-to-speech
  lib/attachments.ts   image resizing, PDF and text file reading
  lib/storage.ts       IndexedDB chats, localStorage settings
  lib/voice.ts         recording, browser speech fallback
electron/              main process and preload for the desktop app
build/                 app icons and the electron-builder after-pack hook
```

Built with React, Vite, Electron and the official `openai` and `@anthropic-ai/sdk` SDKs.

## License

MIT

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/divider-dark.svg">
  <img alt="" src="assets/readme/divider-light.svg" width="100%">
</picture>

<p align="center">
  <img alt="" src="assets/readme/logo.svg" width="72"><br>
  <sub>Built by <a href="https://github.com/Malek1414">Malek Hassan</a> in Berlin.</sub>
</p>
