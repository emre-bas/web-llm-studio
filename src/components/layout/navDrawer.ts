import { createContext, useContext } from 'react'

// Controls the mobile off-canvas navigation drawer. Provided by Layout so any
// page (e.g. the chat status bar) can open the nav without prop drilling.
export interface NavDrawerCtx {
  open: boolean
  setOpen: (open: boolean) => void
}

export const NavDrawerContext = createContext<NavDrawerCtx>({
  open: false,
  setOpen: () => {},
})

export function useNavDrawer(): NavDrawerCtx {
  return useContext(NavDrawerContext)
}
