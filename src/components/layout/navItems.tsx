import type { ComponentType } from 'react'
import { ChatIcon, ModelsIcon, StatusIcon, SettingsIcon } from './navIcons'

export interface NavItem {
  to: string
  label: string
  Icon: ComponentType<{ size?: number }>
  end: boolean
}

// Primary navigation — the app is chat-first, so only the core destinations
// live here. System Status is diagnostic (read-only) and is demoted to the
// sidebar footer status widget instead of taking a top-level slot.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Chat', Icon: ChatIcon, end: true },
  { to: '/models', label: 'Models', Icon: ModelsIcon, end: false },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon, end: false },
]

// Demoted diagnostic destination, surfaced via the sidebar footer.
export const STATUS_ITEM: NavItem = {
  to: '/dashboard', label: 'System Status', Icon: StatusIcon, end: false,
}
