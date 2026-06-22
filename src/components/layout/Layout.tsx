import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ToastContainer } from '../ui/Toast'
import { NavDrawerContext } from './navDrawer'
import { ChatSessionProvider } from '../../hooks/useChatSession'
import styles from './Layout.module.css'

export function Layout() {
  const location = useLocation()
  // Chat page (index = /) uses full-bleed layout and its own status bar.
  const isChat = location.pathname === '/'
  const [navOpen, setNavOpen] = useState(false)

  // Close the drawer whenever the route changes.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  return (
    <NavDrawerContext.Provider value={{ open: navOpen, setOpen: setNavOpen }}>
      <ChatSessionProvider>
      <div className={styles.shell}>
        <Sidebar />

        {/* Mobile drawer backdrop */}
        {navOpen && (
          <div className={styles.backdrop} onClick={() => setNavOpen(false)} aria-hidden="true" />
        )}

        <main className={`${styles.main} ${isChat ? styles.mainChat : ''}`}>
          {/* Mobile top bar — chat has its own status bar, so skip it there */}
          {!isChat && (
            <header className={styles.mobileBar}>
              <button
                className={styles.hamburger}
                onClick={() => setNavOpen(true)}
                aria-label="Open navigation"
              >
                <span /><span /><span />
              </button>
              <span className={styles.mobileBrand}>Web LLM Studio</span>
            </header>
          )}

          {isChat ? (
            <Outlet />
          ) : (
            <div className={styles.content}>
              <Outlet />
            </div>
          )}
        </main>

        <ToastContainer />
      </div>
      </ChatSessionProvider>
    </NavDrawerContext.Provider>
  )
}
