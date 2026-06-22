import styles from './Card.module.css'

interface Props {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hoverable?: boolean
  onClick?: () => void
}

export function Card({ children, className = '', padding = 'md', hoverable = false, onClick }: Props) {
  return (
    <div
      className={`${styles.card} ${styles[`padding-${padding}`]} ${hoverable ? styles.hoverable : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {children}
    </div>
  )
}
