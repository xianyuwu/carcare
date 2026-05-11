import { useEffect, useState, useRef } from 'react'
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Upload,
  BookOpen, Car, Wrench, Settings, MessageSquare,
  PanelLeftClose, PanelLeft, LogOut, Shield, ChevronDown
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from './hooks/useStore'
import { getVehicles, uploadVehiclePhoto, type Vehicle } from './api/client'
import Dashboard from './pages/Dashboard'
import RecordsList from './pages/RecordsList'
import UploadPage from './pages/UploadPage'
import ManualPage from './pages/ManualPage'
import VehiclePage from './pages/VehiclePage'
import DictionaryPage from './pages/DictionaryPage'
import SettingsPage from './pages/SettingsPage'
import ChatPanel from './components/ChatPanel'
import PdfViewerPage from './pages/PdfViewerPage'
import LoginPage from './pages/LoginPage'
import AuthGuard from './components/AuthGuard'
import { clearTokens } from './api/client'

// 用户类型
interface User {
  id: number
  email: string
  nickname: string
  role: string
}

// 车辆头像（照片 + 上传按钮）
function VehicleAvatar({ vehicle, onUploaded }: { vehicle: Vehicle | undefined; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !vehicle) return
    setUploading(true)
    try {
      await uploadVehiclePhoto(vehicle.id, file)
      onUploaded()
    } catch { /* 上传失败静默处理 */ }
    setUploading(false)
    // 清空 input，允许重复选同一文件
    e.target.value = ''
  }

  return (
    <div className="relative shrink-0 group">
      <div className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white">
        {uploading ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : vehicle?.photo_url ? (
          <img src={vehicle.photo_url} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs font-bold">{vehicle?.brand?.[0] || '?'}</span>
        )}
      </div>
      {/* hover 时显示上传小按钮 */}
      <button
        onClick={() => fileRef.current?.click()}
        className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50"
        title="更换车辆照片"
      >
        <Upload className="w-2.5 h-2.5 text-blue-500" />
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  )
}

