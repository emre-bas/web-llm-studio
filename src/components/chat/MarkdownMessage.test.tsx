import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownMessage } from './MarkdownMessage'

// Render to a static HTML string (no jsdom needed) and assert on the markup.
// react-markdown runs its remark/rehype pipeline synchronously during render,
// so syntax highlighting (rehype-highlight) is applied here too.
function render(md: string): string {
  return renderToStaticMarkup(<MarkdownMessage content={md} />)
}

const SAMPLE = [
  'A **bold** word and `inline code`.',
  '',
  '```python',
  'def greet(name):',
  '    print(name)',
  '```',
  '',
  '- Apple',
  '- Banana',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
].join('\n')

describe('MarkdownMessage', () => {
  const html = render(SAMPLE)

  it('renders a fenced code block as <pre><code>', () => {
    expect(html).toContain('<pre>')
    expect(html).toMatch(/<code[^>]*>/)
  })

  it('applies syntax highlighting (highlight.js hljs classes)', () => {
    expect(html).toContain('hljs')
  })

  it('renders bullet lists and bold/inline code', () => {
    expect(html).toContain('<li>Apple</li>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toMatch(/<code[^>]*>inline code<\/code>/)
  })

  it('renders GFM tables', () => {
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('shows a per-code-block copy button', () => {
    expect(html).toContain('Copy')
  })

  it('does not leak raw markdown syntax (no literal code fences)', () => {
    expect(html).not.toContain('```')
  })

  it('renders external links with safe rel/target', () => {
    const linkHtml = render('[site](https://example.com)')
    expect(linkHtml).toContain('target="_blank"')
    expect(linkHtml).toContain('rel="noopener noreferrer"')
  })
})
