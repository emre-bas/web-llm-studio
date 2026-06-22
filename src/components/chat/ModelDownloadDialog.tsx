import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { formatMB } from '../../utils/formatBytes'
import type { ModelEntry } from '../../catalog/types'
import type { WebGpuInfo } from '../../hooks/useWebGpu'
import styles from './ModelDownloadDialog.module.css'

interface Props {
  open: boolean
  model: ModelEntry | null
  webgpu: WebGpuInfo
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shown before a real (uncached) model download starts. Sets first-run
 * expectations — size, one-time download, cached/offline afterwards, keep the
 * tab open — and warns up front when the browser can't run the model, so the
 * user doesn't pull gigabytes only to fail at startup.
 */
export function ModelDownloadDialog({ open, model, webgpu, onConfirm, onCancel }: Props) {
  if (!model) return null

  // WebLLM models run on the GPU and need WebGPU; GGUF/Wllama models run on CPU.
  const needsWebGpu = model.engine === 'webllm'
  const gpuBlocked = needsWebGpu && !webgpu.checking && !webgpu.supported

  return (
    <Modal open={open} onClose={onCancel} title="Download model" size="sm">
      <div className={styles.head}>
        <span className={styles.name}>{model.name}</span>
        <span className={styles.size}>{model.sizeLabel} download</span>
      </div>

      <ul className={styles.points}>
        <li>
          <span className={styles.icon} aria-hidden="true">⬇️</span>
          Downloads <strong>{model.sizeLabel}</strong> once over your connection.
        </li>
        <li>
          <span className={styles.icon} aria-hidden="true">💾</span>
          Saved on your device afterwards — instant next time, even offline.
        </li>
        <li>
          <span className={styles.icon} aria-hidden="true">⏳</span>
          The first load can take a few minutes. Keep this tab open while it downloads.
        </li>
        {needsWebGpu && model.estimatedVram > 0 && (
          <li>
            <span className={styles.icon} aria-hidden="true">🎛️</span>
            Runs on your GPU — needs about <strong>{formatMB(model.estimatedVram)}</strong> of VRAM.
          </li>
        )}
      </ul>

      {gpuBlocked && (
        <div className={styles.warn} role="alert">
          <strong>WebGPU isn’t available in this browser.</strong>
          <span>
            {webgpu.error || 'This model needs WebGPU to run.'} It will download but
            likely won’t start — try Chrome or Edge with hardware acceleration on, or
            pick a CPU (GGUF) model instead.
          </span>
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" size="md" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="md" onClick={onConfirm}>
          {gpuBlocked ? 'Download anyway' : 'Download & Load'}
        </Button>
      </div>
    </Modal>
  )
}
