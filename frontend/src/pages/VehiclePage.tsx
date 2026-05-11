import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Camera, AlertTriangle } from 'lucide-react'
import { getVehicles, createVehicle, updateVehicle, deleteVehicle, uploadVehiclePhoto, checkVehicleDelete, type Vehicle } from '../api/client'
import { useStore } from '../hooks/useStore'
import { useState, useRef } from 'react'

const emptyForm = { brand: '', model: '', year: '', vin: '', license_plate: '' }

export default function VehiclePage() {
  const { currentVehicleId, setCurrentVehicleId } = useStore()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const photoRef = useRef<HTMLInputElement>(null)
  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null)
  const [deleteCheck, setDeleteCheck] = useState<{ record_count: number; manual_count: number } | null>(null)
  const [checkingDelete, setCheckingDelete] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        brand: form.brand,
        model: form.model,
        year: form.year ? parseInt(form.year) : undefined,
        vin: form.vin || undefined,
        license_plate: form.license_plate || undefined,
      }
      return editingId ? updateVehicle(editingId, payload) : createVehicle(payload)
    },
    onSuccess: (v: Vehicle) => {
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      if (!editingId) setCurrentVehicleId(v.id)
      closeForm()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteVehicle,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  const photoMut = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadVehiclePhoto(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  function openEdit(v: Vehicle) {
    setEditingId(v.id)
    setForm({
      brand: v.brand,
      model: v.model,
      year: v.year ? String(v.year) : '',
      vin: v.vin || '',
      license_plate: v.license_plate || '',
    })
    setShowForm(true)
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  function handlePhotoUpload(v: Vehicle) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) photoMut.mutate({ id: v.id, file })
    }
    input.click()
  }

  // 点击删除 → 先调预检查接口，再弹确认框
  async function handleDeleteClick(v: Vehicle) {
    setDeleteTarget(v)
    setDeleteCheck(null)
    setCheckingDelete(true)
    try {
      const check = await checkVehicleDelete(v.id)
      setDeleteCheck(check)
    } catch {
      setDeleteCheck({ record_count: 0, manual_count: 0 })
    }
    setCheckingDelete(false)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    deleteMut.mutate(deleteTarget.id)
    closeDeleteDialog()
  }

  function closeDeleteDialog() {
    setDeleteTarget(null)
    setDeleteCheck(null)
    setDeleteConfirmText('')
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">车辆档案</h2>
          <p className="text-sm text-slate-500 mt-1">管理你的车辆信息</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus className="w-4 h-4" /> 添加车辆
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">
            {editingId ? '编辑车辆' : '添加新车辆'}
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { key: 'brand', label: '品牌', placeholder: '如：广汽本田' },
              { key: 'model', label: '型号', placeholder: '如：缤智' },
              { key: 'year', label: '年份', placeholder: '如：2022' },
              { key: 'vin', label: 'VIN', placeholder: '车架号' },
              { key: 'license_plate', label: '车牌号', placeholder: '如：京A12345' },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs text-slate-500 mb-1 block">{f.label}</label>
                <input
                  value={(form as any)[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={closeForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">取消</button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={!form.brand || !form.model}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMut.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {(vehicles || []).map((v) => (
          <div
            key={v.id}
            onClick={() => setCurrentVehicleId(v.id)}
            className={`bg-white rounded-xl border p-5 cursor-pointer transition-colors ${
              currentVehicleId === v.id ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 hover:border-blue-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* 车辆照片缩略图 */}
                <div
                  onClick={(e) => { e.stopPropagation(); handlePhotoUpload(v) }}
                  className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:bg-slate-200 transition-colors group relative"
                  title="点击上传照片"
                >
                  {v.photo_url ? (
                    <img src={v.photo_url} alt={v.brand} className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-5 h-5 text-slate-400 group-hover:text-slate-500" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base font-semibold text-slate-800">{v.brand} {v.model}</span>
                    {v.year && <span className="text-xs text-slate-400">{v.year}款</span>}
                  </div>
                  <div className="flex gap-4 text-xs text-slate-500">
                    {v.license_plate && <span>{v.license_plate}</span>}
                    {v.vin && <span>VIN: {v.vin}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => { e.stopPropagation(); handlePhotoUpload(v) }}
                  className="text-slate-400 hover:text-purple-600 transition-colors"
                  title="上传照片"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(v) }}
                  className="text-slate-400 hover:text-blue-600 transition-colors"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteClick(v) }}
                  className="text-red-400 hover:text-red-600 transition-colors"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!vehicles?.length && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <p className="text-sm">暂无车辆，点击上方按钮添加</p>
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={closeDeleteDialog}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-slate-800">确认删除车辆</h4>
                <p className="text-sm text-slate-500">{deleteTarget.brand} {deleteTarget.model}</p>
              </div>
            </div>

            {checkingDelete ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                检查关联数据...
              </div>
            ) : deleteCheck && (deleteCheck.record_count > 0 || deleteCheck.manual_count > 0) ? (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-sm text-red-600 font-medium mb-2">以下数据将被永久删除：</p>
                <ul className="text-sm text-red-600 space-y-1">
                  {deleteCheck.record_count > 0 && (
                    <li>• {deleteCheck.record_count} 条保养记录（含所有项目明细）</li>
                  )}
                  {deleteCheck.manual_count > 0 && (
                    <li>• {deleteCheck.manual_count} 本保养手册（含向量索引）</li>
                  )}
                </ul>
                <p className="text-xs text-red-400 mt-2">此操作不可撤销</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mb-4">该车辆暂无保养记录和手册，删除后不可恢复。</p>
            )}

            {!checkingDelete && (
              <div className="mb-4">
                <p className="text-xs text-slate-500 mb-1.5">
                  请输入 <span className="font-medium text-slate-700">{deleteTarget.brand} {deleteTarget.model}</span> 确认删除
                </p>
                <input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={`${deleteTarget.brand} ${deleteTarget.model}`}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-red-400"
                  autoFocus
                />
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={closeDeleteDialog}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={checkingDelete || deleteConfirmText !== `${deleteTarget.brand} ${deleteTarget.model}`}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
