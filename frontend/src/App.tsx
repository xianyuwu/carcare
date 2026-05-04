import { useEffect } from 'react'
import {
  LayoutDashboard, FileText, Upload,
  BookOpen, Car, Wrench, Settings, MessageSquare,
  PanelLeftClose, PanelLeft,
} from 'lucide-react'
import { useStore } from './hooks/useStore'
import Dashboard from './pages/Dashboard'
import RecordsList from './pages/RecordsList'
import UploadPage from './pages/UploadPage'
import ManualPage from './pages/ManualPage'
import VehiclePage from './pages/VehiclePage'
import DictionaryPage from './pages/DictionaryPage'
import SettingsPage from './pages/SettingsPage'
import ChatPanel from './components/ChatPanel'
import PdfViewerPage from './pages/PdfViewerPage'

const menuItems = [
  { key: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { key: 'records', label: '保养记录', icon: FileText },
  { key: 'upload', label: '上传录入', icon: Upload },
  { key: 'manual', label: '保养知识', icon: BookOpen },
  { key: 'vehicle', label: '车辆档案', icon: Car },
  { key: 'dictionary', label: '项目字典', icon: Wrench },
  { key: 'settings', label: '系统设置', icon: Settings },
]

const pages: Record<string, React.FC> = {
  dashboard: Dashboard,
  records: RecordsList,
  upload: UploadPage,
  manual: ManualPage,
  vehicle: VehiclePage,
  dictionary: DictionaryPage,
  settings: SettingsPage,
}

export default function App() {
  const { activeMenu, setActiveMenu, chatOpen, setChatOpen, sidebarCollapsed, setSidebarCollapsed } = useStore()

  useEffect(() => {
    const onHashChange = () => {
      const menu = location.hash.slice(1)
      if (menu && menu !== activeMenu) {
        setActiveMenu(menu)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [activeMenu, setActiveMenu])

  const Page = pages[activeMenu] || Dashboard

  // PDF 预览页：全屏渲染，不显示侧边栏和聊天面板
  if (activeMenu.startsWith('pdf-viewer/')) {
    return <PdfViewerPage />
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* 侧边栏 */}
      <aside className={`bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-60'}`}>
        {/* 品牌区 */}
        <div className={`border-b border-slate-200 flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-6'} py-5`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
            <Car className="w-5 h-5 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-base font-bold text-slate-800">车辆管家</h1>
              <p className="text-xs text-slate-500">CarCare</p>
            </div>
          )}
        </div>

        {/* 菜单区 */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = activeMenu === item.key
            return (
              <button
                key={item.key}
                onClick={() => setActiveMenu(item.key)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>

        {/* 底部：状态 + 折叠按钮 */}
        <div className="p-2 border-t border-slate-200 space-y-1">
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2 px-2'} py-2 text-xs text-slate-500`}>
            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            {!sidebarCollapsed && <span>系统运行正常</span>}
          </div>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2 px-2'} py-2 rounded-lg text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors`}
          >
            {sidebarCollapsed
              ? <PanelLeft className="w-4 h-4" />
              : <><PanelLeftClose className="w-4 h-4" /><span>收起菜单</span></>
            }
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto min-w-0">
        <Page />
      </main>

      {/* 右侧聊天面板 */}
      {chatOpen ? (
        <ChatPanel />
      ) : (
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
