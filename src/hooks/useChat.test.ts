import { describe, it, expect } from 'vitest'
import {
  supportsSystemRole,
  foldSystemPrompt,
  buildHistory,
  toDisplayAttachment,
  byteLen,
  ATTACHMENT_PERSIST_LIMIT,
  type ChatEntry,
  type Attachment,
} from './useChat'
import type { ContentPart } from '../engines/base'

const entry = (role: 'user' | 'assistant', content: ChatEntry['content'], i = 0): ChatEntry => ({
  id: `${role}-${i}`,
  role,
  content,
  timestamp: i,
})

describe('supportsSystemRole', () => {
  it('assumes support when the model id is unknown', () => {
    expect(supportsSystemRole(undefined)).toBe(true)
  })
  it('reports no system role for Gemma models (any casing)', () => {
    expect(supportsSystemRole('gemma-2-2b-it-q4f16_1-MLC')).toBe(false)
    expect(supportsSystemRole('GEMMA-7B')).toBe(false)
  })
  it('reports support for non-Gemma models', () => {
    expect(supportsSystemRole('Llama-3.2-3B-Instruct')).toBe(true)
  })
})

describe('foldSystemPrompt', () => {
  it('prepends to plain string content', () => {
    expect(foldSystemPrompt('hello', 'BE NICE')).toBe('BE NICE\n\nhello')
  })
  it('folds into the first text part of a multimodal array, leaving images', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:img' } },
    ]
    const out = foldSystemPrompt(content, 'BE NICE') as ContentPart[]
    expect(out[0]).toEqual({ type: 'text', text: 'BE NICE\n\ndescribe this' })
    expect(out[1]).toEqual(content[1])
  })
  it('prepends a new text part when the array has no text', () => {
    const content: ContentPart[] = [{ type: 'image_url', image_url: { url: 'data:img' } }]
    const out = foldSystemPrompt(content, 'BE NICE') as ContentPart[]
    expect(out[0]).toEqual({ type: 'text', text: 'BE NICE' })
    expect(out).toHaveLength(2)
  })
})

describe('buildHistory', () => {
  it('prepends a system message for models that support a system role', () => {
    const out = buildHistory([entry('user', 'hi')], 'BE NICE', 'Llama-3.2-3B')
    expect(out[0]).toEqual({ role: 'system', content: 'BE NICE' })
    expect(out[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('omits the system message when the prompt is blank/whitespace', () => {
    const out = buildHistory([entry('user', 'hi')], '   ', 'Llama-3.2-3B')
    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('folds the system prompt into the first user turn for Gemma (no system role)', () => {
    const out = buildHistory([entry('user', 'hi')], 'BE NICE', 'gemma-2-2b-it')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ role: 'user', content: 'BE NICE\n\nhi' })
  })

  it('keeps only the last 20 turns', () => {
    const many = Array.from({ length: 25 }, (_, i) => entry(i % 2 ? 'assistant' : 'user', `m${i}`, i))
    const out = buildHistory(many, '', 'Llama')
    expect(out).toHaveLength(20)
    expect(out[0].content).toBe('m5') // 25 - 20
    expect(out[19].content).toBe('m24')
  })

  it('applies transformLast to the newest turn before folding (single-turn fold survives)', () => {
    const out = buildHistory(
      [entry('user', 'typed')],
      'BE NICE',
      'gemma-2-2b-it',
      () => 'AUGMENTED',
    )
    // transformLast replaces the content, THEN the Gemma fold wraps it — so the
    // injected attachments and the system prompt both reach the model.
    expect(out[0]).toEqual({ role: 'user', content: 'BE NICE\n\nAUGMENTED' })
  })

  it('does not touch earlier turns when transforming the last (multi-turn)', () => {
    const out = buildHistory(
      [entry('user', 'first', 0), entry('assistant', 'reply', 1), entry('user', 'second', 2)],
      '',
      'Llama',
      () => 'LAST-ONLY',
    )
    expect(out.map((m) => m.content)).toEqual(['first', 'reply', 'LAST-ONLY'])
  })
})

describe('byteLen', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(byteLen('abc')).toBe(3)
    expect(byteLen('é')).toBe(2) // 2-byte UTF-8
    expect(byteLen('🎉')).toBe(4) // 4-byte UTF-8
  })
})

describe('toDisplayAttachment', () => {
  const base = { id: 'a', mimeType: 'text/plain', url: 'blob:x', size: 1 }

  it('keeps the downscaled preview (not the full dataUrl) for images', () => {
    const a: Attachment = { ...base, name: 'p.png', kind: 'image', dataUrl: 'FULL', previewUrl: 'SMALL' }
    expect(toDisplayAttachment(a)).toEqual({ name: 'p.png', mimeType: 'text/plain', kind: 'image', dataUrl: 'SMALL' })
  })

  it('keeps file text when it is within the persist limit', () => {
    const a: Attachment = { ...base, name: 'f.txt', kind: 'file', text: 'small' }
    expect(toDisplayAttachment(a).text).toBe('small')
  })

  it('drops file text over the persist limit (metadata-only chip)', () => {
    const a: Attachment = { ...base, name: 'big.txt', kind: 'file', text: 'x'.repeat(ATTACHMENT_PERSIST_LIMIT + 1) }
    expect(toDisplayAttachment(a).text).toBeUndefined()
  })
})
