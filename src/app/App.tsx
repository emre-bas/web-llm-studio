import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '../components/layout/Layout'
import { DashboardPage } from '../pages/DashboardPage'
import { ModelsPage } from '../pages/ModelsPage'
import { ChatPage } from '../pages/ChatPage'
import { SettingsPage } from '../pages/SettingsPage'
import { useAppStore } from '../stores/appStore'
import { setDevLogs } from '../utils/logger'

export function App() {
  const { settings } = useAppStore()

  useEffect(() => {
    setDevLogs(settings.devLogs)
    document.documentElement.dataset.theme = settings.theme
  }, [settings.devLogs, settings.theme])

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Chat is the primary experience */}
          <Route index element={<ChatPage />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
