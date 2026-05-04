import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Pencil, Trash2, Wrench, Search, Download } from 'lucide-react'
import {
  getItemTemplates,
  createItemTemplate,
  updateItemTemplate,
  deleteItemTemplate,
  importFromRecords,
  type ItemTemplate,
} from '../api/client'

const CATEGORY_OPTIONS = [
  '机油', '滤芯', '制动', '电气', '轮胎', '传动', '冷却', '底盘', '发动机', '点火', '常规', '其他',
]

const CATEGORY_COLORS: Record<string, string> = {
  '机油': 'bg-amber-50 text-amber-700 border-amber-200',
  '滤芯': 'bg-green-50 text-green-700 border-green-200',
  '制动': 'bg-red-50 text-red-700 border-red-200',
  '电气': 'bg-purple-50 text-purple-700 border-purple-200',
  '轮胎': 'bg-slate-100 text-slate-700 border-slate-300',
  '传动': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  '冷却': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  '底盘': 'bg-orange-50 text-orange-700 border-orange-200',
  '发动机': 'bg-rose-50 text-rose-700 border-rose-200',
  '点火': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  '常规': 'bg-blue-50 text-blue-700 border-blue-200',
  '其他': 'bg-gray-100 text-gray-600 border-gray-300',
}

const OPERATION_OPTIONS = ['更换', '添加', '检查', '清洗', '调整', '其他']

function TemplateModal({
  template,
  onClose,
}: {
  template: ItemTemplate | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = template !== null

  const [form, setForm] = useState({
    name: template?.name || '',
    parts_number: template?.parts_number || '',
    operation_type: template?.operation_type || '',
    reference_unit_price: template?.reference_unit_price?.toString() || '',
    reference_parts_cost: template?.reference_parts_cost?.toString() || '',
    reference_labor_cost: template?.reference_labor_cost?.toString() || '',
    category: template?.category || '常规',
    notes: template?.notes || '',
  })

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        parts_number: form.parts_number.trim(),
        operation_type: form.operation_type,
        reference_unit_price: parseFloat(form.reference_unit_price) || 0,
        reference_parts_cost: parseFloat(form.reference_parts_cost) || 0,
        reference_labor_cost: parseFloat(form.reference_labor_cost) || 0,
        category: form.category,
        notes: form.notes.trim(),
      }
      return isEdit
        ? updateItemTemplate(template!.id, payload)
        : createItemTemplate(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['item-templates'] })
      onClose()
    },
  })

  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[95vw] max-w-lg min-w-[400px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-t-xl">
          <h3 className="text-base font-semibold text-white">{isEdit ? '编辑项目模板' : '添加项目模板'}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">项目名称 *</label>
            <input type="text" value={form.name} onChange={(e) => upd('name', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">分类</label>
              <select value={form.category} onChange={(e) => upd('category', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400">
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">默认操作</label>
              <select value={form.operation_type} onChange={(e) => upd('operation_type', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400">
                <option value="">无</option>
                {OPERATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">零部件号</label>
            <input type="text" value={form.parts_number} onChange={(e) => upd('parts_number', e.target.value)} placeholder="可选"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
          </div>

          <div className="bg-emerald-50/60 rounded-lg p-4 border border-emerald-100">
            <label className="text-xs font-medium text-emerald-700 mb-2 block">参考价格</label>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">参考单价</label>
                <input type="number" step="0.01" value={form.reference_unit_price} onChange={(e) => upd('reference_unit_price', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">参考配件费</label>
                <input type="number" step="0.01" value={form.reference_parts_cost} onChange={(e) => upd('reference_parts_cost', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">参考工费</label>
                <input type="number" step="0.01" value={form.reference_labor_cost} onChange={(e) => upd('reference_labor_cost', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">备注</label>
            <textarea value={form.notes} onChange={(e) => upd('notes', e.target.value)} rows={2} placeholder="可选"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 resize-none" />
          </div>
        </div>

        <div className="shrink-0 flex gap-3 justify-end px-6 py-4 border-t border-slate-100 bg-slate-50/80 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-white">取消</button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim()}
            className="px-6 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 shadow-sm">
            {saveMut.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DictionaryPage() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<ItemTemplate | null | 'add'>(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; skipped: number; names: string[]; updated_names: string[] } | null>(null)

  const { data: templates } = useQuery({
    queryKey: ['item-templates', filterCategory, search],
    queryFn: () => getItemTemplates({ category: filterCategory || undefined, search: search || undefined }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteItemTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-templates'] }),
  })

  const importMut = useMutation({
    mutationFn: importFromRecords,
    onSuccess: (data) => {
      setImportResult(data)
      qc.invalidateQueries({ queryKey: ['item-templates'] })
    },
  })

  const items = templates || []

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">项目字典</h2>
          <p className="text-sm text-slate-500 mt-1">管理保养项目模板，录入时可快速选择</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => importMut.mutate()} disabled={importMut.isPending}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50">
            <Download className="w-4 h-4" /> {importMut.isPending ? '导入中...' : '从记录导入'}
          </button>
          <button onClick={() => setModal('add')}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 shadow-sm">
            <Plus className="w-4 h-4" /> 添加模板
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="搜索项目名称..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400">
          <option value="">全部分类</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-slate-400 ml-auto">共 {items.length} 项</span>
      </div>

      {importResult && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Download className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-blue-800 font-medium">
              导入完成：新增 {importResult.imported} 项，补充 {importResult.updated || 0} 项，跳过 {importResult.skipped} 项
            </p>
            {importResult.names.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-slate-500 mb-1">新增项目：</p>
                <div className="flex flex-wrap gap-1.5">
                  {importResult.names.map((n) => (
                    <span key={n} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs">{n}</span>
                  ))}
                </div>
              </div>
            )}
            {(importResult.updated_names || []).length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-slate-500 mb-1">补充字段：</p>
                <div className="flex flex-wrap gap-1.5">
                  {importResult.updated_names!.map((n) => (
                    <span key={n} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{n}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setImportResult(null)} className="text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="whitespace-nowrap">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">项目名称</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">零部件号</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 w-16">操作</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 w-20">参考单价</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 w-20">参考配件费</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 w-20">参考工费</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 w-20">分类</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-800 font-medium">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {t.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{t.parts_number || '-'}</td>
                <td className="px-4 py-3 text-center whitespace-nowrap">
                  {t.operation_type
                    ? <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{t.operation_type}</span>
                    : <span className="text-slate-300">-</span>}
                </td>
                <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{t.reference_unit_price ? `¥${t.reference_unit_price}` : '-'}</td>
                <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{t.reference_parts_cost ? `¥${t.reference_parts_cost}` : '-'}</td>
                <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{t.reference_labor_cost ? `¥${t.reference_labor_cost}` : '-'}</td>
                <td className="px-4 py-3 text-center whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs border ${CATEGORY_COLORS[t.category] || CATEGORY_COLORS['其他']}`}>{t.category}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setModal(t)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 hover:border-emerald-300 hover:text-emerald-600">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteMut.mutate(t.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="text-center text-slate-400 py-12 text-sm">暂无模板，点击「添加模板」开始</p>
        )}
      </div>

      {modal !== null && (
        <TemplateModal
          template={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
