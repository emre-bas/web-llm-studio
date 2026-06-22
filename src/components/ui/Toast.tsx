import { createPortal } from 'react-dom'
import { useAppStore } from '../../stores/appStore'
import styles from './Toast.module.css'

const ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore()

  return createPortal(
    <div className={styles.container} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          <span className={styles.icon}>{ICONS[t.type]}</span>
          <span className={styles.message}>{t.message}</span>
          <button
            className={styles.close}
            onClick={() => removeToast(t.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
