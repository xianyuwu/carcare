import { create } from 'zustand'
import type { Source, SearchSource, User } from '../api/client'
import { getToken, setToken, setRefreshToken, clearTokens, getCurrentUser } from '../api/client'

const initialMenu = location.hash.slice(1) || 'dashboard'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  feedback?: 'like' | 'dislike' | null
  sources?: Source[]
  searchSources?: SearchSource[]
}

interface AppState {
  activeMenu: string
  setActiveMenu: (menu: string) => void
  currentVehicleId: number | null
  setCurrentVehicleId: (id: number | null) => void
  pendingQuestion: string | null
  setPendingQuestion: (q: string | null) => void
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  chatMaximized: boolean
  setChatMaximized: (maximized: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  sidebarBeforeChat: boolean
  chatMessages: ChatMessage[]
  setChatMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void
  clearChatMessages: () => void

  // Auth state
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  activeMenu: initialMenu,
  setActiveMenu: (menu) => {
    location.hash = menu
    set({ activeMenu: menu })
  },
  currentVehicleId: null,
  setCurrentVehicleId: (id) => set({ currentVehicleId: id }),
  pendingQuestion: null,
  setPendingQuestion: (q) => set({ pendingQuestion: q }),
  chatOpen: false,
  setChatOpen: (open) => {
    const state = get()
    if (open) {
      set({ chatOpen: true, sidebarBeforeChat: state.sidebarCollapsed, sidebarCollapsed: true })
    } else {
      set({ chatOpen: false, sidebarCollapsed: state.sidebarBeforeChat })
    }
  },
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  chatMaximized: false,
  setChatMaximized: (maximized) => set({ chatMaximized: maximized }),
  sidebarBeforeChat: false,
  chatMessages: [],
  setChatMessages: (fn) => set({ chatMessages: fn(get().chatMessages) }),
  clearChatMessages: () => set({ chatMessages: [] }),

  // Auth
  user: null,
  isAuthenticated: !!getToken(),
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setAuth: (user, accessToken, refreshToken) => {
    setToken(accessToken)
    setRefreshToken(refreshToken)
    set({ user, isAuthenticated: true, isLoading: false })
  },
  logout: () => {
    clearTokens()
    set({ user: null, isAuthenticated: false, isLoading: false })
  },
  checkAuth: async () => {
    if (!getToken()) {
      set({ isLoading: false, isAuthenticated: false, user: null })
      return
    }
    try {
      const user = await getCurrentUser()
      set({ user, isAuthenticated: true, isLoading: false })
    } catch {
      clearTokens()
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
