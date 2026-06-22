import { NavLink } from 'react-router-dom'
import styles from './Sidebar.module.css'
import logoUrl from '../../assets/logo.png'
import { useEngine } from '../../hooks/useEngine'
import { useWebGpu } from '../../hooks/useWebGpu'
import { NAV_ITEMS, STATUS_ITEM } from './navItems'
import { useNavDrawer } from './navDrawer'

export function Sidebar() {
  const { loadedModel, status } = useEngine()
  const gpu = useWebGpu()
  const { open, setOpen } = useNavDrawer()
  const closeDrawer = () => setOpen(false)

  // Shown under the Models nav item so the loaded model is always in view.
  const modelLine =
    status === 'loading' ? 'Loading…'
      : loadedModel ? loadedModel.name
      : 'No model loaded'

  return (
    <aside className={`${styles.sidebar} ${open ? styles.drawerOpen : ''}`}>
      <div className={styles.brand}>
        <NavLink to="/" end onClick={closeDrawer} className={styles.logo} aria-label="Web LLM Studio — home">
          <div className={styles.logoMark}>
            <img src={logoUrl} alt="" width={28} height={28} />
          </div>
          <div>
            <div className={styles.logoName}>Web LLM Studio</div>
            <div className={styles.logoSub}>Local · In-Browser</div>
          </div>
        </NavLink>
        <button
          type="button"
          className={styles.drawerClose}
          onClick={closeDrawer}
          aria-label="Close menu"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <nav className={styles.nav} aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={closeDrawer}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.navIcon}><item.Icon size={20} /></span>
            <span className={styles.navBody}>
              <span className={styles.navLabel}>{item.label}</span>
              {item.to === '/models' && (
                <span className={styles.navModelRow}>
                  <span className={`${styles.statusDot} ${styles[status]}`} aria-hidden="true" />
                  <span className={styles.navModelName} title={modelLine}>{modelLine}</span>
                </span>
              )}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Demoted diagnostic destination */}
      <NavLink
        to={STATUS_ITEM.to}
        onClick={closeDrawer}
        className={({ isActive }) => `${styles.footer} ${isActive ? styles.footerActive : ''}`}
        title="System status"
      >
        <span className={styles.navIcon}><STATUS_ITEM.Icon size={20} /></span>
        <span className={styles.footerLabel}>{STATUS_ITEM.label}</span>
        {!gpu.checking && (
          <span
            className={styles.gpuPill}
            title={gpu.supported ? gpu.adapterName : gpu.error}
          >
            <span aria-hidden="true">{gpu.supported ? '⚡' : '🖥'}</span>
            <span>{gpu.supported ? 'GPU' : 'CPU'}</span>
          </span>
        )}
      </NavLink>
    </aside>
  )
}
