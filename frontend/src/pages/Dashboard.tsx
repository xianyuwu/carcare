import { useRef, useState, useEffect } from 'react'
import { FileText, DollarSign, Calendar, TrendingUp, Sparkles, RefreshCw, Wrench, MessageSquare } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { getVehicles, getRecords, getPrediction, generatePrediction, type Vehicle, type MaintenanceRecord } from '../api/client'
import { useStore } from '../hooks/useStore'

/** 测量容器宽度的 hook，替代 ResponsiveContainer 解决 recharts 在 flex/grid 中的测量问题 */
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b']

function computeMonthlyData(recs: MaintenanceRecord[]) {
  const map: Record<string, number> = {}
  for (const r of recs) {
    const ym = r.date?.slice(0, 7)
    if (!ym) continue
    map[ym] = (map[ym] || 0) + r.paid_amount
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }))
}

function computeItemData(recs: MaintenanceRecord[]) {
  const map: Record<string, number> = {}
  for (const r of recs) {
    if (r.items?.length) {
      for (const item of r.items) {
        if (!item.name) continue
        const cost = (item.parts_cost || 0) + (item.labor_cost || 0) + (item.other_cost || 0) || item.subtotal || 0
        map[item.name] = (map[item.name] || 0) + cost
      }
    } else {
      const label = r.type || '保养'
      map[label] = (map[label] || 0) + r.paid_amount
    }
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
}

function SpendingTrendChart({ recs }: { recs: MaintenanceRecord[] }) {
  const { ref, width } = useChartWidth()
  const data = computeMonthlyData(recs)
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-blue-600" />
        </div>
        <span className="text-sm font-medium text-slate-700">保养花费趋势</span>
      </div>
      <div ref={ref} className="w-full" style={{ height: 220 }}>
        <BarChart width={width || 600} height={220} data={data}>
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `¥${v}`} />
          <Tooltip
            formatter={(value: any) => [`¥${Number(value).toLocaleString()}`, '花费']}
            labelFormatter={(label: any) => `${label}`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Bar dataKey="amount" fill="#6366f1" isAnimationActive={false} />
        </BarChart>
      </div>
    </div>
  )
}

