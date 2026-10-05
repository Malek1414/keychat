import { MoreHorizontal, PanelLeft, Pencil, Search, Settings as SettingsIcon, SquarePen, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Conversation } from '../lib/types'

function group(convs: Conversation[]) {
  const day = 86400000
  const startToday = new Date().setHours(0, 0, 0, 0)
  const buckets: [string, Conversation[]][] = [
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Previous 30 days', []],
    ['Older', []],
  ]
  for (const c of convs) {
    const t = c.updatedAt
    const i = t >= startToday ? 0 : t >= startToday - day ? 1 : t >= startToday - 7 * day ? 2 : t >= startToday - 30 * day ? 3 : 4
    buckets[i][1].push(c)
  }
  return buckets.filter(([, list]) => list.length)
}

interface Props {
  open: boolean
  conversations: Conversation[]
  activeId: string | null
  onToggle: () => void
  onNew: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onSettings: () => void
}

export function Sidebar({ open, conversations, activeId, onToggle, onNew, onSelect, onRename, onDelete, onSettings }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuFor) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuFor])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
    )
  }, [conversations, query])

  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onToggle} />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="sidebar-top drag">
          <button type="button" className="icon-btn no-drag" aria-label="Close sidebar" data-tip="Close sidebar" onClick={onToggle}>
            <PanelLeft size={20} />
          </button>
          <div className="no-drag" style={{ display: 'flex', gap: 2 }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Search chats"
              data-tip="Search chats"
              onClick={() => {
                setSearching((s) => !s)
                setQuery('')
              }}
            >
              <Search size={19} />
            </button>
            <button type="button" className="icon-btn" aria-label="New chat" data-tip="New chat" onClick={onNew}>
              <SquarePen size={19} />
            </button>
          </div>
        </div>

        {searching && (
          <div className="side-search">
            <input autoFocus placeholder="Search chats…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}

        <button type="button" className="side-item new" onClick={onNew}>
          <SquarePen size={17} /> New chat
        </button>

        <nav className="side-list">
          {filtered.length === 0 && <div className="side-empty">{query ? 'No chats found' : 'Your chats will show up here'}</div>}
          {group(filtered).map(([label, list]) => (
            <div key={label} className="side-group">
              <div className="side-label">{label}</div>
              {list.map((c) =>
                renaming === c.id ? (
                  <input
                    key={c.id}
                    className="rename-input"
                    autoFocus
                    defaultValue={c.title}
                    onBlur={(e) => {
                      onRename(c.id, e.target.value.trim() || c.title)
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <div key={c.id} className={`side-item chat ${c.id === activeId ? 'active' : ''} ${menuFor === c.id ? 'menu-open' : ''}`}>
                    <button type="button" className="chat-title" onClick={() => onSelect(c.id)} title={c.title}>
                      {c.title}
                    </button>
                    <div className="menu-anchor" ref={menuFor === c.id ? menuRef : undefined}>
                      <button
                        type="button"
                        className="chat-more"
                        aria-label="Chat options"
                        onClick={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {menuFor === c.id && (
                        <div className="popover right" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null)
                              setRenaming(c.id)
                            }}
                          >
                            <Pencil size={16} /> Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              setMenuFor(null)
                              onDelete(c.id)
                            }}
                          >
                            <Trash2 size={16} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </nav>

        <button type="button" className="side-item settings" onClick={onSettings}>
          <SettingsIcon size={18} /> Settings
        </button>
      </aside>
    </>
  )
}