// 侧边栏组件（品牌 + 菜单 + 底部用户信息）
function Sidebar({
  user,
  onLogout,
}: {
  user: User | null
  onLogout: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const setCollapsed = useStore((s) => s.setSidebarCollapsed)
  const currentVehicleId = useStore((s) => s.currentVehicleId)
  const setCurrentVehicleId = useStore((s) => s.setCurrentVehicleId)
  const qc = useQueryClient()

  // 获取车辆列表
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })

  // 自动选择：如果 currentVehicleId 为 null 或对应的车辆不存在，自动选第一辆
  useEffect(() => {
    if (!vehicles?.length) return
    const exists = vehicles.some((v: Vehicle) => v.id === currentVehicleId)
    if (!exists) {
      setCurrentVehicleId(vehicles[0].id)
    }
  }, [vehicles, currentVehicleId, setCurrentVehicleId])

  const currentVehicle = vehicles?.find((v: Vehicle) => v.id === currentVehicleId)

  // 从 pathname 获取当前菜单（HashRouter 下 pathname 即 hash 路径）
  const activeMenu = location.pathname.split('/')[1] || 'dashboard'

  const menuItems = [
    { key: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
    { key: 'records', label: '保养记录', icon: FileText },
    { key: 'upload', label: '上传录入', icon: Upload },
    { key: 'manual', label: '保养知识', icon: BookOpen },
    { key: 'vehicle', label: '车辆档案', icon: Car },
    { key: 'dictionary', label: '项目字典', icon: Wrench },
    { key: 'settings', label: '系统设置', icon: Settings },
  ]

  return (
    <aside className={`bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-200 ${collapsed ? 'w-16' : 'w-56'}`}>
      {/* 顶部：品牌 + 折叠按钮 */}
      <div className="p-2 border-b border-slate-100">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              title="展开菜单"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Car className="w-4 h-4 text-white" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Car className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-slate-800 text-sm">车辆管家</span>
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              title="收起菜单"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 车辆选择器：只有一辆车时不显示，只有 >1 辆车才展示切换 */}
      {vehicles && vehicles.length > 1 && (
        <div className={`px-2 py-2 border-b border-slate-100 ${collapsed ? 'flex justify-center' : ''}`}>
          {collapsed ? (
            <div
              className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center cursor-pointer hover:from-blue-100 hover:to-indigo-100 transition-colors text-xs font-bold text-blue-600"
              title={currentVehicle ? `${currentVehicle.brand} ${currentVehicle.model}` : '选择车辆'}
            >
              {currentVehicle?.photo_url
                ? <img src={currentVehicle.photo_url} className="w-full h-full object-cover" />
                : currentVehicle?.brand?.[0] || <Car className="w-3.5 h-3.5" />
              }
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* 车辆照片/头像 + 上传按钮 */}
              <VehicleAvatar
                vehicle={currentVehicle}
                onUploaded={() => qc.invalidateQueries({ queryKey: ['vehicles'] })}
              />
              {/* 下拉选择 */}
              <div className="relative flex-1">
                <select
                  value={currentVehicleId || ''}
                  onChange={(e) => setCurrentVehicleId(Number(e.target.value))}
                  className="w-full appearance-none bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-200 cursor-pointer transition-all hover:from-blue-100 hover:to-indigo-100"
                >
                  {vehicles.map((v: Vehicle) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model}{v.license_plate ? ` · ${v.license_plate}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400 pointer-events-none" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 菜单区 */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = activeMenu === item.key
          return (
            <button
              key={item.key}
              onClick={() => navigate(`/${item.key}`)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}

      </nav>

      {/* 用户信息 + 退出 */}
      {user && (
        <div className="p-2 border-t border-slate-100">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                {user.role === 'admin'
                  ? <Shield className="w-4 h-4 text-purple-600" />
                  : <span className="text-xs text-slate-600">{user.nickname?.[0] || user.email[0]}</span>
                }
              </div>
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="退出登录"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-2 py-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  {user.role === 'admin'
                    ? <Shield className="w-4 h-4 text-purple-600" />
                    : <span className="text-xs text-slate-600">{user.nickname?.[0] || user.email[0]}</span>
                  }
                </div>
                <div className="text-sm min-w-0">
                  <p className="text-slate-700 font-medium truncate">{user.nickname || user.email.split('@')[0]}</p>
                  <p className="text-xs text-slate-400">{user.role === 'admin' ? '管理员' : '普通用户'}</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                title="退出登录"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

// 主应用组件
function AppContent({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  const location = useLocation()
  const chatOpen = useStore((s) => s.chatOpen)
  const setChatOpen = useStore((s) => s.setChatOpen)

  // hash 路由监听
  useEffect(() => {
    const onHashChange = () => {
      window.dispatchEvent(new Event('resize'))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 获取当前 hash 对应的页面（HashRouter 下用 pathname）
  const activeMenu = location.pathname.startsWith('/pdf-viewer')
    ? 'pdf-viewer'
    : location.pathname.split('/')[1] || 'dashboard'

  const pages: Record<string, React.FC> = {
    dashboard: Dashboard,
    records: RecordsList,
    upload: UploadPage,
    manual: ManualPage,
    vehicle: VehiclePage,
    dictionary: DictionaryPage,
    settings: SettingsPage,
  }

  const Page = pages[activeMenu] || Dashboard

  // PDF 预览页：全屏渲染
  if (activeMenu === 'pdf-viewer') {
    return <PdfViewerPage />
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar user={user} onLogout={onLogout} />
      <main className="flex-1 overflow-auto min-w-0 transition-all duration-300">
        <Page />
      </main>

      {/* 右侧聊天面板 */}
      {chatOpen && <ChatPanel />}

      {/* AI 助手按钮 */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-all hover:scale-105 z-30"
          title="AI 助手"
        >
          <MessageSquare className="w-5 h-5 text-white" />
        </button>
      )}
    </div>
  )
}

// 路由配置
function AppRoutes() {
  const [user, setUser] = useState<User | null>(null)

  const handleLogout = () => {
    clearTokens()
    setUser(null)
    window.location.hash = '#/login'
    window.location.reload()
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <AuthGuard onUserLoaded={(isAdmin, u) => {
            if (u) setUser(u)
          }}>
            <AppContent user={user} onLogout={handleLogout} />
          </AuthGuard>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}