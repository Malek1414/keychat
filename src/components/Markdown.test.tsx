import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

/*
 * Model output is untrusted input: a prompt-injected document can make the
 * model reply with HTML or script. These tests render <Markdown> to a string
 * (no DOM needed) and check that hostile output stays inert.
 */
const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))

describe('<Markdown> with untrusted model output', () => {
  it('escapes raw HTML instead of rendering it (no rehype-raw)', () => {
    const out = html('Hi <img src=x onerror="alert(1)"> <script>alert(1)</script>')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
  })

  it('neutralises javascript: links and opens real links in a new tab without an opener', () => {
    const out = html('[bad](javascript:alert(1)) and [good](https://example.com)')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<a href="" target="_blank" rel="noreferrer noopener">bad</a>')
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noreferrer noopener">good</a>')
  })
})

describe('<Markdown> formatting', () => {
  it('wraps fenced code in a labelled block with a copy button and syntax highlighting', () => {
    const out = html('```ts\nconst a = 1\n```')
    expect(out).toContain('<div class="code-block">')
    expect(out).toContain('<span>ts</span>')
    expect(out).toContain('Copy code')
    expect(out).toContain('hljs-keyword')
  })

  it('renders GitHub-style tables inside a scroll wrapper', () => {
    const out = html('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('<div class="table-wrap"><table>')
    expect(out).toContain('<td>2</td>')
  })

  it('marks the block while a reply is still streaming', () => {
    expect(renderToStaticMarkup(createElement(Markdown, { text: 'Hel', streaming: true }))).toMatch(/^<div class="md streaming">/)
  })
})
