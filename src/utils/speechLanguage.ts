export interface SpeechVoiceLike {
  lang: string
  default?: boolean
  localService?: boolean
}

function normalizeLanguage(lang: string): string {
  return lang.trim().replace(/_/g, '-').toLowerCase()
}

function languageBase(lang: string): string {
  return normalizeLanguage(lang).split('-')[0]
}

function canonicalLanguage(lang: string): string {
  const normalized = normalizeLanguage(lang)
  if (!normalized) return ''
  const [base, ...rest] = normalized.split('-')
  return [base, ...rest.map((part) => part.toUpperCase())].join('-')
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Built once and reused. Null on older browsers without Intl.DisplayNames; the
// strict BCP-47 regex path still works there.
const englishLanguageNames: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()

function languageDisplayNames(lang: string): string[] {
  if (!englishLanguageNames) return []
  const canonical = canonicalLanguage(lang)
  const base = languageBase(canonical)
  const names = new Set<string>()

  try {
    names.add(englishLanguageNames.of(canonical) ?? '')
    names.add(englishLanguageNames.of(base) ?? '')
  } catch {
    // Malformed subtags — keep whatever resolved.
  }

  return [...names].map(normalizeName).filter(Boolean)
}

function parseLanguageName(raw: string, candidateLanguages: readonly string[]): string | null {
  if (candidateLanguages.length === 0) return null
  const cleaned = normalizeName(raw)
  if (!cleaned) return null

  const candidates = [...new Set(candidateLanguages.map(canonicalLanguage).filter(Boolean))]
  for (const lang of candidates) {
    const names = languageDisplayNames(lang)
    if (names.some((name) =>
      cleaned === name ||
      cleaned.startsWith(`${name} `) ||
      cleaned.includes(` ${name} `) ||
      cleaned.endsWith(` ${name}`)
    )) {
      return lang
    }
  }
  return null
}

export function parseSpeechLanguageCode(raw: string, candidateLanguages: readonly string[] = []): string | null {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`.,;:!?]+$/g, '')

  // `und` (the BCP-47 "undetermined" tag) needs no special branch — it already
  // matches `[a-z]{2,3}` and is rejected as null below.
  const code =
    cleaned.match(/\b([a-z]{2,3}(?:-[a-z0-9]{2,8}){1,3})\b/i)?.[1] ??
    cleaned.match(/\b(?:language|tag|code)\s*:\s*([a-z]{2,3})\b/i)?.[1] ??
    cleaned.match(/^([a-z]{2,3})$/i)?.[1]

  if (code) {
    if (code.toLowerCase() === 'und') return null
    const canonical = canonicalLanguage(code)
    // The loose tag regex can lift bogus tags out of prose ("non-English" →
    // "non-ENGLISH"). When the device's languages are known, only trust a tag
    // whose base is among them; otherwise fall through to name matching.
    const bases = new Set(candidateLanguages.map(languageBase).filter(Boolean))
    if (bases.size === 0 || bases.has(languageBase(canonical))) return canonical
  }
  return parseLanguageName(raw, candidateLanguages)
}

export function chooseSpeechVoice<T extends SpeechVoiceLike>(
  voices: readonly T[],
  language: string,
  preferredLanguages: readonly string[] = []
): T | undefined {
  const target = normalizeLanguage(language)
  const targetBase = target.split('-')[0]
  const preferred = new Set(preferredLanguages.map(normalizeLanguage))

  // Single pass: normalise each voice once, keep only same-base-language voices,
  // and track the highest-scoring one (first wins on ties).
  let best: T | undefined
  let bestScore = -1
  for (const voice of voices) {
    const voiceLang = normalizeLanguage(voice.lang)
    if (voiceLang.split('-')[0] !== targetBase) continue
    let score = 0
    if (voiceLang === target) score += 100
    if (preferred.has(voiceLang)) score += 20
    if (voice.default) score += 4
    if (voice.localService) score += 2
    if (score > bestScore) {
      best = voice
      bestScore = score
    }
  }
  return best
}
