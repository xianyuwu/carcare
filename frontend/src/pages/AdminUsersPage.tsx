import { useState, useEffect } from 'react'
import { UserPlus, Trash2, Edit2, Check, X, Shield, User } from 'lucide-react'
import { getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser, AdminUser } from '../api/client'

// embedded 模式：嵌入设置页时去掉外层 padding 和页面标题
export default function AdminUsersPage({ embedded }: { embedded?: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)

  // Add form state
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newNickname, setNewNickname] = useState('')
  const [newRole, setNewRole] = useState('member')

  // Edit form state
  const [editNickname, setEditNickname] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editActive, setEditActive] = useState(true)

  const fetchUsers = async () => {
    try {
      const resp = await getAdminUsers()
      setUsers(resp.users)
      setError('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleAdd = async () => {
    if (!newEmail || !newPassword) return
    try {
      await createAdminUser({
        email: newEmail,
        password: newPassword,
        nickname: newNickname,
        role: newRole,
      })
      setShowAddForm(false)
      setNewEmail('')
      setNewPassword('')
      setNewNickname('')
      setNewRole('member')
      fetchUsers()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleEdit = async (id: number) => {
    try {
      await updateAdminUser(id, {
        nickname: editNickname || undefined,
        role: editRole || undefined,
        is_active: editActive,
      })
      setEditingId(null)
      setSavedId(id)
      setTimeout(() => setSavedId(null), 2000)
      fetchUsers()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteAdminUser(id)
      setDeletingId(null)
      fetchUsers()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const startEdit = (user: AdminUser) => {
    setEditingId(user.id)
    setEditNickname(user.nickname)
    setEditRole(user.role)
    setEditActive(user.is_active)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className={embedded ? '' : 'p-6'}>
      {/* Header（嵌入模式下简化） */}
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-800">用户管理</h1>
            <p className="text-sm text-slate-500 mt-1">共 {users.length} 个用户</p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            添加用户
          </button>
        </div>
      )}

      {/* 嵌入模式：紧凑标题 + 操作按钮 */}
      {embedded && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-600" />
            <h3 className="font-semibold text-slate-700 text-sm">用户管理</h3>
            <span className="text-xs text-slate-400 ml-1">共 {users.length} 个用户</span>
          </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          添加用户
        </button>
      </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <h3 className="font-medium text-slate-700 mb-4">添加新用户</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">邮箱 *</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">密码 *</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">昵称</label>
              <input
                type="text"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">角色</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none"
              >
                <option value="member">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              确定添加
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">邮箱</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">昵称</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">角色</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">状态</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">创建时间</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      user.role === 'admin' ? 'bg-purple-100' : 'bg-slate-100'
                    }`}>
                      {user.role === 'admin'
                        ? <Shield className="w-4 h-4 text-purple-600" />
                        : <User className="w-4 h-4 text-slate-600" />
                      }
                    </div>
                    <span className="text-sm text-slate-700">{user.email}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {editingId === user.id ? (
                    <input
                      type="text"
                      value={editNickname}
                      onChange={(e) => setEditNickname(e.target.value)}
                      className="px-2 py-1 border border-slate-200 rounded text-sm w-24"
                    />
                  ) : (
                    user.nickname || '-'
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId === user.id ? (
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="px-2 py-1 border border-slate-200 rounded text-sm"
                    >
                      <option value="member">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'admin'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId === user.id ? (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      启用
                    </label>
                  ) : (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {user.is_active ? '正常' : '禁用'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {new Date(user.created_at).toLocaleDateString('zh-CN')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {savedId === user.id ? (
                      <span className="text-xs text-green-600 font-medium">已保存</span>
                    ) : editingId === user.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleEdit(user.id)}
                          className="px-2.5 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 text-xs border border-slate-200 text-slate-500 rounded-md hover:bg-slate-50 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : deletingId === user.id ? (
                      <>
                        <span className="text-xs text-red-600">确认删除？</span>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="px-2 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700"
                        >
                          删除
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(user)}
                          className="p-1.5 text-slate-400 hover:bg-slate-100 rounded transition-colors"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingId(user.id)}
                          className="p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
