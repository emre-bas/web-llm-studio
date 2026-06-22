import { useState, useEffect } from 'react'
import { loadModelCatalog } from '../catalog/modelCatalog'
import type { ModelEntry } from '../catalog/types'
import { useDeviceProfile } from './useDeviceProfile'
import { fitsDevice } from '../catalog/deviceFit'

// The default starter model offered to new users — capable, a reasonable first
// download, and the strongest small model for multilingual use. Matched by
// WebLLM modelId so it works for both the bundled and dynamic catalogs.
const PREFERRED_STARTER_MODEL_ID = 'gemma-2-2b-it-q4f16_1-MLC'

// Several starter suggestions for the welcome slider, smallest first so the
// lightest download leads. The preferred starter is pinned to the front.
export function useRecommendedModels(limit = 6): ModelEntry[] {
  const [models, setModels] = useState<ModelEntry[]>([])
  const deviceProfile = useDeviceProfile()

  useEffect(() => {
    loadModelCatalog().then(setModels).catch(() => {})
  }, [])

  if (models.length === 0) return []

  const candidates = models
    .filter((m) =>
      !m.experimental && !m.disabled && m.recommended && fitsDevice(m, deviceProfile)
    )
    .sort((a, b) => a.estimatedRam - b.estimatedRam)

  const preferredIdx = candidates.findIndex((m) => m.modelId === PREFERRED_STARTER_MODEL_ID)
  if (preferredIdx > 0) {
    const [preferred] = candidates.splice(preferredIdx, 1)
    candidates.unshift(preferred)
  }

  return candidates.slice(0, limit)
}
