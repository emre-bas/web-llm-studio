import styles from './Progress.module.css'

interface Props {
  value: number
  max?: number
  label?: string
  showPercent?: boolean
  variant?: 'accent' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md'
}

export function Progress({
  value,
  max = 100,
  label,
  showPercent = false,
  variant = 'accent',
  size = 'md',
}: Props) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className={styles.container}>
      {(label || showPercent) && (
        <div className={styles.header}>
          {label && <span className={styles.label}>{label}</span>}
          {showPercent && <span className={styles.pct}>{Math.round(pct)}%</span>}
        </div>
      )}
      <div className={`${styles.track} ${styles[size]}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`${styles.bar} ${styles[variant]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
