import { describe, expect, it } from 'vitest'
import { chooseSpeechVoice, parseSpeechLanguageCode, type SpeechVoiceLike } from './speechLanguage'

describe('parseSpeechLanguageCode', () => {
  it('extracts and canonicalizes a BCP-47-ish language tag', () => {
    expect(parseSpeechLanguageCode('en-us')).toBe('en-US')
    expect(parseSpeechLanguageCode('The language is: pt-BR.')).toBe('pt-BR')
    expect(parseSpeechLanguageCode('Language: es')).toBe('es')
  })

  it('maps a model language-name response through available voice languages', () => {
    expect(parseSpeechLanguageCode('English', ['en-US', 'pt-BR'])).toBe('en-US')
    expect(parseSpeechLanguageCode('The language is Portuguese.', ['en-US', 'pt-BR'])).toBe('pt-BR')
  })

  it('ignores unknown or missing language responses', () => {
    expect(parseSpeechLanguageCode('und')).toBeNull()
    expect(parseSpeechLanguageCode('I am not sure.')).toBeNull()
  })

  it('accepts a structurally valid tag when no device languages are given', () => {
    expect(parseSpeechLanguageCode('de-DE')).toBe('de-DE')
  })

  it('rejects a bogus tag the loose regex lifts from prose, then name-matches', () => {
    // "non-English" would otherwise be read as the tag "non-ENGLISH"; with the
    // device languages known, its base isn't among them, so we fall back to the
    // language name and resolve "English".
    expect(parseSpeechLanguageCode('non-English', ['en-US', 'tr-TR'])).toBe('en-US')
  })

  it('ignores a real tag the device has no voice for', () => {
    expect(parseSpeechLanguageCode('fr-FR', ['en-US', 'tr-TR'])).toBeNull()
  })

  it('keeps a model-supplied region when the base language is available', () => {
    expect(parseSpeechLanguageCode('pt-BR', ['en-US', 'pt-PT'])).toBe('pt-BR')
  })
})

describe('chooseSpeechVoice', () => {
  const voices: SpeechVoiceLike[] = [
    { lang: 'en-US', default: true, localService: true },
    { lang: 'pt-PT' },
    { lang: 'pt-BR', localService: true },
  ]

  it('prefers an exact language match', () => {
    expect(chooseSpeechVoice(voices, 'pt-BR')?.lang).toBe('pt-BR')
  })

  it('falls back to another voice with the same base language', () => {
    expect(chooseSpeechVoice(voices, 'pt-AO')?.lang).toBe('pt-BR')
  })
})