function SpendingPieChart({ recs }: { recs: MaintenanceRecord[] }) {
  const { ref, width } = useChartWidth()
  const itemData = computeItemData(recs)
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
          <DollarSign className="w-4 h-4 text-purple-600" />
        </div>
        <span className="text-sm font-medium text-slate-700">保养项目花费分布</span>
      </div>
      {itemData.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">暂无保养项目数据</p>
      ) : (
        <div className="flex items-center gap-4">
          <div ref={ref} className="w-1/2" style={{ height: 220 }}>
            <PieChart width={width || 220} height={220}>
              <Pie data={itemData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                {itemData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: any, name: any) => [`¥${Number(value).toLocaleString()}`, name || '']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
            </PieChart>
          </div>
          <div className="flex-1 space-y-2">
            {itemData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="text-xs text-slate-600 flex-1 truncate">{d.name}</span>
                <span className="text-xs font-medium text-slate-700">¥{d.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const queryClient = useQueryClient()
  const { setChatOpen, setPendingQuestion } = useStore()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const { data: paginated } = useQuery({ queryKey: ['records'], queryFn: () => getRecords({ pageSize: 100 }) })

  const vehicle: Vehicle | undefined = vehicles?.[0]
  const recs: MaintenanceRecord[] = paginated?.items || []
  const totalCount = recs.length
  const totalAmount = recs.reduce((s, r) => s + r.paid_amount, 0)

  const nextInfo = recs.find(r => r.next_mileage || r.next_date)

  // AI 预测（读缓存）
  const { data: prediction, isLoading: predLoading } = useQuery({
    queryKey: ['prediction', vehicle?.id],
    queryFn: () => getPrediction(vehicle!.id),
    enabled: !!vehicle?.id,
  })

  // 重新生成
  const generateMut = useMutation({
    mutationFn: () => generatePrediction(vehicle!.id),
    onSuccess: (data) => {
      queryClient.setQueryData(['prediction', vehicle?.id], data)
    },
  })

  const isGenerating = generateMut.isPending

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">仪表盘</h2>
          <p className="text-sm text-slate-500 mt-1">欢迎回来，这里是你的爱车总览</p>
        </div>
      </div>

      {/* 车辆信息卡 */}
      {vehicle && (
        <div
          className="rounded-2xl p-6 mb-6 text-white relative overflow-hidden bg-gradient-to-r from-slate-800 to-slate-900"
          style={vehicle.photo_url ? {
            backgroundImage: `url(${vehicle.photo_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : undefined}
        >
          {/* 渐变遮罩：有照片时加深遮罩保证文字可读 */}
          <div className={`absolute inset-0 ${
            vehicle.photo_url
              ? 'bg-gradient-to-t from-black/80 via-black/50 to-black/30'
              : ''
          }`} />
          {!vehicle.photo_url && (
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 opacity-10 rounded-full -mr-20 -mt-20" />
          )}
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded">{vehicle.brand}</span>
                <span className="text-xs px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded">{vehicle.model}</span>
              </div>
              <h3 className="text-2xl font-bold mb-1">
                {vehicle.license_plate || '未上牌'} · {vehicle.model}
              </h3>
              <p className="text-sm text-slate-300">VIN: {vehicle.vin || '-'}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end mb-1">
                <Calendar className="w-4 h-4 text-slate-300" />
                <span className="text-xs text-slate-300">下次保养</span>
              </div>
              <p className="text-3xl font-bold">
                {nextInfo?.next_mileage
                  ? nextInfo.next_mileage.toLocaleString()
                  : nextInfo?.next_date || '-'}
                <span className="text-base text-slate-300 ml-1">
                  {nextInfo?.next_mileage ? 'km' : ''}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard icon={FileText} label="保养记录" value={String(totalCount)} unit="次" color="blue" />
        <StatCard icon={DollarSign} label="累计花费" value={totalAmount.toLocaleString()} unit="元" color="emerald" />
        <StatCard icon={TrendingUp} label="平均花费" value={totalCount > 0 ? Math.round(totalAmount / totalCount).toLocaleString() : '-'} unit="元/次" color="purple" />
      </div>

      {/* AI 预测模块 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <h3 className="text-base font-semibold text-slate-800">AI 保养预测</h3>
          </div>
          <div className="flex items-center gap-3">
            {prediction?.generated_at && (
              <span className="text-xs text-slate-400">
                生成于 {new Date(prediction.generated_at).toLocaleString('zh-CN')}
              </span>
            )}
            <button
              onClick={() => generateMut.mutate()}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? '生成中...' : '重新生成'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* 预计保养项目 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Wrench className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-slate-700">预计下次需要保养项目</span>
            </div>
            {predLoading || isGenerating ? (
              <LoadingSpinner text="分析中..." color="blue" />
            ) : !prediction?.predicted_items?.length ? (
              <p className="text-sm text-slate-400 py-4">点击"重新生成"获取预测</p>
            ) : (
              <div className="space-y-2">
                {prediction.predicted_items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 hover:bg-blue-50 transition-colors">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-blue-600">{i + 1}</span>
                    </div>
                    <span className="text-sm text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 预计下次保养花费 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-slate-700">预计下次保养花费</span>
            </div>
            {predLoading || isGenerating ? (
              <LoadingSpinner text="估算中..." color="emerald" />
            ) : !prediction?.estimated_cost ? (
              <p className="text-sm text-slate-400 py-4">点击"重新生成"获取预测</p>
            ) : (
              <div>
                <p className="text-2xl font-bold text-emerald-600 mb-3">
                  ¥{prediction.estimated_cost.toLocaleString()}
                </p>
                {prediction.cost_breakdown?.length > 0 ? (
                  <div className="space-y-2">
                    {prediction.cost_breakdown.map((b, i) => (
                      <div key={i} className="flex items-start justify-between text-xs">
                        <div className="flex-1 min-w-0 mr-2">
                          <span className="text-slate-700">{b.item}</span>
                          {b.note && <span className="text-slate-400 ml-1">({b.note})</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${b.source === '历史均价' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                            {b.source}
                          </span>
                          <span className="font-medium text-slate-700 w-14 text-right">¥{b.cost}</span>
                        </div>
                      </div>
                    ))}
                    <div className="border-t border-slate-100 pt-2 flex justify-between text-xs font-medium">
                      <span className="text-slate-600">合计</span>
                      <span className="text-emerald-600">¥{prediction.estimated_cost.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">{prediction.cost_reasoning}</p>
                )}
              </div>
            )}
          </div>

          {/* AI 分析 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-purple-600" />
              </div>
              <span className="text-sm font-medium text-slate-700">AI 分析</span>
            </div>
            {predLoading || isGenerating ? (
              <LoadingSpinner text="分析中..." color="purple" />
            ) : !prediction?.reasoning_points?.length && !prediction?.reasoning ? (
              <p className="text-sm text-slate-400 py-4">点击"重新生成"获取预测</p>
            ) : (
              <>
                {prediction.reasoning_points?.length > 0 ? (
                  <div className="space-y-3">
                    {prediction.reasoning_points.map((p, i) => (
                      <div key={i} className="flex gap-2">
                        <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[10px] font-bold text-purple-600">{i + 1}</span>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-700">{p.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{p.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 leading-relaxed">{prediction.reasoning}</p>
                )}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => {
                      const items = prediction?.predicted_items?.join('、') || ''
                      const points = prediction?.reasoning_points?.map(p => `${p.title}：${p.detail}`).join('；') || prediction?.reasoning || ''
                      const question = `基于 AI 保养预测的继续分析：\n预测下次保养项目为【${items}】，AI 分析要点为：${points}。\n请针对以上分析，进一步给出更详细的保养建议。`
                      setPendingQuestion(question)
                      setChatOpen(true)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    追问 AI
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 统计图表 */}
      {recs.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* 花费趋势 */}
          <SpendingTrendChart recs={recs} />

          {/* 项目分布 */}
          <SpendingPieChart recs={recs} />
        </div>
      )}
    </div>
  )
}

function LoadingSpinner({ text, color }: { text: string; color: string }) {
  const borderColor = {
    blue: 'border-blue-400',
    emerald: 'border-emerald-400',
    purple: 'border-purple-400',
  }[color] || 'border-slate-400'
  return (
    <div className="flex items-center justify-center py-6">
      <div className={`animate-spin rounded-full h-5 w-5 border-2 ${borderColor} border-t-transparent`} />
      <span className="ml-2 text-sm text-slate-400">{text}</span>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, unit, color }: {
  icon: any; label: string; value: string; unit: string; color: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">
        {value}
        <span className="text-sm text-slate-400 font-normal ml-1">{unit}</span>
      </p>
    </div>
  )
}
