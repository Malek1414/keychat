// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from './storage'
import type { Conversation, ModelOption } from './types'
import { DEFAULT_SETTINGS } from './types'

/*
 * Settings, the model cache and the last-picked model live in localStorage
 * (jsdom provides a real one). Conversations live in IndexedDB through
 * idb-keyval, which is swapped for an in-memory Map here so the tests check
 * the app's own logic: sorting, error swallowing, clearing.
 */

const db = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  fail: false,
  stores: [] as [string, string][],
}))

vi.mock('idb-keyval', () => ({
  createStore: (dbName: string, storeName: string) => {
    db.stores.push([dbName, storeName])
    return 'store'
  },
  values: async () => {
    if (db.fail) throw new Error('IndexedDB unavailable')
    return [...db.rows.values()]
  },
  set: async (key: string, value: unknown) => {
    if (db.fail) throw new Error('QuotaExceededError')
    db.rows.set(key, value)
  },
  del: async (key: string) => {
    if (db.fail) throw new Error('IndexedDB unavailable')
    db.rows.delete(key)
  },
}))

const conv = (id: string, updatedAt: number): Conversation => ({
  id,
  title: id,
  messages: [{ id: `${id}-m`, role: 'user', content: 'hi', createdAt: updatedAt }],
  modelId: 'anthropic:claude-test',
  createdAt: 0,
  updatedAt,
})

beforeEach(() => {
  localStorage.clear()
  db.rows.clear()
  db.fail = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('settings (localStorage "keychat.settings")', () => {
  it('returns the defaults on first run', () => {
    expect(storage.loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips through localStorage as JSON', () => {
    const s = { ...DEFAULT_SETTINGS, anthropicKey: 'sk-ant-1', theme: 'dark' as const, systemPrompt: 'Be brief.' }
    storage.saveSettings(s)
    expect(JSON.parse(localStorage.getItem('keychat.settings')!)).toEqual(s)
    expect(storage.loadSettings()).toEqual(s)
  })

  it('fills in fields added in newer versions from the defaults', () => {
    // An older build stored settings before xAI and custom endpoints existed.
    localStorage.setItem('keychat.settings', JSON.stringify({ openaiKey: 'sk-old', theme: 'light' }))
    expect(storage.loadSettings()).toEqual({ ...DEFAULT_SETTINGS, openaiKey: 'sk-old', theme: 'light' })
  })

  it('falls back to defaults if the stored JSON is corrupted', () => {
    localStorage.setItem('keychat.settings', '{not json')
    expect(storage.loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('does not crash when storage is full or blocked (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(() => storage.saveSettings({ ...DEFAULT_SETTINGS, openaiKey: 'x' })).not.toThrow()
    expect(() => storage.saveLastModel('openai:gpt-4o')).not.toThrow()
  })

  it('does not crash when reading storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    expect(storage.loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(storage.loadModelCache()).toEqual([])
    expect(storage.loadLastModel()).toBe('')
  })
})

describe('model cache and last model', () => {
  const models: ModelOption[] = [{ id: 'openai:gpt-4o', provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' }]

  it('caches the model list under "keychat.models"', () => {
    expect(storage.loadModelCache()).toEqual([])
    storage.saveModelCache(models)
    expect(localStorage.getItem('keychat.models')).toBe(JSON.stringify(models))
    expect(storage.loadModelCache()).toEqual(models)
  })

  it('treats a corrupted cache as empty', () => {
    localStorage.setItem('keychat.models', 'oops')
    expect(storage.loadModelCache()).toEqual([])
  })

  it('remembers the last model under "keychat.lastModel"', () => {
    expect(storage.loadLastModel()).toBe('')
    storage.saveLastModel('anthropic:claude-test')
    expect(localStorage.getItem('keychat.lastModel')).toBe('anthropic:claude-test')
    expect(storage.loadLastModel()).toBe('anthropic:claude-test')
  })
})

describe('conversations (IndexedDB "keychat" / "conversations")', () => {
  it('uses one dedicated object store', () => {
    expect(db.stores).toEqual([['keychat', 'conversations']])
  })

  it('saves by id and loads newest first', async () => {
    await storage.saveConversation(conv('old', 1))
    await storage.saveConversation(conv('new', 3))
    await storage.saveConversation(conv('mid', 2))
    expect((await storage.loadConversations()).map((c) => c.id)).toEqual(['new', 'mid', 'old'])
  })

  it('overwrites a conversation saved again with the same id', async () => {
    await storage.saveConversation(conv('a', 1))
    await storage.saveConversation({ ...conv('a', 5), title: 'Renamed' })
    const all = await storage.loadConversations()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Renamed')
  })

  it('deletes one conversation, or all of them', async () => {
    await Promise.all(['a', 'b', 'c'].map((id, i) => storage.saveConversation(conv(id, i))))
    await storage.deleteConversation('b')
    expect((await storage.loadConversations()).map((c) => c.id)).toEqual(['c', 'a'])
    await storage.clearConversations()
    expect(await storage.loadConversations()).toEqual([])
  })

  it('never throws into the UI when IndexedDB fails', async () => {
    db.fail = true
    await expect(storage.loadConversations()).resolves.toEqual([])
    await expect(storage.saveConversation(conv('x', 1))).resolves.toBeUndefined()
    await expect(storage.deleteConversation('x')).resolves.toBeUndefined()
  })
})
