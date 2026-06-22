import { useState, useCallback, useEffect } from 'react'
import type { ModelEntry } from '../../catalog/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { formatMB } from '../../utils/formatBytes'
import styles from './ModelCard.module.css'

interface Props {
  model: ModelEntry
  isLoaded: boolean
  isLoading: boolean
  /** Whether this model is downloaded/cached (from the page-level bulk scan). */
  isCached: boolean
  onLoad: (model: ModelEntry) => void
  onUnload: () => void
  onDetails: (model: ModelEntry) => void
  onDeleteCache: (model: ModelEntry) => Promise<void>
}

export function ModelCard({
  model,
  isLoaded,
  isLoading,
  isCached,
  onLoad,
  onUnload,
  onDetails,
  onDeleteCache,
}: Props) {
  // Cache state is driven by the page's automatic scan; we keep a local copy so
  // a successful delete reflects immediately before the next scan completes.
  const [cached, setCached] = useState(isCached)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => { setCached(isCached) }, [isCached])

  const handleDeleteCache = useCallback(async () => {
    if (!confirm(`Delete cached data for "${model.name}"?`)) return
    setDeleting(true)
    setError(undefined)
    try {
      await onDeleteCache(model)
      setCached(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setDeleting(false)
    }
  }, [model, onDeleteCache])

  const busy = isLoading || deleting

  return (
    <div className={`${styles.card} ${isLoaded ? styles.loaded : ''} ${model.disabled ? styles.disabled : ''}`}>
      {/* Left: identity & description */}
      <div className={styles.main}>
        <div className={styles.badges}>
          <Badge variant={model.engine === 'webllm' ? 'accent' : 'info'}>
            {model.engine === 'webllm' ? 'WebLLM' : 'Wllama'}
          </Badge>
          <Badge variant="muted">{model.format.toUpperCase()}</Badge>
          {model.supportsVision && <Badge variant="info">👁 Vision</Badge>}
          {model.recommended && <Badge variant="success">Recommended</Badge>}
          {model.experimental && <Badge variant="warning">Experimental</Badge>}
          {model.disabled && <Badge variant="danger">Disabled</Badge>}
          {cached && <Badge variant="info">⬇ Downloaded</Badge>}
          {isLoaded && <Badge variant="accent">● Loaded</Badge>}
        </div>

        <div className={styles.nameRow}>
          <h3 className={styles.name}>{model.name}</h3>
          <span className={styles.provider}>{model.provider} · {model.quantization.toUpperCase()}</span>
        </div>

        <p className={styles.description}>{model.description}</p>

        {model.warnings.length > 0 && (
          <div className={styles.warnings}>
            {model.warnings.slice(0, 2).map((w, i) => (
              <div key={i} className={styles.warning}>⚠ {w}</div>
            ))}
          </div>
        )}

        <div className={`${styles.cacheStatus} ${cached ? styles.cacheCached : styles.cacheNot}`}>
          {cached ? '● Cached locally' : '○ Not cached'}
        </div>
        {error && <div className={styles.cacheError}>{error}</div>}
      </div>

      {/* Right: stats & actions */}
      <div className={styles.side}>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Params</span>
            <span className={styles.statValue}>{model.parameterSize}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>RAM</span>
            <span className={styles.statValue}>{formatMB(model.estimatedRam)}</span>
          </div>
          {model.estimatedVram > 0 && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>VRAM</span>
              <span className={styles.statValue}>{formatMB(model.estimatedVram)}</span>
            </div>
          )}
          <div className={styles.stat}>
            <span className={styles.statLabel}>Size</span>
            <span className={styles.statValue}>{model.sizeLabel}</span>
          </div>
        </div>

        <div className={styles.actions}>
          {isLoaded ? (
            <Button size="sm" variant="danger" onClick={onUnload} disabled={busy}>
              Unload
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onLoad(model)}
              disabled={busy || model.disabled}
              loading={isLoading}
            >
              {cached ? 'Load' : 'Download & Load'}
            </Button>
          )}
          {cached && (
            <Button size="sm" variant="danger" onClick={handleDeleteCache} loading={deleting} disabled={busy}>
              Delete Cache
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onDetails(model)}>
            Details
          </Button>
        </div>
      </div>
    </div>
  )
}
