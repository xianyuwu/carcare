import { useState, useCallback, useRef, useEffect } from 'react'
import { Upload, FileText, CheckCircle2, MousePointer, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadAndOCR, createRecord, matchItemTemplates, type ItemTemplate } from '../api/client'
import { useStore } from '../hooks/useStore'
import type { OCRResult } from '../api/client'

/** 字段中文标签映射 */
const FIELD_LABELS: Record<string, string> = {
  date: '结算日期',
  mileage: '里程数',
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

/** 图片标注覆盖层组件（支持缩放） */
function ImageAnnotation({
  imageBase64,
  blocks,
  fieldCoords,
  highlightedField,
  onFieldClick,
  scale,
}: {
  imageBase64: string
  blocks: OCRResult['blocks']
  fieldCoords: OCRResult['field_coords']
  highlightedField: string | null
  onFieldClick: (field: string) => void
  scale: number
}) {
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
  }, [])

  const displayW = naturalSize.w * scale
  const displayH = naturalSize.h * scale

  return (
    <div className="relative inline-block" style={{ width: displayW || undefined, height: displayH || undefined }}>
      <img
        src={`data:image/png;base64,${imageBase64.replace(/^data:image\/\w+;base64,/, '')}`}
        alt="结算单原图"
        width={displayW || undefined}
        height={displayH || undefined}
        style={naturalSize.w > 0 ? { width: displayW, height: displayH } : undefined}
        className="rounded-lg border border-slate-200"
        onLoad={handleLoad}
      />
      {naturalSize.w > 0 && (
        <svg
          className="absolute inset-0 pointer-events-none"
          width={displayW}
          height={displayH}
          viewBox={`0 0 ${displayW} ${displayH}`}
        >
          {/* 全文文本块 */}
          {blocks.map((block, i) => {
            if (!block.polygon || block.polygon.length < 4) return null
            const pts = block.polygon.map((p) => `${p.X * scale},${p.Y * scale}`).join(' ')
            return (
              <polygon
                key={`b-${i}`}
                points={pts}
                fill="rgba(148,163,184,0.08)"
                stroke="rgba(148,163,184,0.15)"
                strokeWidth="0.5"
              />
            )
          })}

          {/* 字段高亮区域 */}
          {Object.entries(fieldCoords).map(([field, poly]) => {
            if (!poly || poly.length < 4) return null
            const pts = poly.map((p) => `${p.X * scale},${p.Y * scale}`).join(' ')
            const isHighlighted = highlightedField === field
            return (
              <g key={`f-${field}`} style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={() => onFieldClick(field)}>
                <polygon
                  points={pts}
                  fill={isHighlighted ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.08)'}
                  stroke={isHighlighted ? 'rgba(59,130,246,0.8)' : 'rgba(59,130,246,0.3)'}
                  strokeWidth={isHighlighted ? 2 : 1}
                />
                {isHighlighted && (
                  <text
                    x={poly[0].X * scale}
                    y={poly[0].Y * scale - 4}
                    fontSize={10 * scale}
                    fill="rgb(37,99,235)"
                    fontWeight="600"
                  >
                    {FIELD_LABELS[field] || field}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

export default function UploadPage() {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null)
  const [error, setError] = useState('')
  const [editedFields, setEditedFields] = useState<Record<string, string>>({})
  const [highlightedField, setHighlightedField] = useState<string | null>(null)
  const [imgScale, setImgScale] = useState(1)
  const [itemMatches, setItemMatches] = useState<Record<number, ItemTemplate>>({})
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const { currentVehicleId } = useStore()
  const qc = useQueryClient()
  const imageContainerRef = useRef<HTMLDivElement>(null)

  // OCR 完成后匹配项目字典
  useEffect(() => {
    if (step === 3 && ocrResult?.items && ocrResult.items.length > 0) {
      matchItemTemplates(ocrResult.items).then((matched) => {
        const map: Record<number, ItemTemplate> = {}
        ocrResult.items.forEach((text, i) => {
          if (matched[text]?.length) map[i] = matched[text][0]
        })
        setItemMatches(map)
      }).catch(() => {})
    }
  }, [step, ocrResult?.items])

  // 获取图片原始尺寸（从 ocrResult 首次加载时）
  useEffect(() => {
    if (ocrResult?.image_base64) {
      const img = new Image()
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
        // 默认适应宽度
        if (imageContainerRef.current) {
          const containerW = imageContainerRef.current.clientWidth
          if (img.naturalWidth > 0) {
            setImgScale(containerW / img.naturalWidth)
          }
        }
      }
      img.src = `data:image/png;base64,${ocrResult.image_base64}`
    }
  }, [ocrResult?.image_base64])

  const zoomIn = useCallback(() => setImgScale((s) => Math.min(s + 0.25, 5)), [])
  const zoomOut = useCallback(() => setImgScale((s) => Math.max(s - 0.25, 0.1)), [])
  const fitWidth = useCallback(() => {
    if (imageContainerRef.current && naturalSize.w > 0) {
      setImgScale(imageContainerRef.current.clientWidth / naturalSize.w)
    }
  }, [naturalSize.w])
  const fitPage = useCallback(() => {
    if (imageContainerRef.current && naturalSize.w > 0 && naturalSize.h > 0) {
      const cw = imageContainerRef.current.clientWidth
      const ch = imageContainerRef.current.clientHeight
      const scaleW = cw / naturalSize.w
      const scaleH = ch / naturalSize.h
      setImgScale(Math.min(scaleW, scaleH))
    }
  }, [naturalSize])

  const ocrMut = useMutation({
    mutationFn: uploadAndOCR,
    onSuccess: (data) => {
      if (data.error) {
        setError(data.error)
        setStep(1)
      } else {
        setOcrResult(data)
        setEditedFields({ ...data.fields })
        setImgScale(1)
        setStep(3)
      }
    },
    onError: (err) => setError(err.message),
  })

  const saveMut = useMutation({
    mutationFn: () =>
      createRecord({
        vehicle_id: currentVehicleId || 1,
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
        type: '保养',
        items: ocrResult?.items.map((name, i) => {
          const t = itemMatches[i]
          return {
            name,
            parts_number: t?.parts_number || '',
            operation_type: t?.operation_type || '',
            quantity: 1,
            unit_price: t?.reference_unit_price || 0,
            parts_cost: t?.reference_parts_cost || 0,
            labor_cost: t?.reference_labor_cost || 0,
            other_cost: 0,
            subtotal: (t?.reference_parts_cost || 0) + (t?.reference_labor_cost || 0),
          }
        }) || [],
      }),
    onSuccess: () => {
      setStep(4)
      qc.invalidateQueries({ queryKey: ['records'] })
    },
  })

  const handleFile = useCallback((f: FileList | null) => {
    if (f && f[0]) {
      setFile(f[0])
      setStep(2)
      setError('')
      ocrMut.mutate(f[0])
    }
  }, [ocrMut])

  const handleFieldClick = useCallback((field: string) => {
    setHighlightedField((prev) => (prev === field ? null : field))
  }, [])

  const fieldInputRefs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (highlightedField && fieldInputRefs.current[highlightedField]) {
      fieldInputRefs.current[highlightedField]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedField])

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">上传录入</h2>
        <p className="text-sm text-slate-500 mt-1">通过 OCR 自动识别结算单信息，支持原图比对校验</p>
      </div>

      {/* 步骤条 */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          {['上传图片', 'OCR 识别', '确认数据', '保存入库'].map((label, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                step > idx + 1 ? 'bg-emerald-500 text-white' :
                step === idx + 1 ? 'bg-blue-600 text-white' :
                'bg-slate-100 text-slate-400'
              }`}>
                {step > idx + 1 ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
              </div>
              <span className={`text-sm ${step >= idx + 1 ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">{error}</div>
      )}

      {/* 上传区域 */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8">
          <label className="block border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer">
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => handleFile(e.target.files)} />
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="w-7 h-7 text-blue-600" />
            </div>
            <p className="text-base font-medium text-slate-800 mb-1">点击上传或拖拽结算单到此处</p>
            <p className="text-sm text-slate-500">支持 JPG / PNG / PDF 格式</p>
          </label>
        </div>
      )}

      {/* OCR 识别中 */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <FileText className="w-7 h-7 text-blue-600" />
          </div>
          <p className="text-base font-medium text-slate-800 mb-2">OCR 识别中...</p>
          <p className="text-sm text-slate-500">正在调用文档抽取服务提取结构化字段</p>
        </div>
      )}

      {/* 确认识别结果 — 左右各50%分栏 */}
      {step === 3 && ocrResult && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <MousePointer className="w-4 h-4 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-800">确认识别结果</h3>
            <span className="text-xs text-slate-400 ml-2">点击左侧高亮区域或右侧字段可相互定位</span>
          </div>

          <div className="flex gap-6 mb-6" style={{ height: '70vh' }}>
            {/* 左侧：原图 + 标注（50%宽度，可滚动） */}
            <div className="w-1/2 flex flex-col min-w-0">
              {/* 缩放工具栏 */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">结算单原图</span>
                <ZoomToolbar
                  scale={imgScale}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onFitWidth={fitWidth}
                  onFitPage={fitPage}
                />
              </div>
              {/* 图片容器 */}
              <div
                ref={imageContainerRef}
                className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2"
              >
                {ocrResult.image_base64 ? (
                  <ImageAnnotation
                    imageBase64={ocrResult.image_base64}
                    blocks={ocrResult.blocks}
                    fieldCoords={ocrResult.field_coords}
                    highlightedField={highlightedField}
                    onFieldClick={handleFieldClick}
                    scale={imgScale}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                    无图片预览
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：字段表单（50%宽度） */}
            <div className="w-1/2 flex flex-col min-w-0">
              <span className="text-xs text-slate-500 mb-2">识别字段</span>
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {Object.entries(editedFields).map(([key, val]) => {
                  const isHighlighted = highlightedField === key
                  return (
                    <div
                      key={key}
                      ref={(el) => { fieldInputRefs.current[key] = el }}
                      className={`rounded-lg border p-3 transition-all ${
                        isHighlighted ? 'border-blue-400 bg-blue-50 shadow-sm' : 'border-slate-200 bg-slate-50'
                      }`}
                      onMouseEnter={() => setHighlightedField(key)}
                      onMouseLeave={() => setHighlightedField(null)}
                    >
                      <label className="text-xs text-slate-500 mb-1 block">{FIELD_LABELS[key] || key}</label>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => setEditedFields({ ...editedFields, [key]: e.target.value })}
                        className={`w-full px-2 py-1 rounded border text-sm focus:outline-none focus:border-blue-400 ${
                          isHighlighted ? 'border-blue-300 bg-white' : 'border-slate-200 bg-white'
                        }`}
                      />
                    </div>
                  )
                })}

                {ocrResult.items.length > 0 && (
                  <div className="pt-3 border-t border-slate-100">
                    <label className="text-xs text-slate-500 mb-2 block">保养项目（共 {ocrResult.items.length} 项）</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ocrResult.items.map((item, i) => {
                        const matched = itemMatches[i]
                        return (
                          <span key={i} className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1 ${
                            matched ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                          }`} title={matched ? `已匹配: ${matched.name}${matched.operation_type ? ` (${matched.operation_type})` : ''}` : '未匹配字典，将手动录入'}>
                            {item}
                            {matched && <CheckCircle2 className="w-3 h-3" />}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <details className="mb-6">
            <summary className="text-xs text-slate-500 cursor-pointer">查看 OCR 原始文本</summary>
            <pre className="mt-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 whitespace-pre-wrap max-h-48 overflow-auto">
              {ocrResult.raw_text}
            </pre>
          </details>

          <div className="flex gap-3 justify-end">
            <button onClick={() => { setStep(1); setOcrResult(null); setEditedFields({}); setHighlightedField(null); setItemMatches({}) }} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">重新上传</button>
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">确认入库</button>
          </div>
        </div>
      )}

      {/* 成功 */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-slate-800 mb-2">录入成功！</p>
          <p className="text-sm text-slate-500 mb-6">保养记录已保存到数据库</p>
          <button onClick={() => { setStep(1); setOcrResult(null); setFile(null); setEditedFields({}); setHighlightedField(null); setItemMatches({}) }} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">继续上传</button>
        </div>
      )}
    </div>
  )
}
