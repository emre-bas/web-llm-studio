import type { ModelEntry } from '../../catalog/types'
import { Modal } from '../ui/Modal'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { formatMB } from '../../utils/formatBytes'
import styles from './ModelDetailModal.module.css'

interface Props {
  model: ModelEntry | null
  onClose: () => void
  isLoaded: boolean
  isLoading: boolean
  onLoad: (model: ModelEntry) => void
  onUnload: () => void
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.dt}>{label}</dt>
      <dd className={styles.dd}>{value}</dd>
    </div>
  )
}

export function ModelDetailModal({ model, onClose, isLoaded, isLoading, onLoad, onUnload }: Props) {
  if (!model) return null

  return (
    <Modal open={!!model} onClose={onClose} title={model.name} size="lg">
      <div className={styles.content}>
        <div className={styles.badges}>
          <Badge variant={model.engine === 'webllm' ? 'accent' : 'info'}>
            {model.engine === 'webllm' ? 'WebLLM' : 'Wllama'}
          </Badge>
          <Badge variant="muted">{model.format.toUpperCase()}</Badge>
          {model.recommended && <Badge variant="success">Recommended</Badge>}
          {model.experimental && <Badge variant="warning">Experimental</Badge>}
          {model.disabled && <Badge variant="danger">Disabled</Badge>}
          {isLoaded && <Badge variant="accent">● Currently Loaded</Badge>}
        </div>

        <p className={styles.description}>{model.description}</p>

        {model.warnings.length > 0 && (
          <div className={styles.warningsBox}>
            <strong>Warnings</strong>
            <ul>
              {model.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        <dl className={styles.grid}>
          <Row label="Provider" value={model.provider} />
          {model.architecture && <Row label="Architecture" value={model.architecture} />}
          <Row label="Parameters" value={model.parameterSize} />
          <Row label="Quantization" value={<code>{model.quantization.toUpperCase()}</code>} />
          <Row label="Format" value={model.format.toUpperCase()} />
          <Row label="Est. RAM" value={formatMB(model.estimatedRam)} />
          {model.estimatedVram > 0 && (
            <Row label="Est. VRAM" value={formatMB(model.estimatedVram)} />
          )}
          <Row label="Download Size" value={model.sizeLabel} />
          {model.license && <Row label="License" value={model.license} />}
          <Row label="Engine" value={model.engine} />
          {model.file && <Row label="GGUF File" value={<code>{model.file}</code>} />}
          <Row label="Model ID" value={<code className={styles.modelId}>{model.modelId}</code>} />
          {model.repo && <Row label="Repository" value={<code>{model.repo}</code>} />}
          <Row label="Tags" value={
            <div className={styles.tagList}>
              {model.tags.map((t) => (
                <Badge key={t} variant="muted">{t}</Badge>
              ))}
            </div>
          } />
        </dl>

        <div className={styles.actions}>
          {model.sourceUrl && (
            <a
              href={model.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sourceLink}
            >
              View on HuggingFace ↗
            </a>
          )}
          {isLoaded ? (
            <Button variant="danger" size="sm" onClick={onUnload}>
              Unload Model
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={isLoading}
              disabled={model.disabled}
              onClick={() => { onLoad(model); onClose() }}
            >
              Load Model
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
