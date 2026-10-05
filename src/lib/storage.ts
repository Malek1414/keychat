import { createStore, del, set, values } from 'idb-keyval'
import { DEFAULT_SETTINGS, type Conversation, type ModelOption, type Settings } from './types'

// Conversations hold images and PDFs, which outgrow localStorage fast, so they live in IndexedDB.
const chats = createStore('keychat', 'conversations')

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const all = await values<Conversation>(chats)
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function saveConversation(c: Conversation) {
  return set(c.id, c, chats).catch(() => undefined)
}

export function deleteConversation(id: string) {
  return del(id, chats).catch(() => undefined)
}

export async function clearConversations() {
  const all = await loadConversations()
  await Promise.all(all.map((c) => deleteConversation(c.id)))
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode or quota: settings just won't persist */
  }
}

export const loadSettings = () => readLocal<Settings>('keychat.settings', DEFAULT_SETTINGS)
export const saveSettings = (s: Settings) => writeLocal('keychat.settings', s)

export function loadModelCache(): ModelOption[] {
  try {
    return JSON.parse(localStorage.getItem('keychat.models') || '[]')
  } catch {
    return []
  }
}
export const saveModelCache = (m: ModelOption[]) => writeLocal('keychat.models', m)

export function loadLastModel(): string {
  try {
    return localStorage.getItem('keychat.lastModel') || ''
  } catch {
    return ''
  }
}
export function saveLastModel(id: string) {
  try {
    localStorage.setItem('keychat.lastModel', id)
  } catch {
    /* ignore */
  }
}
