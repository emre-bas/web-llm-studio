import { describe, it, expect } from 'vitest'
import {
  advancedToOptions,
  upsertConversation,
  mergeImported,
  DEFAULT_ADVANCED_PARAMS,
  type SavedConversation,
} from './useChatHistory'

const conv = (id: string, updatedAt: number): SavedConversation => ({
  id,
  title: id,
  modelId: null,
  modelName: null,
  createdAt: 0,
  updatedAt,
  systemPrompt: '',
  messages: [],
})

describe('advancedToOptions', () => {
  it('passes through sampling fields', () => {
    const out = advancedToOptions({ ...DEFAULT_ADVANCED_PARAMS, topP: 0.8, topK: 10, frequencyPenalty: 0.5, presencePenalty: 0.25 })
    expect(out).toMatchObject({ topP: 0.8, topK: 10, frequencyPenalty: 0.5, presencePenalty: 0.25 })
  })

  it('treats a null seed as "random" by omitting it', () => {
    expect(advancedToOptions({ ...DEFAULT_ADVANCED_PARAMS, seed: null }).seed).toBeUndefined()
  })

  it('keeps a numeric seed (including 0) for determinism', () => {
    expect(advancedToOptions({ ...DEFAULT_ADVANCED_PARAMS, seed: 0 }).seed).toBe(0)
    expect(advancedToOptions({ ...DEFAULT_ADVANCED_PARAMS, seed: 42 }).seed).toBe(42)
  })

  it('drops an empty stop list but keeps a populated one', () => {
    expect(advancedToOptions({ ...DEFAULT_ADVANCED_PARAMS, stop: [] }).stop).toBeUndefined()
    expect(advancedToOptions({ ...DEFAULT_ADVANCED_PARAMS, stop: ['END'] }).stop).toEqual(['END'])
  })
})

describe('upsertConversation', () => {
  it('replaces an existing conversation in place (no growth)', () => {
    const prev = [conv('a', 1), conv('b', 2)]
    const next = upsertConversation(prev, { ...conv('a', 5), title: 'updated' })
    expect(next).toHaveLength(2)
    expect(next.find((c) => c.id === 'a')?.title).toBe('updated')
  })

  it('prepends a new conversation and sorts newest-first', () => {
    const prev = [conv('a', 3), conv('b', 1)]
    const next = upsertConversation(prev, conv('c', 2))
    expect(next.map((c) => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('caps the list at 100 conversations', () => {
    const prev = Array.from({ length: 100 }, (_, i) => conv(`c${i}`, i))
    const next = upsertConversation(prev, conv('new', 999))
    expect(next).toHaveLength(100)
    expect(next[0].id).toBe('new') // newest sorts first
  })
})

describe('mergeImported', () => {
  it('merges imported ahead of existing and sorts newest-first', () => {
    const next = mergeImported([conv('old', 1)], [conv('imp', 5)])
    expect(next.map((c) => c.id)).toEqual(['imp', 'old'])
  })

  it('caps the merged result at 100', () => {
    const prev = Array.from({ length: 60 }, (_, i) => conv(`p${i}`, i))
    const imported = Array.from({ length: 60 }, (_, i) => conv(`i${i}`, 1000 + i))
    expect(mergeImported(prev, imported)).toHaveLength(100)
  })
})
