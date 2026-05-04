import { create } from 'zustand'

export interface TerminalSession {
  id: string
  title: string
  createdAt: string
}

interface TerminalStore {
  sessions: TerminalSession[]
  activeSessionId: string | null
  floatingOpen: boolean
  floatingPosition: { x: number; y: number }
  floatingSize: { width: number; height: number }

  setSessions: (sessions: TerminalSession[]) => void
  addSession: (session: TerminalSession) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  toggleFloating: () => void
  setFloatingOpen: (open: boolean) => void
  setFloatingPosition: (pos: { x: number; y: number }) => void
  setFloatingSize: (size: { width: number; height: number }) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  floatingOpen: false,
  // Safe defaults for SSR — repositioned on first open in the component
  floatingPosition: { x: 100, y: 100 },
  floatingSize: { width: 640, height: 400 },

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((s) => ({
    sessions: [...s.sessions, session],
    activeSessionId: session.id,
  })),
  removeSession: (id) => set((s) => {
    const sessions = s.sessions.filter(ss => ss.id !== id)
    const activeSessionId = s.activeSessionId === id
      ? (sessions[sessions.length - 1]?.id ?? null)
      : s.activeSessionId
    return { sessions, activeSessionId }
  }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  toggleFloating: () => set((s) => {
    // Position relative to viewport on first open
    if (!s.floatingOpen && typeof window !== 'undefined') {
      return {
        floatingOpen: true,
        floatingPosition: {
          x: window.innerWidth - s.floatingSize.width - 40,
          y: window.innerHeight - s.floatingSize.height - 40,
        },
      }
    }
    return { floatingOpen: !s.floatingOpen }
  }),
  setFloatingOpen: (open) => set({ floatingOpen: open }),
  setFloatingPosition: (pos) => set({ floatingPosition: pos }),
  setFloatingSize: (size) => set({ floatingSize: size }),
}))
