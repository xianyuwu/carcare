import { useState, useCallback, useRef, useEffect } from 'react'
import { Upload, FileText, CheckCircle2, MousePointer, ZoomIn, ZoomOut, Maximize2, Minimize2, Loader2, ImageIcon, Zap, BarChart2, Plus, X, Clock, AlertCircle, Eye, Check, Layers, RefreshCw } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { createRecord, getItemTemplates, matchItemTemplates, checkDuplicateRecord, type ItemTemplate, type OCRResult } from '../api/client'
import { useStore } from '../hooks/useStore'

/** OCR 处理进度组件：展示各阶段状态 + 计时 */
function OcrProgress({ file, onResult }: { file: File; onResult: (r: OCRResult) => void }) {
  // 阶段定义：顺序对应 step 0-3
  const STEPS = [
    { key: 'preprocess', label: '图片预处理', sub: 'EXIF校正 / 缩放 / 压缩', icon: ImageIcon },
    { key: 'sending',    label: '发送识别请求', sub: '编码图片并发送至多模态模型', icon: Zap },
    { key: 'parsing',   label: '解析响应', sub: 'JSON 解析与字段提取', icon: BarChart2 },
    { key: 'done',      label: '完成', sub: '结果已就绪', icon: CheckCircle2 },
  ]

  const [step, setStep] = useState(0)           // 当前进行到的阶段
  const [stepDone, setStepDone] = useState(false) // 当前阶段是否完成（用于显示勾号）
  const [elapsed, setElapsed] = useState(0)       // 总耗时（秒）
  const [stepStart, setStepStart] = useState(Date.now()) // 当前阶段开始时间
  const [allStepElapsed, setAllStepElapsed] = useState<number[]>([]) // 各阶段实际耗时
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 计时器：step >= 1 后每秒更新
  useEffect(() => {
    if (step >= 1) {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1)
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [step >= 1])

  // 阶段推进（递归 setTimeout，给用户看到逐步变化）
  useEffect(() => {
    if (step === 0) {
      // 预处理瞬间完成，快速推进
      const t = setTimeout(() => {
        setAllStepElapsed([Date.now() - stepStart])
        setStep(1)
        setStepStart(Date.now())
      }, 120)
      return () => clearTimeout(t)
    }
    if (step === 1) {
      // 等待 LLM 响应，推进到解析阶段
      const t = setTimeout(() => {
        setAllStepElapsed((prev) => [...prev, Date.now() - stepStart])
        setStep(2)
        setStepStart(Date.now())
        // 解析阶段也瞬间完成
        const t2 = setTimeout(() => {
          setAllStepElapsed((prev) => [...prev, Date.now() - stepStart])
          setStepDone(true)
          const t3 = setTimeout(() => setStep(3), 400)
          return () => clearTimeout(t3)
        }, 250)
        return () => clearTimeout(t2)
      }, 200)
      return () => clearTimeout(t)
    }
  }, [step])

  // 实际发起 OCR 请求
  useEffect(() => {
    const controller = new AbortController()
    const form = new FormData()
    form.append('file', file)

    fetch('/api/upload', { method: 'POST', body: form, signal: controller.signal })
      .then((r) => r.json())
      .then((data: OCRResult) => {
        // 请求返回时 step 应该已在 2（由上面的 setTimeout 推进）
        // 补录解析耗时
        setAllStepElapsed((prev) => {
          if (prev.length < 2) {
            const reqDone = Date.now() - stepStart
            return [...prev, reqDone]
          }
          return prev
        })
        onResult(data)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onResult({ raw_text: '', fields: {}, items: [], blocks: [], field_coords: {}, image_base64: '', error: err.message } as OCRResult)
        }
      })

    return () => controller.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (s: number) => {
    if (s < 1) return '<1s'
    return `${s}s`
  }

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    if (m > 0) return `${m}:${String(sec).padStart(2, '0')}`
    return `${sec}s`
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      {/* 顶部：文件名 + 计时器 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800 truncate max-w-xs">{file.name}</p>
            <p className="text-xs text-slate-400">{file.type || '文件'}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">总耗时</p>
          <p className="text-xl font-mono font-semibold text-slate-700 tabular-nums">
            {formatElapsed(elapsed)}
          </p>
        </div>
      </div>

      {/* 阶段列表 */}
      <div className="space-y-1">
        {STEPS.map((s, idx) => {
          const isActive  = idx === step
          const isDone    = idx < step || stepDone && idx === 2
          const isCurrent = idx === step && !stepDone
          const Icon = s.icon
          const stepElapsed = allStepElapsed[idx] ?? null

          return (
            <div key={s.key} className="flex items-start gap-3 px-3 py-3 rounded-lg transition-all">
              {/* 图标 + 连接线 */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  isDone  ? 'bg-emerald-100 text-emerald-600' :
                  isActive ? 'bg-blue-100 text-blue-600' :
                  'bg-slate-100 text-slate-400'
                }`}>
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`w-0.5 flex-1 my-0.5 min-h-[20px] transition-all ${
                    isDone ? 'bg-emerald-400' : 'bg-slate-200'
                  }`} />
                )}
              </div>

              {/* 文字 */}
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${
                    isDone  ? 'text-emerald-700' :
                    isActive ? 'text-blue-700' :
                    'text-slate-400'
                  }`}>
                    {s.label}
                  </span>
                  {stepElapsed != null && isDone && (
                    <span className="text-xs text-slate-400 tabular-nums">{fmt(Math.round(stepElapsed / 1000))}</span>
                  )}
                  {isActive && (
                    <span className="text-xs text-blue-500 animate-pulse">处理中...</span>
                  )}
                </div>
                <p className={`text-xs mt-0.5 ${isActive ? 'text-blue-400' : 'text-slate-400'}`}>
                  {s.sub}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 缩放工具栏 */
function ZoomToolbar({
  scale,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
}: {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onFitPage: () => void
}) {
  const pct = Math.round(scale * 100)
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
      <button onClick={onZoomOut} className="p-1 rounded hover:bg-slate-200 text-slate-600" title="缩小">
        <ZoomOut className="w-4 h-4" />
      </button>
      <span className="text-xs text-slate-600 w-10 text-center tabular-nums">{pct}%</span>
      <button onClick={onZoomIn} className="p-1 rounded hover:bg-slate-200 text-slate-600" title="放大">
        <ZoomIn className="w-4 h-4" />
      </button>
      <div className="w-px h-4 bg-slate-300 mx-1" />
      <button onClick={onFitWidth} className="p-1 rounded hover:bg-slate-200 text-slate-600" title="适应宽度">
        <Maximize2 className="w-4 h-4" />
      </button>
      <button onClick={onFitPage} className="p-1 rounded hover:bg-slate-200 text-slate-600" title="适应页面">
        <Minimize2 className="w-4 h-4" />
      </button>
    </div>
  )
}

/** 字段中文标签映射 */
const FIELD_LABELS: Record<string, string> = {
  date: '结算日期',
  mileage: '里程数',
  type: '修理类型',
  next_mileage: '下次保养里程',
  next_date: '下次保养日期',
  total_amount: '原价',
  paid_amount: '实付金额',
  discount: '优惠',
  station: '服务店',
  order_no: '修理号',
  work_items: '作业项目',
  parts: '零部件名称',
  other_fees: '其他费用',
}

/** 置信度信息（用于标注层） */
interface FieldConfMeta { label: string; color: string; conf: number; needsReview: boolean }

/** 图片标注覆盖层组件：SVG viewBox 精确坐标 + 置信度着色 */
function ImageAnnotation({
  imageBase64,
  fieldCoords,
  highlightedField,
  onFieldClick,
  scale,
  naturalSize,
  fieldConfMeta,
  items,
  items_bbox,
  showAll,
}: {
  imageBase64: string
  fieldCoords: OCRResult['field_coords']
  highlightedField: string | null
  onFieldClick: (field: string) => void
  scale: number
  naturalSize: { w: number; h: number }
  fieldConfMeta?: Record<string, FieldConfMeta>
  items?: OCRResult['items']
  items_bbox?: number[][]
  showAll?: boolean
}) {
  const [localNatural, setLocalNatural] = useState({ w: 0, h: 0 })
  const effectiveSize = naturalSize.w > 0 ? naturalSize : localNatural

  const displayW = effectiveSize.w * scale
  const displayH = effectiveSize.h * scale
  const vb = effectiveSize.w > 0 ? `0 0 ${effectiveSize.w} ${effectiveSize.h}` : undefined

  // 归一化 [x1,y1,x2,y2] → SVG 四角坐标
  const normToPoly = (b: number[], w: number, h: number) => {
    const [x1, y1, x2, y2] = b
    return [
      { X: x1 * w, Y: y1 * h },
      { X: x2 * w, Y: y1 * h },
      { X: x2 * w, Y: y2 * h },
      { X: x1 * w, Y: y2 * h },
    ]
  }

  // 响应式尺寸：根据图片像素自动缩放笔画/字体，任何分辨率下都清晰可见
  const sw = Math.max(effectiveSize.w * 0.003, 2)
  const fontSize = Math.max(effectiveSize.w * 0.007, 8)
  const labelH = fontSize * 1.7
  const labelPadX = fontSize * 0.35

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (naturalSize.w === 0) {
      setLocalNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
    }
  }

  const [hoveredField, setHoveredField] = useState<string | null>(null)

  // 字段高亮颜色：按置信度着色，hover 时统一蓝色
  const fieldColors = (field: string, isHovered: boolean) => {
    if (isHovered) return { fill: 'rgba(59,130,246,0.32)', stroke: '#2563EB' }
    const conf = fieldConfMeta?.[field]?.conf ?? -1
    if (conf < 0) return { fill: 'rgba(148,163,184,0.18)', stroke: '#94A3B8' }
    if (conf < 0.5) return { fill: 'rgba(239,68,68,0.25)', stroke: '#EF4444' }
    if (conf < 0.8) return { fill: 'rgba(245,158,11,0.22)', stroke: '#F59E0B' }
    return { fill: 'rgba(16,185,129,0.20)', stroke: '#10B981' }
  }

  // 标签定位：避免贴边遮挡
  const labelPos = (poly: { X: number; Y: number }[]) => {
    const side = poly[0].X < effectiveSize.w * 0.15 ? 'right' : 'left'
    const vAlign = poly[0].Y < effectiveSize.h * 0.06 ? 'below' : 'above'
    return { side, vAlign }
  }

  // 渲染单个高亮区域 + 标签
  // reactKey: React key（保证唯一），fieldKey: 交互用的字段标识（与右侧 ref 匹配）
  const renderHighlight = (
    reactKey: string,
    fieldKey: string,
    poly: { X: number; Y: number }[],
    label: string,
    isHovered: boolean,
    colors: { fill: string; stroke: string },
    showConfBar: boolean = false,
    confStroke?: string,
  ) => {
    const approxW = Math.max(label.length * fontSize * 0.65 + labelPadX * 2, fontSize * 4.5)
    const x1 = poly[0].X, x2 = poly[1].X
    const lblX = Math.max(0, x1 - 1)
    const lblY = Math.max(0, poly[0].Y - labelH - 1)

    return (
      <g key={reactKey} style={{ cursor: 'pointer' }}
        onClick={() => onFieldClick(fieldKey)}
        onMouseEnter={() => setHoveredField(fieldKey)}
        onMouseLeave={() => setHoveredField(null)}
      >
        <polygon
          points={poly.map((p) => `${p.X},${p.Y}`).join(' ')}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={isHovered ? sw * 1.6 : sw}
        />
        <rect x={lblX} y={lblY} width={approxW} height={labelH} rx={4}
          fill={isHovered ? '#2563EB' : 'rgba(255,255,255,0.95)'}
          stroke={isHovered ? '#2563EB' : colors.stroke}
          strokeWidth={isHovered ? 1.2 : 0.8}
        />
        <text x={lblX + labelPadX} y={lblY + labelH * 0.72}
          fontSize={fontSize}
          fontWeight={isHovered ? '700' : '600'}
          fill={isHovered ? 'white' : '#1E293B'}
        >
          {label.length > 14 ? label.slice(0, 14) + '…' : label}
        </text>
        {showConfBar && confStroke && (
          <rect
            x={Math.min(x2 + sw, effectiveSize.w - 4)}
            y={poly[0].Y}
            width={sw * 1.2}
            height={poly[3].Y - poly[0].Y}
            fill={confStroke}
            opacity={0.65}
            rx={1}
          />
        )}
      </g>
    )
  }

  // showAll 关闭时，只渲染当前高亮的字段/项目；开启时全部渲染
  const shouldShow = (fieldKey: string) => showAll !== false || highlightedField === fieldKey || hoveredField === fieldKey

  return (
    <div className="relative inline-block" style={{ width: displayW || undefined, height: displayH || undefined }}>
      <img
        src={`data:image/png;base64,${imageBase64.replace(/^data:image\/\w+;base64,/, '')}`}
        alt="结算单原图"
        width={displayW || undefined}
        height={displayH || undefined}
        style={{ width: displayW || undefined, height: displayH || undefined }}
        className="rounded-lg border border-slate-200 block"
        onLoad={handleImgLoad}
      />
      {vb && (
        <svg
          className="absolute top-0 left-0"
          style={{ width: displayW, height: displayH }}
          viewBox={vb}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* 字段高亮区域 */}
          {Object.entries(fieldCoords)
            .filter(([field]) => field !== 'notes')
            .map(([field, poly]) => {
              if (!poly || poly.length < 4) return null
              if (!shouldShow(field)) return null
              const isHovered = highlightedField === field || hoveredField === field
              const colors = fieldColors(field, isHovered)
              const lbl = FIELD_LABELS[field] || field
              return renderHighlight(
                `f-${field}`, field, poly, lbl, isHovered, colors,
                !!fieldConfMeta?.[field],
                colors.stroke,
              )
            })}

          {/* 保养项目高亮区域 */}
          {(items || []).map((item, idx) => {
            const itemKey = `item_${idx}`
            const itemBbox = items_bbox?.[idx]
            if (!itemBbox || itemBbox.length !== 4) return null
            if (!shouldShow(itemKey)) return null
            const poly = normToPoly(itemBbox, effectiveSize.w, effectiveSize.h)
            const isHovered = highlightedField === itemKey || hoveredField === itemKey
            const lbl = item.name || `项目${idx + 1}`
            const colors = isHovered
              ? { fill: 'rgba(59,130,246,0.32)', stroke: '#2563EB' }
              : { fill: 'rgba(16,185,129,0.18)', stroke: '#10B981' }
            return renderHighlight(`item-${idx}`, itemKey, poly, lbl, isHovered, colors)
          })}
        </svg>
      )}
    </div>
  )
}

/** 编辑保养项目行（与 RecordsList RecordModal 样式一致） */
function EditItemRow({
  idx,
  item,
  onUpdate,
  onRemove,
  onInsert,
  canRemove,
  suggestions,
  activeSuggest,
  onSuggestOpen,
  onSuggestClose,
  onApplyTemplate,
}: {
  idx: number
  item: { name: string; parts_number: string; operation_type: string; quantity: string; unit_price: string; parts_cost: string; labor_cost: string; other_cost: string }
  onUpdate: (key: string, val: string) => void
  onRemove: () => void
  onInsert: () => void
  canRemove: boolean
  suggestions: ItemTemplate[]
  activeSuggest: boolean
  onSuggestOpen: (query: string) => void
  onSuggestClose: () => void
  onApplyTemplate: (t: ItemTemplate) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const pc = parseFloat(item.parts_cost) || 0
  const lc = parseFloat(item.labor_cost) || 0
  const oc = parseFloat(item.other_cost) || 0
  const subtotal = pc + lc + oc
  const borderColor = idx % 3 === 0 ? 'border-l-blue-500' : idx % 3 === 1 ? 'border-l-emerald-500' : 'border-l-amber-500'

  // 折叠态：一行摘要
  if (!expanded) {
    return (
      <div
        className={`border border-slate-200 border-l-4 ${borderColor} rounded-lg px-3 py-2 flex items-center gap-3 bg-white hover:bg-slate-50 transition-colors`}
        onClick={() => setExpanded(true)}
      >
        <span className="text-xs text-slate-400 font-mono w-5 text-right shrink-0">{String(idx + 1).padStart(2, '0')}</span>
        <span className="flex-1 text-sm font-medium text-slate-700 truncate">{item.name || '未命名项目'}</span>
        {item.operation_type && (
          <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded shrink-0">{item.operation_type}</span>
        )}
        <span className="text-xs text-slate-500 shrink-0">×{item.quantity || '1'}</span>
        <span className="text-sm font-semibold text-slate-700 tabular-nums shrink-0">¥{subtotal.toFixed(2)}</span>
        <span className="text-[10px] text-slate-400 shrink-0">▶</span>
      </div>
    )
  }

  // 展开态：完整编辑表单
  return (
    <div className={`border border-slate-200 border-l-4 ${borderColor} rounded-lg p-3 space-y-2 bg-white`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input type="text" placeholder="项目名称 *" value={item.name}
            onChange={(e) => { onUpdate('name', e.target.value); onSuggestOpen(e.target.value) }}
            onFocus={() => onSuggestOpen(item.name)}
            onBlur={() => setTimeout(onSuggestClose, 150)}
            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          {activeSuggest && suggestions && suggestions.length > 0 && (
            <div className="absolute z-[60] top-full left-0 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-auto mt-1">
              {suggestions.map((t) => (
                <button key={t.id} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center justify-between"
                  onMouseDown={() => onApplyTemplate(t)}>
                  <span className="text-slate-700">{t.name}</span>
                  <span className="text-xs text-slate-400">{t.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {canRemove && <button onClick={onRemove} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
        <button onClick={onInsert} className="text-slate-400 hover:text-blue-500" title="在下方插入项目"><Plus className="w-4 h-4" /></button>
        <button onClick={(e) => { e.stopPropagation(); setExpanded(false) }} className="text-slate-400 hover:text-slate-600 text-[10px] px-1" title="收起">▼</button>
      </div>
      <div className="flex items-center gap-2">
        <input type="text" placeholder="零部件号" value={item.parts_number} onChange={(e) => onUpdate('parts_number', e.target.value)}
          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
        <select value={item.operation_type} onChange={(e) => onUpdate('operation_type', e.target.value)}
          className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400">
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
          <input type="number" placeholder="1" value={item.quantity} onChange={(e) => onUpdate('quantity', e.target.value)}
            className="flex-1 min-w-[56px] px-2 py-1 rounded border border-slate-200 bg-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <label className="text-slate-500 shrink-0">单价</label>
          <input type="number" step="0.01" placeholder="0" value={item.unit_price} onChange={(e) => onUpdate('unit_price', e.target.value)}
            className="flex-1 min-w-[72px] px-2 py-1 rounded border border-slate-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <div className="w-px h-4 bg-slate-300" />
          <label className="text-blue-600 shrink-0 font-medium">配件费</label>
          <input type="number" step="0.01" placeholder="0" value={item.parts_cost} onChange={(e) => onUpdate('parts_cost', e.target.value)}
            className="flex-1 min-w-[72px] px-2 py-1 rounded border border-blue-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <label className="text-emerald-600 shrink-0 font-medium">工费</label>
          <input type="number" step="0.01" placeholder="0" value={item.labor_cost} onChange={(e) => onUpdate('labor_cost', e.target.value)}
            className="flex-1 min-w-[72px] px-2 py-1 rounded border border-emerald-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
          <label className="text-amber-600 shrink-0 font-medium">其它</label>
          <input type="number" step="0.01" placeholder="0" value={item.other_cost} onChange={(e) => onUpdate('other_cost', e.target.value)}
            className="flex-1 min-w-[72px] px-2 py-1 rounded border border-amber-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400" />
          <span className="text-slate-600 ml-auto shrink-0 font-medium">小计 ¥{(pc + lc + oc).toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

// 确认识别结果 — 左右分栏: 左=原图标注, 右=字段核对/保养项目
// ============================================================
function ConfirmStep({
  ocrResult,
  editedFields,
  setEditedFields,
  editedFieldsConf,
  setEditedFieldsConf,
  itemMatches,
  setItemMatches,
  highlightedField,
  setHighlightedField,
  imgScale,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  imageContainerRef,
  naturalSize,
  onFieldClick,
  getFieldConf,
  confDisplay,
  confNeedsReview,
  matchItemTemplates,
  vehicleId,
  onSaveSuccess,
  onReset,
  showAllHighlights,
  setShowAllHighlights,
}: {
  ocrResult: OCRResult
  editedFields: Record<string, string>
  setEditedFields: (f: Record<string, string>) => void
  editedFieldsConf: Record<string, boolean>
  setEditedFieldsConf: (f: React.SetStateAction<Record<string, boolean>>) => void
  itemMatches: Record<number, ItemTemplate>
  setItemMatches: (m: Record<number, ItemTemplate>) => void
  highlightedField: string | null
  setHighlightedField: (f: string | null) => void
  imgScale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onFitPage: () => void
  imageContainerRef: React.RefObject<HTMLDivElement>
  naturalSize: { w: number; h: number }
  onFieldClick: (f: string) => void
  getFieldConf: (k: string) => number
  confDisplay: (c: number) => string
  confNeedsReview: (c: number) => boolean
  matchItemTemplates: (items: string[]) => Promise<Record<string, ItemTemplate[]>>
  vehicleId: number
  onSaveSuccess: () => void
  onReset: () => void
  showAllHighlights: boolean
  setShowAllHighlights: (v: boolean) => void
}) {
  const [rightTab, setRightTab] = useState<'fields' | 'json'>('fields')
  // 保养项目编辑状态（同步 OCR items + 可手动增删）
  // OCR 提取所有字段，模板字典仅兜底参考价
  const [editItems, setEditItems] = useState<{ name: string; parts_number: string; operation_type: string; quantity: string; unit_price: string; parts_cost: string; labor_cost: string; other_cost: string }[]>(
    ocrResult.items.length > 0
      ? ocrResult.items.map((ocrItem, i) => {
          const t = itemMatches[i]
          return {
            name: ocrItem.name,
            parts_number: ocrItem.part_number || t?.parts_number || '',
            operation_type: ocrItem.operation || t?.operation_type || '',
            quantity: ocrItem.quantity ? String(ocrItem.quantity) : '1',
            unit_price: ocrItem.unit_price ? String(ocrItem.unit_price) : (t?.reference_unit_price?.toString() || ''),
            parts_cost: ocrItem.parts_fee ? String(ocrItem.parts_fee) : (t?.reference_parts_cost?.toString() || ''),
            labor_cost: ocrItem.labor_fee ? String(ocrItem.labor_fee) : (t?.reference_labor_cost?.toString() || ''),
            other_cost: ocrItem.other_fee ? String(ocrItem.other_fee) : '',
          }
        })
      : [{ name: '', parts_number: '', operation_type: '', quantity: '1', unit_price: '', parts_cost: '', labor_cost: '', other_cost: '' }]
  )
  const [activeSuggest, setActiveSuggest] = useState<number | null>(null)
  const [templateQuery, setTemplateQuery] = useState('')
  const suggestRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const { data: suggestions } = useQuery({
    queryKey: ['item-templates', 'search', templateQuery],
    queryFn: () => getItemTemplates({ search: templateQuery }),
    enabled: templateQuery.length >= 1,
  })

  const updateField = (key: string, val: string) => {
    setEditedFields({ ...editedFields, [key]: val })
    setEditedFieldsConf((prev) => ({ ...prev, [key]: true }))
  }
  const updateItem = (idx: number, key: string, val: string) => {
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)))
  }
  const emptyItem = () => ({ name: '', parts_number: '', operation_type: '', quantity: '1', unit_price: '', parts_cost: '', labor_cost: '', other_cost: '' })
  const addItem = () => setEditItems((prev) => [...prev, emptyItem()])
  const removeItem = (idx: number) => setEditItems((prev) => prev.filter((_, i) => i !== idx))
  const insertItem = (idx: number) => setEditItems((prev) => [...prev.slice(0, idx + 1), emptyItem(), ...prev.slice(idx + 1)])

  const applyTemplate = (idx: number, t: ItemTemplate) => {
    updateItem(idx, 'name', t.name)
    if (t.parts_number) updateItem(idx, 'parts_number', t.parts_number)
    if (t.operation_type) updateItem(idx, 'operation_type', t.operation_type)
    if (t.reference_unit_price) updateItem(idx, 'unit_price', t.reference_unit_price.toString())
    if (t.reference_parts_cost) updateItem(idx, 'parts_cost', t.reference_parts_cost.toString())
    if (t.reference_labor_cost) updateItem(idx, 'labor_cost', t.reference_labor_cost.toString())
    setActiveSuggest(null)
  }

  const handleItemNameChange = (idx: number, name: string) => {
    updateItem(idx, 'name', name)
    setTemplateQuery(name)
    setActiveSuggest(idx)
  }

  const confLevel = (conf: number) => {
    if (conf < 0) return '无数据'
    if (conf < 0.5) return '低'
    if (conf < 0.8) return '中'
    return '高'
  }
  const confColor = (conf: number) => {
    if (conf < 0) return '#94A3B8'
    if (conf < 0.5) return '#EF4444'
    if (conf < 0.8) return '#F59E0B'
    return '#10B981'
  }
  // 构建 fieldConfMeta
  const meta: Record<string, { label: string; color: string; conf: number; needsReview: boolean }> = {}
  Object.keys(editedFields).forEach((key) => {
    const conf = getFieldConf(key)
    const needsReview = confNeedsReview(conf)
    meta[key] = {
      label: confLevel(conf),
      color: confColor(conf),
      conf,
      needsReview,
    }
  })

  // createRecord mutation（可直接读取 editItems）
  const qc = useQueryClient()
  const saveMut = useMutation({
    mutationFn: () =>
      createRecord({
        vehicle_id: vehicleId,
        date: editedFields.date || new Date().toISOString().slice(0, 10),
        mileage: editedFields.mileage ? parseInt(editedFields.mileage) : null,
        next_mileage: editedFields.next_mileage ? parseInt(editedFields.next_mileage) : null,
        next_date: editedFields.next_date || null,
        total_amount: editedFields.total_amount ? parseFloat(editedFields.total_amount) : 0,
        paid_amount: editedFields.paid_amount ? parseFloat(editedFields.paid_amount) : 0,
        discount: editedFields.discount ? parseFloat(editedFields.discount) : 0,
        station: editedFields.station || null,
        notes: editedFields.order_no ? `修理号: ${editedFields.order_no}` : null,
        ocr_raw: ocrResult?.raw_text || '',
        type: editedFields.type || '保养',
        items: editItems.map((it) => ({
          name: it.name,
          parts_number: it.parts_number,
          operation_type: it.operation_type,
          quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unit_price) || 0,
          parts_cost: parseFloat(it.parts_cost) || 0,
          labor_cost: parseFloat(it.labor_cost) || 0,
          other_cost: parseFloat(it.other_cost) || 0,
          subtotal: (parseFloat(it.parts_cost) || 0) + (parseFloat(it.labor_cost) || 0),
        })),
      }),
    onSuccess: () => {
      onSaveSuccess()
      qc.invalidateQueries({ queryKey: ['records'] })
    },
  })

  // 字段 ref + 滚动定位
  const fieldInputRefs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (highlightedField && fieldInputRefs.current[highlightedField]) {
      fieldInputRefs.current[highlightedField]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedField])

  // 点击/聚焦右侧字段 → 高亮左侧对应区域
  const clickField = (f: string) => {
    setHighlightedField(f)
    fieldInputRefs.current[f]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  const focusField = (f: string) => setHighlightedField(f)
  const blurField = () => setHighlightedField(null)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <MousePointer className="w-4 h-4 text-blue-600" />
        <h3 className="text-base font-semibold text-slate-800">确认识别结果</h3>
        <span className="text-xs text-slate-400 ml-2">点击左侧高亮区域或右侧字段可相互定位</span>
      </div>

      <div className="flex gap-6 mb-6" style={{ height: '70vh' }}>
        {/* 左侧：原图标注 */}
        <div className="w-1/2 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">结算单原图</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAllHighlights(!showAllHighlights)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  showAllHighlights
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
                title={showAllHighlights ? '隐藏所有高亮标注' : '显示所有高亮标注'}
              >
                <MousePointer className="w-3 h-3" />
                {showAllHighlights ? '隐藏标注' : '显示标注'}
              </button>
              <ZoomToolbar scale={imgScale} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFitWidth={onFitWidth} onFitPage={onFitPage} />
            </div>
          </div>
          <div ref={imageContainerRef} className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
            {ocrResult.image_base64 ? (
              <ImageAnnotation
                imageBase64={ocrResult.image_base64}
                fieldCoords={ocrResult.field_coords}
                highlightedField={highlightedField}
                onFieldClick={onFieldClick}
                scale={imgScale}
                naturalSize={naturalSize}
                fieldConfMeta={meta}
                items={ocrResult.items}
                items_bbox={ocrResult.items_bbox}
                showAll={showAllHighlights}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">无图片预览</div>
            )}
          </div>
        </div>

        {/* 右侧：Tab 切换 */}
        <div className="w-1/2 flex flex-col min-w-0">
          {/* Tab 切换 */}
          <div className="flex border-b border-slate-200 mb-0">
            <button
              onClick={() => setRightTab('fields')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                rightTab === 'fields'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              字段核对
            </button>
            <button
              onClick={() => setRightTab('json')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                rightTab === 'json'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              原始 JSON
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            {/* Tab1: 字段核对 */}
            {rightTab === 'fields' && (
              <div className="py-3 space-y-4">
                {/* 基本信息字段卡片 */}
                <div className="space-y-1.5">
                  {[
                    { key: 'date', label: '结算日期', type: 'date' as const, placeholder: '' },
                    { key: 'mileage', label: '里程数 (km)', type: 'number' as const, placeholder: '如 50000' },
                    { key: 'type', label: '修理类型', type: 'text' as const, placeholder: '来自 OCR' },
                    { key: 'station', label: '服务店', type: 'text' as const, placeholder: '如 XX 4S店' },
                    { key: 'next_mileage', label: '下次保养里程 (km)', type: 'number' as const, placeholder: '如 55000' },
                    { key: 'next_date', label: '下次保养日期', type: 'date' as const, placeholder: '' },
                  ].map(f => {
                    const conf = getFieldConf(f.key)
                    const barColor = conf < 0 ? '#94A3B8' : conf < 0.5 ? '#EF4444' : conf < 0.8 ? '#F59E0B' : '#10B981'
                    const isActive = highlightedField === f.key
                    const confHint = conf < 0 ? 'OCR 未能返回置信度'
                      : conf < 0.5 ? '识别可信度低，请重点核对'
                      : conf < 0.8 ? '识别基本可信，建议核对' : '识别可信度高'
                    return (
                      <div key={f.key}
                        ref={el => { fieldInputRefs.current[f.key] = el }}
                        onClick={() => clickField(f.key)}
                        onMouseEnter={() => setHighlightedField(f.key)}
                        onMouseLeave={() => setHighlightedField(null)}
                        className={`group flex items-stretch rounded-lg border transition-all cursor-pointer ${
                          isActive ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <div className="w-1 rounded-l-lg shrink-0" style={{ backgroundColor: barColor }} />
                        <div className="flex-1 px-3 py-2">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium text-slate-600">{f.label}</span>
                            <span className="ml-auto flex items-center gap-1.5">
                              <span className={`text-[10px] ${conf >= 0 && conf < 0.5 ? 'text-red-500' : 'text-slate-400'}`}>
                                {confHint}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium tabular-nums shrink-0"
                                style={{ backgroundColor: barColor + '20', color: barColor }}>
                                {conf < 0 ? '—' : `${Math.round(conf * 100)}%`}
                              </span>
                            </span>
                          </div>
                          <input
                            type={f.type}
                            placeholder={f.placeholder}
                            value={editedFields[f.key] || ''}
                            onChange={(e) => updateField(f.key, e.target.value)}
                            onFocus={() => focusField(f.key)}
                            onBlur={blurField}
                            className="w-full px-2 py-1 rounded border border-transparent text-sm bg-transparent hover:border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 focus:outline-none"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 保养项目 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-slate-500">
                      保养项目 {editItems.length > 0 ? `(${editItems.length}项)` : ''}
                    </p>
                    <button onClick={addItem} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
                      <Plus className="w-3 h-3" /> 添加
                    </button>
                  </div>
                  <div className="space-y-2">
                    {editItems.map((item, idx) => (
                      <div key={idx}
                        onClick={() => clickField(`item_${idx}`)}
                        onMouseEnter={() => setHighlightedField(`item_${idx}`)}
                        onMouseLeave={() => setHighlightedField(null)}
                        className="cursor-pointer"
                      >
                        <EditItemRow
                          idx={idx}
                          item={item}
                          onUpdate={(key, val) => updateItem(idx, key, val)}
                          onRemove={() => removeItem(idx)}
                          onInsert={() => insertItem(idx)}
                          canRemove={editItems.length > 1}
                          suggestions={suggestions || []}
                          activeSuggest={activeSuggest === idx}
                          onSuggestOpen={(q) => { setTemplateQuery(q); setActiveSuggest(idx) }}
                          onSuggestClose={() => setActiveSuggest(null)}
                          onApplyTemplate={(t) => applyTemplate(idx, t)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* 费用信息 — 公式布局 */}
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs font-medium text-slate-500 mb-3">费用信息</p>
                  <div className="flex items-end gap-2 justify-center">
                    {/* 原价 */}
                    <div ref={el => { fieldInputRefs.current['total_amount'] = el }}
                      onClick={() => clickField('total_amount')}
                      onMouseEnter={() => setHighlightedField('total_amount')}
                      onMouseLeave={() => setHighlightedField(null)}
                      className="flex-1 max-w-[140px] text-center cursor-pointer">
                      <span className="text-xs text-slate-500 block mb-1">原价</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">¥</span>
                        <input type="number" step="0.01" placeholder="0.00" value={editedFields.total_amount || ''}
                          onChange={(e) => updateField('total_amount', e.target.value)}
                          onFocus={() => focusField('total_amount')} onBlur={blurField}
                          className="w-full pl-5 pr-2 py-2 rounded-lg border border-slate-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
                      </div>
                    </div>
                    <span className="text-lg text-slate-300 pb-2 font-light">—</span>
                    {/* 优惠 */}
                    <div ref={el => { fieldInputRefs.current['discount'] = el }}
                      onClick={() => clickField('discount')}
                      onMouseEnter={() => setHighlightedField('discount')}
                      onMouseLeave={() => setHighlightedField(null)}
                      className="flex-1 max-w-[140px] text-center cursor-pointer">
                      <span className="text-xs text-slate-500 block mb-1">优惠</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">¥</span>
                        <input type="number" step="0.01" placeholder="0.00" value={editedFields.discount || ''}
                          onChange={(e) => updateField('discount', e.target.value)}
                          onFocus={() => focusField('discount')} onBlur={blurField}
                          className="w-full pl-5 pr-2 py-2 rounded-lg border border-slate-200 bg-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
                      </div>
                    </div>
                    <span className="text-lg text-slate-300 pb-2 font-light">=</span>
                    {/* 实付 */}
                    <div ref={el => { fieldInputRefs.current['paid_amount'] = el }}
                      onClick={() => clickField('paid_amount')}
                      onMouseEnter={() => setHighlightedField('paid_amount')}
                      onMouseLeave={() => setHighlightedField(null)}
                      className="flex-1 max-w-[140px] text-center cursor-pointer">
                      <span className="text-xs font-medium text-emerald-600 block mb-1">实付</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-emerald-500">¥</span>
                        <input type="number" step="0.01" placeholder="0.00" value={editedFields.paid_amount || ''}
                          onChange={(e) => updateField('paid_amount', e.target.value)}
                          onFocus={() => focusField('paid_amount')} onBlur={blurField}
                          className="w-full pl-5 pr-2 py-2 rounded-lg border border-emerald-200 bg-emerald-50/50 text-sm text-right font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 其他字段 */}
                {editedFields.order_no && (
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">修理号</label>
                    <input type="text" value={editedFields.order_no} readOnly
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500" />
                  </div>
                )}
              </div>
            )}

            {/* Tab2: 原始 JSON */}
            {rightTab === 'json' && (
              <div className="py-3">
                <p className="text-xs font-medium text-slate-500 mb-2">LLM 返回的原始 JSON</p>
                <pre className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600 whitespace-pre-wrap overflow-auto"
                  style={{ maxHeight: 'calc(70vh - 80px)', fontFamily: 'ui-monospace, monospace' }}>
                  {ocrResult.raw_json
                    ? JSON.stringify(JSON.parse(ocrResult.raw_json), null, 2)
                    : '无原始 JSON 数据'}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex gap-3 justify-end border-t border-slate-100 pt-4">
        <button onClick={onReset} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">重新上传</button>
        <button
          onClick={async () => {
            const date = editedFields.date || new Date().toISOString().slice(0, 10)
            try {
              const dup = await checkDuplicateRecord(vehicleId, date)
              if (dup.exists) {
                const ok = window.confirm(`该车辆在 ${date} 已有 ${dup.count} 条保养记录，确定仍要录入吗？\n\n${dup.hint}`)
                if (!ok) return
              }
            } catch {}
            saveMut.mutate()
          }}
          disabled={saveMut.isPending}
          className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm disabled:opacity-50"
        >
          {saveMut.isPending ? '保存中…' : '确认入库'}
        </button>
      </div>
    </div>
  )
}

// 将 step3 中的 IIFE 替换为组件调用
const Step3ConfirmStep = ConfirmStep

// --- 批量上传队列项 ---
type BatchStatus = 'queued' | 'processing' | 'done' | 'confirmed' | 'error'
interface BatchEntry {
  id: string
  file: File
  status: BatchStatus
  ocrResult?: OCRResult
  error?: string
}
let _batchIdCounter = 0
function nextBatchId() { return `batch-${++_batchIdCounter}` }

// --- 批量队列 OCR 处理器：逐一处理队列中的文件 ---
function BatchOcrProcessor({
  entry,
  onDone,
}: {
  entry: BatchEntry
  onDone: (result: OCRResult) => void
}) {
  const [step, setStep] = useState(0)
  const [stepDone, setStepDone] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const stepStart = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (step === 0) {
      const t = setTimeout(() => { stepStart.current = Date.now(); setStep(1) }, 100)
      return () => clearTimeout(t)
    }
    if (step === 1) {
      const t = setTimeout(() => { stepStart.current = Date.now(); setStep(2) }, 200)
      return () => clearTimeout(t)
    }
    if (step === 2) {
      const t = setTimeout(() => { setStepDone(true); const t2 = setTimeout(() => setStep(3), 300); return () => clearTimeout(t2) }, 200)
      return () => clearTimeout(t)
    }
  }, [step])

  useEffect(() => {
    const controller = new AbortController()
    const form = new FormData()
    form.append('file', entry.file)
    fetch('/api/upload', { method: 'POST', body: form, signal: controller.signal })
      .then(r => r.json())
      .then((data: OCRResult) => onDone(data))
      .catch(err => {
        if (err.name !== 'AbortError') {
          onDone({ raw_text: '', fields: {}, items: [], blocks: [], field_coords: {}, image_base64: '', error: err.message } as OCRResult)
        }
      })
    return () => controller.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`
  }

  return (
    <div className="flex items-center gap-3">
      <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
      <span className="text-sm text-slate-600 truncate flex-1">{entry.file.name}</span>
      <span className="text-xs text-slate-400 tabular-nums shrink-0">{formatElapsed(elapsed)}</span>
    </div>
  )
}

export default function UploadPage() {
  // --- 单张模式状态 ---
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null)
  const [error, setError] = useState('')
  const [editedFields, setEditedFields] = useState<Record<string, string>>({})
  const [editedFieldsConf, setEditedFieldsConf] = useState<Record<string, boolean>>({})
  const [highlightedField, setHighlightedField] = useState<string | null>(null)
  const [showAllHighlights, setShowAllHighlights] = useState(true)
  const [imgScale, setImgScale] = useState(1)
  const [itemMatches, setItemMatches] = useState<Record<number, ItemTemplate>>({})

  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const { currentVehicleId } = useStore()
  const qc = useQueryClient()
  const imageContainerRef = useRef<HTMLDivElement>(null)

  // --- 批量模式状态 ---
  const [isBatch, setIsBatch] = useState(false)
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([])
  const [batchReviewIdx, setBatchReviewIdx] = useState<number>(-1)
  const processTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const processingRef = useRef(false)


  useEffect(() => {
    return () => { if (processTimerRef.current) clearTimeout(processTimerRef.current) }
  }, [])

  // 审核时用的 OCR 结果引用
  const reviewingEntry = batchReviewIdx >= 0 ? batchEntries[batchReviewIdx] : null

  // --- 单张模式：置信度等函数 ---
  const getFieldConf = useCallback((key: string, result?: OCRResult): number => {
    if (editedFieldsConf[key]) return 1.0
    return result?.confidence?.[key] ?? -1
  }, [editedFieldsConf])

  const getFieldConfForReview = useCallback((key: string): number => {
    return getFieldConf(key, reviewingEntry?.ocrResult)
  }, [getFieldConf, reviewingEntry])

  const confColor = (conf: number) => {
    if (conf < 0) return 'bg-slate-300'
    if (conf < confLowThreshold) return 'bg-red-500'
    if (conf < confMidThreshold) return 'bg-amber-400'
    return 'bg-emerald-500'
  }

  const confHex = (conf: number) => {
    if (conf < 0) return '#94A3B8'
    if (conf < confLowThreshold) return '#EF4444'
    if (conf < confMidThreshold) return '#F59E0B'
    return '#10B981'
  }
  // 置信度阈值（可自定义）
  const [confLowThreshold, setConfLowThreshold] = useState(0.5)
  const [confMidThreshold, setConfMidThreshold] = useState(0.8)

  const confLevel = (conf: number) => {
    if (conf < 0) return '无数据'
    if (conf < confLowThreshold) return '低'
    if (conf < confMidThreshold) return '中'
    return '高'
  }
  const confDisplay = (conf: number) => {
    if (conf < 0) return '○ 无数据'
    return `● ${confLevel(conf)} ${Math.round(conf * 100)}%`
  }
  const confNeedsReview = (conf: number) => conf >= 0 && conf < confLowThreshold

  // --- 单张模式：OCR 完成后匹配项目字典 ---
  useEffect(() => {
    if (step === 3 && ocrResult?.items && ocrResult.items.length > 0) {
      const names = ocrResult.items.map((it) => it.name)
      matchItemTemplates(names).then((matched) => {
        const map: Record<number, ItemTemplate> = {}
        ocrResult.items.forEach((it, i) => {
          if (matched[it.name]?.length) map[i] = matched[it.name][0]
        })
        setItemMatches(map)
      }).catch(() => {})
    }
  }, [step, ocrResult?.items])

  // --- 获取图片原始尺寸（单张 + 批量共用） ---
  const updateNaturalSize = useCallback((result?: OCRResult | null) => {
    const ow = result?.natural_width
    const oh = result?.natural_height
    if (ow && oh && ow > 0 && oh > 0) {
      setNaturalSize({ w: ow, h: oh })
      if (imageContainerRef.current) {
        setImgScale(imageContainerRef.current.clientWidth / ow)
      }
    } else if (result?.image_base64) {
      const img = new Image()
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
        if (imageContainerRef.current) {
          setImgScale(imageContainerRef.current.clientWidth / img.naturalWidth)
        }
      }
      img.src = `data:image/png;base64,${result.image_base64}`
    }
  }, [])

  useEffect(() => {
    updateNaturalSize(ocrResult)
  }, [ocrResult?.image_base64, ocrResult?.natural_width, ocrResult?.natural_height, updateNaturalSize])

  // 批量审核切换时更新图片尺寸
  useEffect(() => {
    if (isBatch && reviewingEntry?.ocrResult) {
      updateNaturalSize(reviewingEntry.ocrResult)
      setImgScale(1)
    }
  }, [isBatch, batchReviewIdx, reviewingEntry?.ocrResult, updateNaturalSize])

  const zoomIn = useCallback(() => setImgScale((s) => Math.min(s + 0.25, 5)), [])
  const zoomOut = useCallback(() => setImgScale((s) => Math.max(s - 0.25, 0.1)), [])
  const fitWidth = useCallback(() => {
    if (imageContainerRef.current && naturalSize.w > 0) {
      setImgScale(imageContainerRef.current.clientWidth / naturalSize.w)
    }
  }, [naturalSize.w])
  const fitPage = useCallback(() => {
    if (imageContainerRef.current && naturalSize.w > 0 && naturalSize.h > 0) {
      setImgScale(Math.min(imageContainerRef.current.clientWidth / naturalSize.w, imageContainerRef.current.clientHeight / naturalSize.h))
    }
  }, [naturalSize])

  // --- 单张模式处理函数 ---
  const handleOcrResult = useCallback((data: OCRResult) => {
    if (data.error) { setError(data.error); setStep(1) }
    else { setOcrResult(data); setEditedFields({ ...data.fields }); setEditedFieldsConf({}); setImgScale(1); setStep(3) }
  }, [])

  const handleSingleFile = useCallback((f: FileList | null) => {
    if (f && f[0]) { setFile(f[0]); setStep(2); setError('') }
  }, [])

  const handleFieldClick = useCallback((field: string) => {
    setHighlightedField((prev) => (prev === field ? null : field))
  }, [])

  const fieldInputRefs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (highlightedField && fieldInputRefs.current[highlightedField]) {
      fieldInputRefs.current[highlightedField]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedField])

  // 处理单个文件 OCR（公共函数，用于初始处理 + 重试）
  const processOneFile = useCallback((index: number, file: File) => {
    processingRef.current = true
    setBatchEntries(prev => {
      const next = [...prev]
      if (next[index]) next[index] = { ...next[index], status: 'processing', error: undefined, ocrResult: undefined }
      return next
    })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 600000)
    const form = new FormData()
    form.append('file', file)
    fetch('/api/upload', { method: 'POST', body: form, signal: controller.signal })
      .then(r => r.json())
      .then((data: OCRResult) => {
        clearTimeout(timeoutId)
        setBatchEntries(prev => {
          const next = [...prev]
          if (data.error) {
            next[index] = { ...next[index], status: 'error', error: data.error }
          } else {
            next[index] = { ...next[index], status: 'done', ocrResult: data }
          }
          const nextIdx = next.findIndex(e => e.status === 'queued')
          if (nextIdx >= 0) {
            processTimerRef.current = setTimeout(() => processOneFile(nextIdx, next[nextIdx].file), 5000)
          } else {
            processingRef.current = false
          }
          return next
        })
      })
      .catch(err => {
        clearTimeout(timeoutId)
        setBatchEntries(prev => {
          const next = [...prev]
          const msg = err.name === 'AbortError' ? '请求超时（超过 10 分钟）' : err.message
          next[index] = { ...next[index], status: 'error', error: msg }
          const nextIdx = next.findIndex(e => e.status === 'queued')
          if (nextIdx >= 0) {
            processTimerRef.current = setTimeout(() => processOneFile(nextIdx, next[nextIdx].file), 5000)
          } else {
            processingRef.current = false
          }
          return next
        })
      })
  }, [])

  // --- 批量处理：串行处理队列 ---
  const startBatchProcessing = useCallback((entries: BatchEntry[]) => {
    const idx = entries.findIndex(e => e.status === 'queued')
    if (idx < 0) { processingRef.current = false; return }
    processOneFile(idx, entries[idx].file)
  }, [processOneFile])

  // --- 批量模式处理函数 ---
  const handleBatchFiles = useCallback((f: FileList | null) => {
    if (!f || f.length === 0) return
    const newEntries: BatchEntry[] = Array.from(f).map(file => ({
      id: nextBatchId(),
      file,
      status: 'queued' as BatchStatus,
    }))
    setBatchEntries(prev => {
      const merged = [...prev, ...newEntries]
      if (!processingRef.current) {
        setTimeout(() => startBatchProcessing(merged), 200)
      }
      return merged
    })
  }, [startBatchProcessing])

  const handleBatchConfirm = useCallback((idx: number) => {
    setBatchEntries(prev => prev.map((e, i) => i === idx ? { ...e, status: 'confirmed' } : e))
    setBatchReviewIdx(-1)
  }, [])

  const handleBatchSaveAll = useCallback(async () => {
    const confirmed = batchEntries.filter(e => e.status === 'confirmed' && e.ocrResult)
    // 批量查重
    const duplicates: { date: string; count: number }[] = []
    for (const entry of confirmed) {
      const date = entry.ocrResult!.fields.date || new Date().toISOString().slice(0, 10)
      try {
        const dup = await checkDuplicateRecord(currentVehicleId!, date)
        if (dup.exists) duplicates.push({ date, count: dup.count })
      } catch {}
    }
    if (duplicates.length > 0) {
      const msg = duplicates.map(d => `${d.date}（已有 ${d.count} 条）`).join('\n')
      const ok = window.confirm(`以下日期已有保养记录：\n\n${msg}\n\n确定仍要录入吗？`)
      if (!ok) return
    }

    for (const entry of confirmed) {
      const r = entry.ocrResult!
      try {
        await createRecord({
          vehicle_id: currentVehicleId!,
          date: r.fields.date || new Date().toISOString().slice(0, 10),
          mileage: r.fields.mileage ? parseInt(r.fields.mileage) : null,
          next_mileage: r.fields.next_mileage ? parseInt(r.fields.next_mileage) : null,
          next_date: r.fields.next_date || null,
          total_amount: r.fields.total_amount ? parseFloat(r.fields.total_amount) : 0,
          paid_amount: r.fields.paid_amount ? parseFloat(r.fields.paid_amount) : 0,
          discount: r.fields.discount ? parseFloat(r.fields.discount) : 0,
          station: r.fields.station || null,
          notes: r.fields.order_no ? `修理号: ${r.fields.order_no}` : null,
          ocr_raw: r.raw_text || '',
          type: r.fields.type || '保养',
          items: (r.items || []).map(it => ({
            name: it.name,
            parts_number: it.part_number || '',
            operation_type: it.operation || '',
            quantity: it.quantity || 1,
            unit_price: it.unit_price || 0,
            parts_cost: it.parts_fee || 0,
            labor_cost: it.labor_fee || 0,
            other_cost: it.other_fee || 0,
            subtotal: (it.parts_fee || 0) + (it.labor_fee || 0),
          })),
        })
      } catch {}
    }
    setBatchEntries(prev => prev.map(e => e.status === 'confirmed' ? { ...e, status: 'done' as BatchStatus } : e))
    qc.invalidateQueries({ queryKey: ['records'] })
  }, [batchEntries, currentVehicleId, qc])

  const clearBatch = () => {
    if (processTimerRef.current) clearTimeout(processTimerRef.current)
    processingRef.current = false
    setBatchEntries([])
    setBatchReviewIdx(-1)
  }

  // 重试失败的文件
  const handleRetry = useCallback((idx: number) => {
    setBatchEntries(prev => {
      const next = [...prev]
      if (!next[idx]) return prev
      next[idx] = { ...next[idx], status: 'queued', error: undefined, ocrResult: undefined }
      if (!processingRef.current) {
        processTimerRef.current = setTimeout(() => processOneFile(idx, next[idx].file), 5000)
      }
      return next
    })
  }, [processOneFile])

  const queuedCount = batchEntries.filter(e => e.status === 'queued').length
  const processingIdx = batchEntries.findIndex(e => e.status === 'processing')
  const processingCount = processingIdx >= 0 ? 1 : 0
  const doneCount = batchEntries.filter(e => e.status === 'done').length
  const confirmedCount = batchEntries.filter(e => e.status === 'confirmed').length
  const errorCount = batchEntries.filter(e => e.status === 'error').length
  const totalCount = batchEntries.length

  const statusIcon = (status: BatchStatus) => {
    switch (status) {
      case 'queued': return <Clock className="w-3.5 h-3.5 text-slate-400" />
      case 'processing': return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
      case 'done': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
      case 'confirmed': return <Check className="w-3.5 h-3.5 text-blue-600" />
      case 'error': return <AlertCircle className="w-3.5 h-3.5 text-red-500" />
    }
  }

  const statusLabel = (status: BatchStatus) => {
    switch (status) {
      case 'queued': return '排队'
      case 'processing': return '识别中'
      case 'done': return '已识别'
      case 'confirmed': return '已审核'
      case 'error': return '失败'
    }
  }

  // --- 渲染 ---
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">上传录入</h2>
          <p className="text-sm text-slate-500 mt-1">通过 OCR 自动识别结算单信息，支持原图比对校验</p>
        </div>
        {/* 模式切换 */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => { setIsBatch(false); clearBatch() }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!isBatch ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            单张上传
          </button>
          <button
            onClick={() => { setIsBatch(true); setStep(1); setFile(null); setOcrResult(null) }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isBatch ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            批量上传
          </button>
        </div>
      </div>

      {/* 置信度阈值设置 */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-2 mb-4 flex items-center gap-4 text-xs">
        <span className="text-slate-500 shrink-0">置信度阈值</span>
        <label className="flex items-center gap-1 text-slate-600">
          低 &lt;
          <input
            type="number" min={0} max={1} step={0.05}
            value={confLowThreshold}
            onChange={e => setConfLowThreshold(Math.min(Number(e.target.value), confMidThreshold))}
            className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-xs text-center"
          />
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          中 &lt;
          <input
            type="number" min={0} max={1} step={0.05}
            value={confMidThreshold}
            onChange={e => setConfMidThreshold(Math.max(Number(e.target.value), confLowThreshold))}
            className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-xs text-center"
          />
        </label>
        <span className="text-slate-400">高</span>
        <span className="text-[10px] text-slate-400 ml-auto hidden sm:inline">低于低阈值的字段需重点核对</span>
      </div>

      {/* ====== 单张模式 ====== */}
      {!isBatch && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-4 mb-6">
            <div className="flex items-center">
              {['上传图片', 'OCR 识别', '确认数据', '保存入库'].map((label, idx) => (
                <div key={idx} className="flex items-center flex-1 last:flex-none">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                      step > idx + 1 ? 'bg-emerald-500 text-white' :
                      step === idx + 1 ? 'bg-blue-600 text-white' :
                      'bg-slate-100 text-slate-400'
                    }`}>
                      {step > idx + 1 ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span className={`text-sm whitespace-nowrap ${step >= idx + 1 ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                      {label}
                    </span>
                  </div>
                  {idx < 3 && <div className={`flex-1 h-px mx-3 ${step > idx + 1 ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                </div>
              ))}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">{error}</div>}

          {step === 1 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8">
              <label className="block border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer">
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => handleSingleFile(e.target.files)} />
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-7 h-7 text-blue-600" />
                </div>
                <p className="text-base font-medium text-slate-800 mb-1">点击上传或拖拽结算单到此处</p>
                <p className="text-sm text-slate-500">支持 JPG / PNG / PDF 格式</p>
              </label>
            </div>
          )}

          {step === 2 && file && <OcrProgress file={file} onResult={handleOcrResult} />}

          {step === 3 && ocrResult && (
            <Step3ConfirmStep
              ocrResult={ocrResult} editedFields={editedFields} setEditedFields={setEditedFields}
              editedFieldsConf={editedFieldsConf} setEditedFieldsConf={setEditedFieldsConf}
              itemMatches={itemMatches} setItemMatches={setItemMatches}
              highlightedField={highlightedField} setHighlightedField={setHighlightedField}
              imgScale={imgScale} onZoomIn={zoomIn} onZoomOut={zoomOut} onFitWidth={fitWidth} onFitPage={fitPage}
              imageContainerRef={imageContainerRef} naturalSize={naturalSize} onFieldClick={handleFieldClick}
              getFieldConf={(k: string) => getFieldConf(k, ocrResult)} confDisplay={confDisplay} confNeedsReview={confNeedsReview}
              matchItemTemplates={matchItemTemplates} vehicleId={currentVehicleId!}
              onSaveSuccess={() => { setStep(4); qc.invalidateQueries({ queryKey: ['records'] }) }}
              onReset={() => { setStep(1); setOcrResult(null); setEditedFields({}); setEditedFieldsConf({}); setHighlightedField(null); setItemMatches({}) }}
              showAllHighlights={showAllHighlights} setShowAllHighlights={setShowAllHighlights}
            />
          )}

          {step === 4 && (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-lg font-semibold text-slate-800 mb-2">录入成功！</p>
              <p className="text-sm text-slate-500 mb-6">保养记录已保存到数据库</p>
              <button onClick={() => { setStep(1); setOcrResult(null); setFile(null); setEditedFields({}); setEditedFieldsConf({}); setHighlightedField(null); setItemMatches({}) }}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">继续上传</button>
            </div>
          )}
        </>
      )}

      {/* ====== 批量模式 ====== */}
      {isBatch && (
        <>
          {/* 队列统计 */}
          {totalCount > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 px-6 py-3 mb-4 flex items-center gap-4 text-xs text-slate-500">
              <span>共 {totalCount} 张</span>
              {queuedCount > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 排队 {queuedCount}</span>}
              {processingCount > 0 && <span className="flex items-center gap-1 text-blue-500"><Loader2 className="w-3 h-3 animate-spin" /> 识别中</span>}
              {doneCount > 0 && <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 className="w-3 h-3" /> 已识别 {doneCount}</span>}
              {confirmedCount > 0 && <span className="flex items-center gap-1 text-blue-600"><Check className="w-3 h-3" /> 已审核 {confirmedCount}</span>}
              {errorCount > 0 && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3 h-3" /> 失败 {errorCount}</span>}
              <div className="flex-1" />
              <button onClick={clearBatch} className="text-slate-400 hover:text-red-500 transition-colors">清空</button>
            </div>
          )}

          {/* 文件列表 + 审核区 */}
          {totalCount === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8">
              <label className="block border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer">
                <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => handleBatchFiles(e.target.files)} />
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Layers className="w-7 h-7 text-blue-600" />
                </div>
                <p className="text-base font-medium text-slate-800 mb-1">选择多张结算单图片</p>
                <p className="text-sm text-slate-500">支持一次选择多张 JPG / PNG / PDF 文件</p>
              </label>
            </div>
          ) : (
            <div className="flex gap-6">
              {/* 左侧：文件列表 */}
              <div className="w-80 shrink-0 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">文件队列</span>
                    <label className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer">
                      <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => handleBatchFiles(e.target.files)} />
                      + 追加文件
                    </label>
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-50">
                    {batchEntries.map((entry, idx) => (
                      <div
                        key={entry.id}
                        className={`px-4 py-3 flex items-center gap-3 ${batchReviewIdx === idx ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
                      >
                        {statusIcon(entry.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-700 truncate">{entry.file.name}</p>
                          <p className="text-xs text-slate-400">{statusLabel(entry.status)}{entry.error ? `：${entry.error}` : ''}</p>
                        </div>
                        {entry.status === 'done' && (
                          <button
                            onClick={() => setBatchReviewIdx(idx)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            <Eye className="w-3 h-3" /> 审核
                          </button>
                        )}
                        {entry.status === 'confirmed' && (
                          <button
                            onClick={() => setBatchReviewIdx(idx)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 rounded transition-colors"
                          >
                            <Eye className="w-3 h-3" /> 查看
                          </button>
                        )}
                        {entry.status === 'error' && (
                          <button
                            onClick={() => handleRetry(idx)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" /> 重试
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 全部入库 */}
                {confirmedCount > 0 && (
                  <button
                    onClick={handleBatchSaveAll}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    全部入库（{confirmedCount} 条记录）
                  </button>
                )}
              </div>

              {/* 右侧：审核区 */}
              <div className="flex-1 min-w-0">
                {reviewingEntry && reviewingEntry.ocrResult ? (
                  <Step3ConfirmStep
                    ocrResult={reviewingEntry.ocrResult}
                    editedFields={{ ...reviewingEntry.ocrResult.fields }}
                    setEditedFields={(fields) => {
                      setBatchEntries(prev => prev.map((e, i) => i === batchReviewIdx && e.ocrResult
                        ? { ...e, ocrResult: { ...e.ocrResult, fields } }
                        : e))
                    }}
                    editedFieldsConf={{}}
                    setEditedFieldsConf={() => {}}
                    itemMatches={{}}
                    setItemMatches={() => {}}
                    highlightedField={highlightedField}
                    setHighlightedField={setHighlightedField}
                    imgScale={imgScale}
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                    onFitWidth={fitWidth}
                    onFitPage={fitPage}
                    imageContainerRef={imageContainerRef}
                    naturalSize={naturalSize}
                    onFieldClick={handleFieldClick}
                    getFieldConf={getFieldConfForReview}
                    confDisplay={confDisplay}
                    confNeedsReview={confNeedsReview}
                    matchItemTemplates={matchItemTemplates}
                    vehicleId={currentVehicleId!}
                    onSaveSuccess={() => handleBatchConfirm(batchReviewIdx)}
                    onReset={() => setBatchReviewIdx(-1)}
                    showAllHighlights={showAllHighlights}
                    setShowAllHighlights={setShowAllHighlights}
                  />
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                    <Eye className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">
                      {doneCount > 0
                        ? '点击左侧「审核」按钮查看识别结果'
                        : totalCount === 0
                          ? '选择文件开始批量上传'
                          : '等待 OCR 识别完成后即可审核'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
