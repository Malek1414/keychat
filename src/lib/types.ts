export type Provider = 'openai' | 'anthropic'

export interface Attachment {
  id: string
  kind: 'image' | 'pdf' | 'text'
  name: string
  mime: string
  size: number
  /** data: URL for images and PDFs. */
  dataUrl?: string
  /** Decoded contents for text/code files. */
  text?: string
  width?: number
  height?: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  model?: string
  error?: string
  /** Seconds the model spent thinking before the first visible token. */
  thoughtFor?: number
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  modelId: string
  createdAt: number
  updatedAt: number
}

export interface ModelOption {
  /** `${provider}:${model}` */
  id: string
  provider: Provider
  model: string
  label: string
  maxTokens?: number
}

export interface Settings {
  openaiKey: string
  anthropicKey: string
  /** Optional OpenAI-compatible endpoint (OpenRouter, Groq, Ollama, LM Studio...). */
  openaiBaseUrl: string
  systemPrompt: string
  theme: 'system' | 'light' | 'dark'
  voice: string
}

export const DEFAULT_SETTINGS: Settings = {
  openaiKey: '',
  anthropicKey: '',
  openaiBaseUrl: '',
  systemPrompt: '',
  theme: 'system',
  voice: 'marin',
}
