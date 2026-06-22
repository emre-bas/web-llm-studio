import { type ButtonHTMLAttributes, forwardRef } from 'react'
import styles from './Button.module.css'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  iconRight?: React.ReactNode
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      loading = false,
      icon,
      iconRight,
      fullWidth = false,
      className = '',
      disabled,
      ...rest
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={`${styles.btn} ${styles[variant]} ${styles[size]} ${fullWidth ? styles.fullWidth : ''} ${className}`}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? (
          <Spinner size="sm" />
        ) : icon ? (
          <span className={styles.icon}>{icon}</span>
        ) : null}
        {children && <span>{children}</span>}
        {iconRight && !loading && <span className={styles.iconRight}>{iconRight}</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'
