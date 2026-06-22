import { describe, it, expect } from 'vitest'
import { contentToText, type ContentPart } from './base'

describe('contentToText', () => {
  it('passes plain strings through unchanged', () => {
    expect(contentToText('hello world')).toBe('hello world')
  })

  it('joins text parts and drops image parts (for text-only engines)', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'in detail' },
    ]
    expect(contentToText(parts)).toBe('describe this\nin detail')
  })

  it('returns an empty string when an array has no text parts', () => {
    const parts: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]
    expect(contentToText(parts)).toBe('')
  })
})
