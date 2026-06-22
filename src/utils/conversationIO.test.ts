import { describe, it, expect } from 'vitest'
import { buildExport, parseImport, parseImportText, EXPORT_SCHEMA } from './conversationIO'
import type { SavedConversation } from '../hooks/useChatHistory'

function conv(overrides: Partial<SavedConversation> = {}): SavedConversation {
  return {
    id: 'orig-1',
    title: 'Hello',
    modelId: 'm1',
    modelName: 'Model 1',
    createdAt: 1000,
    updatedAt: 2000,
    systemPrompt: 'be nice',
    temperature: 0.5,
    maxTokens: 256,
    messages: [{ id: 'a', role: 'user', content: 'hi', timestamp: 1000 }],
    ...overrides,
  }
}

describe('buildExport', () => {
  it('wraps conversations in a versioned envelope', () => {
    const env = buildExport([conv()], '1.2.3')
    expect(env.app).toBe('web-llm-studio')
    expect(env.schema).toBe(EXPORT_SCHEMA)
    expect(env.appVersion).toBe('1.2.3')
    expect(env.conversations).toHaveLength(1)
    expect(typeof env.exportedAt).toBe('number')
  })
})

describe('parseImport', () => {
  it('round-trips an exported envelope', () => {
    const env = buildExport([conv(), conv({ title: 'Second' })])
    const out = parseImport(env)
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('Hello')
    expect(out[1].title).toBe('Second')
    // settings preserved
    expect(out[0].temperature).toBe(0.5)
    expect(out[0].systemPrompt).toBe('be nice')
  })

  it('regenerates ids so imports never clobber existing chats', () => {
    const out = parseImport(buildExport([conv(), conv()]))
    expect(out[0].id).not.toBe('orig-1')
    expect(out[1].id).not.toBe('orig-1')
    expect(out[0].id).not.toBe(out[1].id)
  })

  it('accepts a bare array of conversations', () => {
    const out = parseImport([conv()])
    expect(out).toHaveLength(1)
  })

  it('skips invalid records but keeps valid ones', () => {
    const out = parseImport([conv(), { nope: true }, null])
    expect(out).toHaveLength(1)
  })

  it('fills in defaults for a sparse-but-valid conversation', () => {
    // Only the two required fields (title + messages array) are present; the rest
    // should be coerced rather than left undefined or throwing.
    const [out] = parseImport([{ title: '', messages: [] }])
    expect(out.title).toBe('Imported conversation')
    expect(out.modelId).toBeNull()
    expect(out.modelName).toBeNull()
    expect(out.systemPrompt).toBe('')
    expect(typeof out.createdAt).toBe('number')
    expect(typeof out.updatedAt).toBe('number')
  })

  it('throws on a non-export object', () => {
    expect(() => parseImport({ foo: 'bar' })).toThrow()
  })

  it('throws when there are no valid conversations', () => {
    expect(() => parseImport([{ nope: true }])).toThrow()
  })
})

describe('parseImportText', () => {
  it('parses JSON text', () => {
    const text = JSON.stringify(buildExport([conv()]))
    expect(parseImportText(text)).toHaveLength(1)
  })

  it('throws a friendly error on invalid JSON', () => {
    expect(() => parseImportText('{not json')).toThrow(/valid JSON/)
  })
})
