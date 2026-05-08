import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Plus, X, Trash2, Pencil, FileText, ArrowUpDown, ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { getRecords, createRecord, updateRecord, deleteRecord, getItemTemplates, type MaintenanceRecord, type ItemTemplate, type PaginatedRecords } from '../api/client'
import { useStore } from '../hooks/useStore'

/** 保养记录弹窗（新增 / 编辑复用） */
function RecordModal({
  record,
  vehicleId,
  onClose,
}: {
  record: MaintenanceRecord | null  // null = 新增模式
  vehicleId: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = record !== null

  const [form, setForm] = useState({
    date: record?.date || new Date().toISOString().slice(0, 10),
    mileage: record?.mileage?.toString() || '',
    next_mileage: record?.next_mileage?.toString() || '',
    next_date: record?.next_date || '',
    type: record?.type || '保养',
    station: record?.station || '',
    total_amount: record?.total_amount?.toString() || '',
    discount: record?.discount?.toString() || '',
    paid_amount: record?.paid_amount?.toString() || '',
    notes: record?.notes || '',
  })
  const [items, setItems] = useState<{ name: string; parts_number: string; operation_type: string; quantity: string; unit_price: string; parts_cost: string; labor_cost: string; other_cost: string }[]>(
    record?.items?.length
      ? record.items.map((it) => ({
          name: it.name,
          parts_number: it.parts_number || '',
          operation_type: it.operation_type || '',
          quantity: it.quantity.toString(),
          unit_price: it.unit_price.toString(),
          parts_cost: it.parts_cost?.toString() || '',
          labor_cost: it.labor_cost?.toString() || '',
          other_cost: it.other_cost?.toString() || '',
        }))
      : [{ name: '', parts_number: '', operation_type: '', quantity: '1', unit_price: '', parts_cost: '', labor_cost: '', other_cost: '' }]
  )

  // 模板自动完成
  const [activeSuggest, setActiveSuggest] = useState<number | null>(null)
  const [templateQuery, setTemplateQuery] = useState('')
  const suggestRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const { data: suggestions } = useQuery({
    queryKey: ['item-templates', 'search', templateQuery],
    queryFn: () => getItemTemplates({ search: templateQuery }),
    enabled: templateQuery.length >= 1,
  })

  const applyTemplate = (idx: number, t: ItemTemplate) => {
    updateItem(idx, 'name', t.name)
    if (t.parts_number) updateItem(idx, 'parts_number', t.parts_number)
    if (t.operation_type) updateItem(idx, 'operation_type', t.operation_type)
    if (t.reference_unit_price) updateItem(idx, 'unit_price', t.reference_unit_price.toString())
    if (t.reference_parts_cost) updateItem(idx, 'parts_cost', t.reference_parts_cost.toString())
    if (t.reference_labor_cost) updateItem(idx, 'labor_cost', t.reference_labor_cost.toString())
    setActiveSuggest(null)
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const total = parseFloat(form.total_amount) || 0
      const discount = parseFloat(form.discount) || 0
      const paid = form.paid_amount ? parseFloat(form.paid_amount) : total - discount
      const payload = {
        vehicle_id: vehicleId,
        date: form.date,
        mileage: form.mileage ? parseInt(form.mileage) : null,
        next_mileage: form.next_mileage ? parseInt(form.next_mileage) : null,
        next_date: form.next_date || null,
        type: form.type || null,
        station: form.station || null,
        total_amount: total,
        discount,
        paid_amount: paid,
        notes: form.notes || null,
        ocr_raw: '',
        items: items
          .filter((it) => it.name.trim())
          .map((it) => {
            const partsCost = parseFloat(it.parts_cost) || 0
            const laborCost = parseFloat(it.labor_cost) || 0
            const otherCost = parseFloat(it.other_cost) || 0
            return {
              name: it.name.trim(),
              parts_number: it.parts_number.trim(),
              operation_type: it.operation_type.trim(),
              quantity: parseFloat(it.quantity) || 1,
              unit_price: parseFloat(it.unit_price) || 0,
              parts_cost: partsCost,
              labor_cost: laborCost,
              other_cost: otherCost,
              subtotal: partsCost + laborCost + otherCost,
            }
          }),
      }
      return isEdit
        ? updateRecord(record!.id, payload)
        : createRecord(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['records'] })
      onClose()
    },
  })

  const updateField = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const updateItem = (idx: number, key: string, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))
  }
  const emptyItem = () => ({ name: '', parts_number: '', operation_type: '', quantity: '1', unit_price: '', parts_cost: '', labor_cost: '', other_cost: '' })
  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const insertItem = (idx: number) => setItems((prev) => [...prev.slice(0, idx + 1), emptyItem(), ...prev.slice(idx + 1)])
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[95vw] max-w-3xl min-w-[480px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 固定头部 */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-500 rounded-t-xl">
          <h3 className="text-base font-semibold text-white">{isEdit ? '编辑保养记录' : '手动添加保养记录'}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 基本信息 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">日期 *</label>
              <input type="date" value={form.date} onChange={(e) => updateField('date', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">里程 (km)</label>
              <input type="number" placeholder="如 50000" value={form.mileage} onChange={(e) => updateField('mileage', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">保养类型</label>
              <select value={form.type} onChange={(e) => updateField('type', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow">
                <option value="保养">保养</option>
                <option value="维修">维修</option>
                <option value="年检">年检</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">服务店</label>
              <input type="text" placeholder="如 XX 4S店" value={form.station} onChange={(e) => updateField('station', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
            </div>
          </div>

          {/* 下次保养计划 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">下次预计保养里程 (km)</label>
              <input type="number" placeholder="如 55000" value={form.next_mileage} onChange={(e) => updateField('next_mileage', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">下次预计保养日期</label>
              <input type="date" value={form.next_date} onChange={(e) => updateField('next_date', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
            </div>
          </div>

          {/* 费用区域 */}
          <div className="bg-amber-50/60 rounded-lg p-4 border border-amber-100">
            <label className="text-xs font-medium text-amber-700 mb-2 block">费用信息</label>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">原价</label>
                <input type="number" step="0.01" placeholder="0.00" value={form.total_amount} onChange={(e) => updateField('total_amount', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-shadow" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">优惠</label>
                <input type="number" step="0.01" placeholder="0.00" value={form.discount} onChange={(e) => updateField('discount', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-shadow" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">实付</label>
                <input type="number" step="0.01" placeholder="自动计算" value={form.paid_amount} onChange={(e) => updateField('paid_amount', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-shadow" />
              </div>
            </div>
          </div>

          {/* 保养项目 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-600">保养项目</label>
              <button onClick={addItem} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
                <Plus className="w-3 h-3" /> 添加项目
              </button>
            </div>
            <div className="space-y-3">
              {items.map((item, idx) => {
                const pc = parseFloat(item.parts_cost) || 0
                const lc = parseFloat(item.labor_cost) || 0
                const oc = parseFloat(item.other_cost) || 0
                const borderColor = idx % 3 === 0 ? 'border-l-blue-500' : idx % 3 === 1 ? 'border-l-emerald-500' : 'border-l-amber-500'
                return (
                  <div key={idx} className={`border border-slate-200 border-l-4 ${borderColor} rounded-lg p-3 space-y-2 relative bg-white`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input type="text" placeholder="项目名称 *" value={item.name}
                          onChange={(e) => { updateItem(idx, 'name', e.target.value); setTemplateQuery(e.target.value); setActiveSuggest(idx) }}
                          onFocus={() => { setTemplateQuery(item.name); setActiveSuggest(idx) }}
                          onBlur={() => setTimeout(() => setActiveSuggest(null), 150)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
                        {activeSuggest === idx && suggestions && suggestions.length > 0 && (
                          <div className="absolute z-[60] top-full left-0 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-auto mt-1">
                            {suggestions.map((t) => (
                              <button key={t.id} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center justify-between"
                                onMouseDown={() => applyTemplate(idx, t)}>
                                <span className="text-slate-700">{t.name}</span>
                                <span className="text-xs text-slate-400">{t.category}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                      )}
                      <button onClick={() => insertItem(idx)} className="text-slate-400 hover:text-blue-500 transition-colors" title="在下方插入项目"><Plus className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="text" placeholder="零部件号" value={item.parts_number} onChange={(e) => updateItem(idx, 'parts_number', e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
                      <select value={item.operation_type} onChange={(e) => updateItem(idx, 'operation_type', e.target.value)}
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow">
                        <option value="">操作</option>
                        <option value="更换">更换</option>
                        <option value="添加">添加</option>
                        <option value="检查">检查</option>
                        <option value="清洗">清洗</option>
                        <option value="调整">调整</option>
                        <option value="其他">其他</option>
                      </select>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-slate-500 shrink-0">数量</label>
                        <input type="number" placeholder="1" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                          className="flex-1 min-w-[56px] px-2 py-1 rounded border border-slate-200 bg-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
                        <label className="text-slate-500 shrink-0">单价</label>
                        <input type="number" step="0.01" placeholder="0" value={item.unit_price} onChange={(e) => updateItem(idx, 'unit_price', e.target.value)}
                          className="flex-1 min-w-[72px] px-2 py-1 rounded border border-slate-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
                        <div className="w-px h-4 bg-slate-300" />
                        <label className="text-blue-600 shrink-0 font-medium">配件费</label>
                        <input type="number" step="0.01" placeholder="0" value={item.parts_cost} onChange={(e) => updateItem(idx, 'parts_cost', e.target.value)}
                          className="flex-1 min-w-[72px] px-2 py-1 rounded border border-blue-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow" />
                        <label className="text-emerald-600 shrink-0 font-medium">工费</label>
                        <input type="number" step="0.01" placeholder="0" value={item.labor_cost} onChange={(e) => updateItem(idx, 'labor_cost', e.target.value)}
                          className="flex-1 min-w-[72px] px-2 py-1 rounded border border-emerald-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 transition-shadow" />
                        <label className="text-amber-600 shrink-0 font-medium">其它</label>
                        <input type="number" step="0.01" placeholder="0" value={item.other_cost} onChange={(e) => updateItem(idx, 'other_cost', e.target.value)}
                          className="flex-1 min-w-[72px] px-2 py-1 rounded border border-amber-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-shadow" />
                        <span className="text-slate-600 ml-auto shrink-0 font-medium">小计 ¥{(pc + lc + oc).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">备注</label>
            <textarea placeholder="可选" value={form.notes} onChange={(e) => updateField('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-shadow resize-none" />
          </div>
        </div>

        {/* 固定底部 */}
        <div className="shrink-0 flex gap-3 justify-end px-6 py-4 border-t border-slate-100 bg-slate-50/80 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-white transition-colors">取消</button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">
            {saveMut.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 保养项目详情弹窗 */
function ItemsDetailModal({
  record,
  onClose,
}: {
  record: MaintenanceRecord
  onClose: () => void
}) {
  const totalParts = record.items.reduce((s, it) => s + it.parts_cost, 0)
  const totalLabor = record.items.reduce((s, it) => s + it.labor_cost, 0)
  const totalOther = record.items.reduce((s, it) => s + it.other_cost, 0)
  const totalSub = record.items.reduce((s, it) => s + it.subtotal, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[95vw] max-w-4xl min-w-[640px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-700 to-slate-600 rounded-t-xl">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-white/80" />
            <h3 className="text-base font-semibold text-white">
              {record.date} · {record.type || '保养'}
              {record.station && <span className="text-white/60 font-normal ml-2">{record.station}</span>}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* 表格 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                <th className="px-4 py-2.5 text-left">项目名称</th>
                <th className="px-4 py-2.5 text-left w-28">零部件号</th>
                <th className="px-4 py-2.5 text-center w-16">操作</th>
                <th className="px-4 py-2.5 text-center w-14">数量</th>
                <th className="px-4 py-2.5 text-right w-20">单价</th>
                <th className="px-4 py-2.5 text-right text-blue-600 w-20">配件费</th>
                <th className="px-4 py-2.5 text-right text-emerald-600 w-20">工费</th>
                <th className="px-4 py-2.5 text-right text-amber-600 w-20">其它</th>
                <th className="px-4 py-2.5 text-right w-20">费用</th>
              </tr>
            </thead>
            <tbody>
              {record.items.map((it, i) => (
                <tr key={it.id || i} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                  <td className="px-4 py-2.5 text-slate-800 font-medium">{it.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap overflow-hidden" title={it.parts_number || undefined}>{it.parts_number || '-'}</td>
                  <td className="px-4 py-2.5 text-center whitespace-nowrap">
                    {it.operation_type
                      ? <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{it.operation_type}</span>
                      : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center text-slate-600 whitespace-nowrap">{it.quantity}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">{it.unit_price ? `¥${it.unit_price}` : '-'}</td>
                  <td className="px-4 py-2.5 text-right text-blue-600 whitespace-nowrap">{it.parts_cost ? `¥${it.parts_cost}` : '-'}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600 whitespace-nowrap">{it.labor_cost ? `¥${it.labor_cost}` : '-'}</td>
                  <td className="px-4 py-2.5 text-right text-amber-600 whitespace-nowrap">{it.other_cost ? `¥${it.other_cost}` : '-'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-800 font-semibold whitespace-nowrap">¥{it.subtotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 底部汇总 */}
        <div className="shrink-0 grid grid-cols-5 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">配件费合计</div>
            <div className="text-sm text-blue-600 font-semibold">¥{totalParts.toFixed(2)}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">工费合计</div>
            <div className="text-sm text-emerald-600 font-semibold">¥{totalLabor.toFixed(2)}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">其它合计</div>
            <div className="text-sm text-amber-600 font-semibold">¥{totalOther.toFixed(2)}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">项目总计</div>
            <div className="text-sm text-slate-800 font-semibold">¥{totalSub.toFixed(2)}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] text-slate-400 uppercase">实付金额</div>
            <div className="text-base text-blue-700 font-bold">¥{record.paid_amount.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RecordsList() {
  const navigate = useNavigate()
  const { currentVehicleId } = useStore()
  const [modalRecord, setModalRecord] = useState<MaintenanceRecord | null | 'add'>(null)
  const [detailRecord, setDetailRecord] = useState<MaintenanceRecord | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const qc = useQueryClient()

  const { data: paginated, isLoading } = useQuery({
    queryKey: ['records', currentVehicleId, sortOrder, page, pageSize],
    queryFn: () => getRecords({ vehicleId: currentVehicleId || undefined, sortOrder, page, pageSize }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteRecord,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records'] }),
  })

  const recs: MaintenanceRecord[] = paginated?.items || []
  const totalRecords = paginated?.total || 0
  const totalPage = Math.ceil(totalRecords / pageSize)
  const totalAmount = recs.reduce((s, r) => s + r.paid_amount, 0)

  const closeModal = () => setModalRecord(null)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">保养记录</h2>
          <p className="text-sm text-slate-500 mt-1">共 {totalRecords} 条记录 · 累计花费 ¥{totalAmount.toLocaleString()}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setModalRecord('add')}
            className="flex items-center gap-2 px-4 py-2 border border-blue-600 text-blue-600 rounded-lg text-sm hover:bg-blue-50"
          >
            <Plus className="w-4 h-4" /> 手动添加
          </button>
          <button
            onClick={() => navigate('/upload')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            <Upload className="w-4 h-4" /> 上传新单据
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-center text-slate-400 py-12">加载中...</p>
      ) : (
        <>
        <div className="bg-white rounded-xl border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">
                  <button
                    onClick={() => setSortOrder(s => s === 'desc' ? 'asc' : 'desc')}
                    className="inline-flex items-center gap-1 hover:text-slate-700 transition-colors"
                    title={sortOrder === 'desc' ? '最新在前，点击切换' : '最早在前，点击切换'}
                  >
                    日期
                    {sortOrder === 'desc'
                      ? <ArrowDown className="w-3 h-3" />
                      : <ArrowUp className="w-3 h-3" />
                    }
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">里程</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">下次保养</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">保养类型</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">项目数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">服务店</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">金额</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">{r.date}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{r.mileage?.toLocaleString() || '-'} km</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {r.next_mileage || r.next_date ? (
                      <div className="flex flex-col gap-0.5">
                        {r.next_mileage && <span className="text-slate-600">{r.next_mileage.toLocaleString()} km</span>}
                        {r.next_date && <span className="text-xs text-slate-400">{r.next_date}</span>}
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{r.type || '保养'}</td>
                  <td className="px-4 py-3 text-sm">
                    <button onClick={() => setDetailRecord(r)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline transition-colors">
                      <FileText className="w-3.5 h-3.5" />
                      {r.items?.length || 0} 项
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{r.station || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right font-semibold">¥{r.paid_amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setModalRecord(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-colors">
                        <Pencil className="w-3 h-3" /> 编辑
                      </button>
                      {deletingId === r.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600">确认？</span>
                          <button onClick={() => { deleteMut.mutate(r.id); setDeletingId(null) }}
                            className="px-2 py-1 text-xs text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors">
                            删除
                          </button>
                          <button onClick={() => setDeletingId(null)}
                            className="px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
                            取消
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingId(r.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors">
                          <Trash2 className="w-3 h-3" /> 删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recs.length === 0 && (
            <p className="text-center text-slate-400 py-12 text-sm">暂无保养记录</p>
          )}
        </div>

        {/* 分页控件 */}
        {totalRecords > 0 && (
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">每页</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                className="px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400"
              >
                <option value={10}>10 条</option>
                <option value={25}>25 条</option>
                <option value={50}>50 条</option>
              </select>
              <span className="text-xs text-slate-500">共 {totalRecords} 条</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-0.5"
              >
                <ChevronLeft className="w-3 h-3" /> 上一页
              </button>
              <span className="text-xs text-slate-500 px-2">{page} / {totalPage || 1}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPage || 1, p + 1))}
                disabled={page >= totalPage}
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-0.5"
              >
                下一页 <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {modalRecord !== null && (
        <RecordModal
          record={modalRecord === 'add' ? null : modalRecord}
          vehicleId={currentVehicleId || 1}
          onClose={closeModal}
        />
      )}
      {detailRecord && (
        <ItemsDetailModal
          record={detailRecord}
          onClose={() => setDetailRecord(null)}
        />
      )}
    </div>
  )
}
