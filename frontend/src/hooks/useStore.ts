import { create } from 'zustand'
import type { Source, SearchSource } from '../api/client'

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
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  sidebarBeforeChat: boolean
  chatMessages: ChatMessage[]
  setChatMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void
  clearChatMessages: () => void
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
      // 打开聊天：记住当前侧边栏状态，然后收起
      set({ chatOpen: true, sidebarBeforeChat: state.sidebarCollapsed, sidebarCollapsed: true })
    } else {
      // 关闭聊天：恢复之前的侧边栏状态
      set({ chatOpen: false, sidebarCollapsed: state.sidebarBeforeChat })
    }
  },
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  sidebarBeforeChat: false,
  chatMessages: [],
  setChatMessages: (fn) => set({ chatMessages: fn(get().chatMessages) }),
  clearChatMessages: () => set({ chatMessages: [] }),
}))
