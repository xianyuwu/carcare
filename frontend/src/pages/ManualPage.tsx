import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Upload, Trash2, RefreshCw, Globe, FileText, ChevronRight, ChevronLeft, Eye, X, Loader2, Settings, Calendar, Hash, Layers, Link, CheckCircle2, Circle, AlertCircle } from 'lucide-react'
import { getManuals, uploadManual, deleteManual, reindexManual, addWebKnowledge, previewChunks, updateManual, indexManualProgress, reindexAllProgress, type Manual, type ChunkPreview, type IndexProgressEvent } from '../api/client'
import { useStore } from '../hooks/useStore'
import { useState, useRef, useEffect } from 'react'

// 默认分段配置
const DEFAULT_CHUNK_SIZE = 500
const DEFAULT_CHUNK_OVERLAP = 100
const DEFAULT_SEPARATORS = '\\n\\n,\\n'

export default function ManualPage() {
  const { currentVehicleId } = useStore()
  const qc = useQueryClient()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedManual, setSelectedManual] = useState<Manual | null>(null)

  const { data: manuals, isLoading } = useQuery({
    queryKey: ['manuals', currentVehicleId],
    queryFn: () => getManuals(currentVehicleId || undefined),
  })

  const deleteMut = useMutation({
    mutationFn: deleteManual,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manuals'] }),
  })

  const reindexMut = useMutation({
    mutationFn: reindexManual,
    onMutate: async (manualId) => {
      await qc.cancelQueries({ queryKey: ['manuals'] })
      qc.setQueryData(['manuals', currentVehicleId], (old: Manual[] | undefined) => {
        if (!old) return old
        return old.map(m => m.id === manualId ? { ...m, status: 'indexing' } : m)
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manuals'] }),
  })

  // 有手册正在索引时，3 秒轮询自动刷新状态
  const hasIndexing = (manuals || []).some(m => m.status === 'indexing' || m.status === 'pending')
  useEffect(() => {
    if (!hasIndexing) return
    const timer = setInterval(() => qc.invalidateQueries({ queryKey: ['manuals'] }), 3000)
    return () => clearInterval(timer)
  }, [hasIndexing, qc])

  // 批量重建索引
  const hasStale = (manuals || []).some(m => m.status === 'stale')
  const [batchReindexing, setBatchReindexing] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const batchAbortRef = useRef<AbortController | null>(null)

  async function handleBatchReindex() {
    setBatchReindexing(true)
    setBatchProgress('准备中...')
    const ac = new AbortController()
    batchAbortRef.current = ac
    try {
      for await (const event of reindexAllProgress(ac.signal)) {
        setBatchProgress(`正在重建 ${event.current}/${event.total}：${event.filename}`)
        // 每完成一个就刷新列表
        if (event.stage === 'done') {
          qc.invalidateQueries({ queryKey: ['manuals'] })
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setBatchProgress(`重建失败：${err.message}`)
      }
    } finally {
      batchAbortRef.current = null
      setBatchReindexing(false)
      setBatchProgress('')
      qc.invalidateQueries({ queryKey: ['manuals'] })
    }
  }

  function handleBatchCancel() {
    batchAbortRef.current?.abort()
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">保养知识</h2>
          <p className="text-sm text-slate-500 mt-1">上传文档或添加网页，AI 将基于知识内容回答问题</p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          <Upload className="w-4 h-4" />
          添加知识
        </button>
      </div>

      {isLoading ? (
        <p className="text-center text-slate-400 py-12">加载中...</p>
      ) : (
        <>
          {/* Embedding 模型变更提醒横幅 */}
          {hasStale && (
            <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>已更换 Embedding 模型，所有文档需要重建索引</span>
                {batchProgress && <span className="text-amber-600 ml-2">{batchProgress}</span>}
              </div>
              {batchReindexing ? (
                <button onClick={handleBatchCancel}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors">
                  取消
                </button>
              ) : (
                <button onClick={handleBatchReindex}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                  全部重建
                </button>
              )}
            </div>
          )}
          <div className="space-y-3">
          {(manuals || []).map((m) => (
            <KnowledgeCard key={m.id} manual={m} onClick={() => setSelectedManual(m)} onDelete={() => deleteMut.mutate(m.id)} onReindex={() => reindexMut.mutate(m.id)} reindexing={reindexMut.isPending} />
          ))}
          {!manuals?.length && (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">暂无知识内容，点击上方按钮添加</p>
            </div>
          )}
          </div>
        </>
      )}

      {/* 三步向导弹窗 */}
      {wizardOpen && (
        <AddKnowledgeWizard
          vehicleId={currentVehicleId || 1}
          onClose={() => setWizardOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['manuals'] })
            setWizardOpen(false)
          }}
        />
      )}

      {/* 详情/编辑弹窗 */}
      {selectedManual && (
        <ManualDetailModal
          manual={selectedManual}
          onClose={() => setSelectedManual(null)}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ['manuals'] })
            setSelectedManual(null)
          }}
        />
      )}
    </div>
  )
}

/* ============ 知识卡片 ============ */
function KnowledgeCard({ manual, onClick, onDelete, onReindex, reindexing }: { manual: Manual; onClick: () => void; onDelete: () => void; onReindex: () => void; reindexing: boolean }) {
  const isWeb = manual.source_type === 'web'
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between cursor-pointer hover:border-blue-300 hover:shadow-sm transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isWeb ? 'bg-purple-50' : 'bg-blue-50'}`}>
          {isWeb ? <Globe className="w-5 h-5 text-purple-600" /> : <FileText className="w-5 h-5 text-blue-600" />}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-800">
            {isWeb && manual.source_url ? (
              <a href={manual.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">
                {manual.filename.replace(/\.txt$/, '')}
              </a>
            ) : (
              <a href={`#pdf-viewer/${manual.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">
                {manual.filename}
              </a>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {manual.page_count > 0 ? `${manual.page_count} 页 · ` : ''}{manual.chunk_count} 分块 · 分块 {manual.chunk_size}/{manual.chunk_overlap} ·
            <span className={`ml-1 ${manual.status === 'ready' ? 'text-emerald-600' : manual.status === 'indexing' ? 'text-amber-600' : manual.status === 'stale' ? 'text-amber-600' : manual.status === 'pending' ? 'text-slate-400' : 'text-red-500'}`}>
              {manual.status === 'ready' ? '已就绪' : manual.status === 'indexing' ? '索引中' : manual.status === 'stale' ? '需重建' : manual.status === 'pending' ? '待索引' : '错误'}
            </span>
            {manual.status === 'error' && manual.error_message && (
              <span className="ml-1 text-xs text-red-400" title={manual.error_message}>
                ({manual.error_message.length > 50 ? manual.error_message.slice(0, 50) + '...' : manual.error_message})
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onReindex() }}
          disabled={manual.status === 'indexing' || reindexing}
          className="text-blue-400 hover:text-blue-600 disabled:opacity-50"
          title="重新索引"
        >
          <RefreshCw className={`w-4 h-4 ${manual.status === 'indexing' ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="text-red-400 hover:text-red-600" title="删除">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

/* ============ 三步向导 ============ */
type WizardStep = 1 | 2 | 3
type SourceType = 'document' | 'web'

function AddKnowledgeWizard({ vehicleId, onClose, onSuccess }: { vehicleId: number; onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<WizardStep>(1)
  const [sourceType, setSourceType] = useState<SourceType>('document')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [chunkSize, setChunkSize] = useState(DEFAULT_CHUNK_SIZE)
  const [chunkOverlap, setChunkOverlap] = useState(DEFAULT_CHUNK_OVERLAP)
  const [separators, setSeparators] = useState(DEFAULT_SEPARATORS)
  const [previewResult, setPreviewResult] = useState<{ total_chunks: number; chunks: ChunkPreview[] } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState('')
  const [indexProgress, setIndexProgress] = useState<IndexProgressEvent | null>(null)
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Step 1: 验证是否可以下一步
  const canNext1 = sourceType === 'document' ? !!file : url.trim().length > 0

  // 预览分块
  async function handlePreview() {
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const result = await previewChunks(
        sourceType === 'document' ? file : null,
        sourceType === 'web' ? url : null,
        { chunk_size: chunkSize, chunk_overlap: chunkOverlap, separators }
      )
      setPreviewResult(result)
    } catch (err: any) {
      setPreviewError(err.message || '预览失败')
    }
    setPreviewLoading(false)
  }

  // 提交处理：先上传拿 manual ID，再开 SSE 消费进度
  async function handleSubmit() {
    setProcessing(true)
    setProcessError('')
    setIndexProgress(null)
    try {
      // 第一步：上传文件或抓取 URL，获取 manual ID
      let manualId: number
      if (sourceType === 'document' && file) {
        const manual = await uploadManual(vehicleId, file, { chunk_size: chunkSize, chunk_overlap: chunkOverlap, separators })
        manualId = manual.id
      } else if (sourceType === 'web' && url) {
        const manual = await addWebKnowledge({ vehicle_id: vehicleId, url, chunk_size: chunkSize, chunk_overlap: chunkOverlap, separators })
        manualId = manual.id
      } else {
        return
      }

      // 第二步：SSE 消费索引进度
      const ac = new AbortController()
      abortRef.current = ac
      for await (const event of indexManualProgress(manualId, ac.signal)) {
        setIndexProgress(event)
      }
      // SSE 正常结束 = 处理完成
      setProcessing(false)
    } catch (err: any) {
      // 用户主动取消（退出后台处理）不报错
      if (err.name === 'AbortError') return
      setProcessError(err.message || '处理失败')
      setProcessing(false)
    }
  }

  // 退出后台处理：中断 SSE 连接，关闭弹窗，后台继续执行
  function handleBackgroundExit() {
    abortRef.current?.abort()
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">添加知识</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* 步骤指示器 */}
        <div className="px-6 pt-4">
          <div className="flex items-center">
            {[
              { n: 1, label: '选择类型' },
              { n: 2, label: '分段设置' },
              { n: 3, label: '处理' },
            ].map((s, i) => (
              <div key={s.n} className={`flex items-center ${i > 0 ? 'flex-1 min-w-0' : 'shrink-0'}`}>
                {i > 0 && (
                  <div className={`flex-1 h-0.5 mx-4 ${step >= s.n ? 'bg-blue-600' : 'bg-slate-200'}`} />
                )}
                <div className={`flex items-center gap-2 shrink-0 ${step >= s.n ? 'text-blue-600' : 'text-slate-400'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step > s.n ? 'bg-blue-600 text-white' : step === s.n ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {step > s.n ? '✓' : s.n}
                  </div>
                  <span className="text-sm whitespace-nowrap">{s.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto px-6 py-5">
          {/* Step 1: 选择知识类型 */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setSourceType('document')}
                  className={`p-6 rounded-xl border-2 text-center transition-colors ${sourceType === 'document' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <FileText className={`w-8 h-8 mx-auto mb-2 ${sourceType === 'document' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <p className="font-medium text-slate-700">文档上传</p>
                  <p className="text-xs text-slate-500 mt-1">支持 PDF 格式</p>
                </button>
                <button
                  onClick={() => setSourceType('web')}
                  className={`p-6 rounded-xl border-2 text-center transition-colors ${sourceType === 'web' ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <Globe className={`w-8 h-8 mx-auto mb-2 ${sourceType === 'web' ? 'text-purple-600' : 'text-slate-400'}`} />
                  <p className="font-medium text-slate-700">Web 地址</p>
                  <p className="text-xs text-slate-500 mt-1">输入网页 URL</p>
                </button>
              </div>

              {sourceType === 'document' && (
                <div>
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-4 border-2 border-dashed border-slate-300 rounded-xl text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                  >
                    {file ? (
                      <div className="flex items-center justify-center gap-2 text-blue-600">
                        <FileText className="w-5 h-5" />
                        <span className="text-sm font-medium">{file.name}</span>
                        <span className="text-xs text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
                      </div>
                    ) : (
                      <div className="text-slate-400">
                        <Upload className="w-6 h-6 mx-auto mb-1" />
                        <p className="text-sm">点击选择 PDF 文件</p>
                      </div>
                    )}
                  </button>
                </div>
              )}

              {sourceType === 'web' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">网页地址</label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/article"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 2: 分段设置 + 预览 */}
          {step === 2 && (
            <div className="space-y-5">
              {/* 参数配置 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    最大块长度 <span className="text-slate-400 text-xs font-normal">(Chunk Size)</span>
                    <span className="relative group ml-1 inline-block">
                      <span className="cursor-help text-slate-400">ⓘ</span>
                      <span className="absolute left-0 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg p-3 w-64 z-50 shadow-lg whitespace-normal leading-relaxed">
                        控制每个文本块的最大字符数。值越大，每块包含的信息越多，但检索时可能混入无关内容；值越小，语义可能被截断。保养手册建议 500-800。
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Number(e.target.value))}
                    min={100}
                    max={4000}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">每个文本块的最大字符数</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    重叠长度 <span className="text-slate-400 text-xs font-normal">(Chunk Overlap)</span>
                    <span className="relative group ml-1 inline-block">
                      <span className="cursor-help text-slate-400">ⓘ</span>
                      <span className="absolute right-0 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg p-3 w-64 z-50 shadow-lg whitespace-normal leading-relaxed">
                        相邻文本块之间重叠的字符数。防止关键信息正好落在切分边界上被拆散。一般设为 Chunk Size 的 10%-20%。
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(Number(e.target.value))}
                    min={0}
                    max={1000}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">相邻块之间的重叠字符数</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  分段标识符 <span className="text-slate-400 text-xs font-normal">(Separators)</span>
                  <span className="relative group ml-1 inline-block">
                    <span className="cursor-help text-slate-400">ⓘ</span>
                    <span className="absolute left-0 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg p-3 w-64 z-50 shadow-lg whitespace-normal leading-relaxed">
                      文本分块的优先切割标记，按顺序依次尝试。<code className="bg-slate-700 px-1 rounded">{'\\n\\n'}</code> 优先按段落切，<code className="bg-slate-700 px-1 rounded">{'\\n'}</code> 按行切。自定义标识符如 <code className="bg-slate-700 px-1 rounded">***</code> 可匹配文档中的特殊分隔线。
                    </span>
                  </span>
                </label>
                <input
                  type="text"
                  value={separators}
                  onChange={(e) => setSeparators(e.target.value)}
                  placeholder="\\n\\n,\\n"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  用逗号分隔多个标识符，按顺序优先匹配。<code className="bg-slate-100 px-1 rounded">\n</code> 换行、<code className="bg-slate-100 px-1 rounded">\n\n</code> 段落，也可自定义如 <code className="bg-slate-100 px-1 rounded">***</code>
                </p>
              </div>

              {/* 预览按钮 */}
              <button
                onClick={handlePreview}
                disabled={previewLoading}
                className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-600 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50"
              >
                {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                预览分块
              </button>

              {previewError && <p className="text-sm text-red-500">{previewError}</p>}

              {/* 预览结果 */}
              {previewResult && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-700">预览结果</p>
                    <span className="text-xs text-slate-500">共 {previewResult.total_chunks} 个块{previewResult.total_chunks > 20 ? '（显示前 20 个）' : ''}</span>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-auto">
                    {previewResult.chunks.map((chunk) => {
                      const expanded = expandedChunks.has(chunk.index)
                      return (
                        <div
                          key={chunk.index}
                          className="p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                          onClick={() => setExpandedChunks(prev => {
                            const next = new Set(prev)
                            if (next.has(chunk.index)) next.delete(chunk.index)
                            else next.add(chunk.index)
                            return next
                          })}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-slate-500">#{chunk.index + 1}</span>
                            <span className="text-xs text-slate-400">{chunk.char_count} 字符</span>
                            {chunk.has_table && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">含表格</span>}
                            {chunk.text.length > 200 && (
                              <span className="text-xs text-blue-500 ml-auto">{expanded ? '收起' : '展开全部'}</span>
                            )}
                          </div>
                          {expanded ? (
                            <p className="text-xs text-slate-600 whitespace-pre-wrap break-all">{chunk.text}</p>
                          ) : (
                            <p className="text-xs text-slate-600 line-clamp-3 whitespace-pre-wrap">{chunk.text.slice(0, 200)}{chunk.text.length > 200 ? '...' : ''}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: 处理进度 */}
          {step === 3 && (
            <div className="py-6">
              {processError ? (
                // 错误状态
                <div className="text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center mx-auto">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <p className="text-sm text-red-600">{processError}</p>
                </div>
              ) : processing ? (
                // 处理中——显示分阶段进度
                <ProgressStages progress={indexProgress} />
              ) : (
                // 完成
                <div className="text-center space-y-3">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">处理完成</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={() => step === 1 ? onClose() : setStep((step - 1) as WizardStep)}
            className="flex items-center gap-1 px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? '取消' : '上一步'}
          </button>
          {step === 1 && (
            <button
              onClick={() => setStep((step + 1) as WizardStep)}
              disabled={!canNext1 && step === 1}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {step === 3 && !processing && !processError && (
            <button
              onClick={onSuccess}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              完成
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
          {step === 3 && processing && (
            <button
              onClick={handleBackgroundExit}
              className="flex items-center gap-1 px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              退出后台处理
            </button>
          )}
          {step === 3 && processError && (
            <button
              onClick={() => { setProcessError(''); handleSubmit() }}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              重试
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 2 && (
            <button
              onClick={() => { setStep(3); handleSubmit() }}
              disabled={!canNext1}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              开始处理
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============ 详情/编辑弹窗 ============ */
function ManualDetailModal({ manual, onClose, onUpdated }: { manual: Manual; onClose: () => void; onUpdated: () => void }) {
  const isWeb = manual.source_type === 'web'
  const [chunkSize, setChunkSize] = useState(manual.chunk_size)
  const [chunkOverlap, setChunkOverlap] = useState(manual.chunk_overlap)
  const [separators, setSeparators] = useState(manual.separators)
  const [previewResult, setPreviewResult] = useState<{ total_chunks: number; chunks: ChunkPreview[] } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // 判断配置是否有改动
  const configChanged = chunkSize !== manual.chunk_size || chunkOverlap !== manual.chunk_overlap || separators !== manual.separators

  async function handlePreview() {
    setPreviewLoading(true)
    setPreviewError('')
    try {
      // 用当前文件/URL预览新参数下的分块效果
      const result = await previewChunks(
        isWeb ? null : null,
        isWeb ? manual.source_url : null,
        { chunk_size: chunkSize, chunk_overlap: chunkOverlap, separators }
      )
      setPreviewResult(result)
    } catch (err: any) {
      setPreviewError(err.message || '预览失败')
    }
    setPreviewLoading(false)
  }

  async function handleSave(reindex: boolean) {
    setSaving(true)
    setSaveError('')
    try {
      await updateManual(manual.id, {
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        separators,
        reindex,
      })
      onUpdated()
    } catch (err: any) {
      setSaveError(err.message || '保存失败')
      setSaving(false)
    }
  }

  const statusLabel = manual.status === 'ready' ? '已就绪' : manual.status === 'indexing' ? '索引中' : manual.status === 'pending' ? '待索引' : '错误'
  const statusColor = manual.status === 'ready' ? 'text-emerald-700 bg-emerald-50' : manual.status === 'indexing' ? 'text-amber-700 bg-amber-50' : manual.status === 'pending' ? 'text-slate-600 bg-slate-50' : 'text-red-700 bg-red-50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isWeb ? 'bg-purple-50' : 'bg-blue-50'}`}>
              {isWeb ? <Globe className="w-4 h-4 text-purple-600" /> : <FileText className="w-4 h-4 text-blue-600" />}
            </div>
            <h3 className="text-lg font-semibold text-slate-800">{manual.filename}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
          {/* 基本信息区 */}
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-3">基本信息</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Layers className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">来源类型</span>
                <span className="text-slate-800 font-medium">{isWeb ? 'Web 页面' : 'PDF 文档'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>{statusLabel}</span>
              </div>
              {isWeb && manual.source_url && (
                <div className="flex items-center gap-2 text-sm col-span-2">
                  <Link className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-500 flex-shrink-0">来源</span>
                  <a href={manual.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate">{manual.source_url}</a>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">上传时间</span>
                <span className="text-slate-800">{manual.upload_date ? new Date(manual.upload_date).toLocaleString('zh-CN') : '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Hash className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">{manual.page_count > 0 ? `${manual.page_count} 页 · ` : ''}{manual.chunk_count} 分块</span>
              </div>
            </div>
            {/* 错误信息 */}
            {manual.status === 'error' && manual.error_message && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-700 font-medium mb-1">错误详情</p>
                <p className="text-xs text-red-600 whitespace-pre-wrap break-all">{manual.error_message}</p>
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className="border-t border-slate-200" />

          {/* 分块配置区（可编辑） */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Settings className="w-4 h-4 text-slate-500" />
              <h4 className="text-sm font-medium text-slate-700">分块配置</h4>
              {configChanged && <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">已修改</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  最大块长度 <span className="text-slate-400 text-xs font-normal">(Chunk Size)</span>
                  <span className="relative group ml-1 inline-block">
                    <span className="cursor-help text-slate-400">ⓘ</span>
                    <span className="absolute left-0 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg p-3 w-64 z-50 shadow-lg whitespace-normal leading-relaxed">
                      控制每个文本块的最大字符数。值越大，每块包含的信息越多，但检索时可能混入无关内容；值越小，语义可能被截断。保养手册建议 500-800。
                    </span>
                  </span>
                </label>
                <input
                  type="number"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                  min={100}
                  max={4000}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  重叠长度 <span className="text-slate-400 text-xs font-normal">(Chunk Overlap)</span>
                  <span className="relative group ml-1 inline-block">
                    <span className="cursor-help text-slate-400">ⓘ</span>
                    <span className="absolute right-0 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg p-3 w-64 z-50 shadow-lg whitespace-normal leading-relaxed">
                      相邻文本块之间重叠的字符数。防止关键信息正好落在切分边界上被拆散。一般设为 Chunk Size 的 10%-20%。
                    </span>
                  </span>
                </label>
                <input
                  type="number"
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  min={0}
                  max={1000}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm text-slate-600 mb-1">
                分段标识符 <span className="text-slate-400 text-xs font-normal">(Separators)</span>
                <span className="relative group ml-1 inline-block">
                  <span className="cursor-help text-slate-400">ⓘ</span>
                  <span className="absolute left-0 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg p-3 w-64 z-50 shadow-lg whitespace-normal leading-relaxed">
                    文本分块的优先切割标记，按顺序依次尝试。<code className="bg-slate-700 px-1 rounded">{'\\n\\n'}</code> 优先按段落切，<code className="bg-slate-700 px-1 rounded">{'\\n'}</code> 按行切。自定义标识符如 <code className="bg-slate-700 px-1 rounded">***</code> 可匹配文档中的特殊分隔线。
                  </span>
                </span>
              </label>
              <input
                type="text"
                value={separators}
                onChange={(e) => setSeparators(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                用逗号分隔多个标识符。<code className="bg-slate-100 px-1 rounded">\n</code> 换行、<code className="bg-slate-100 px-1 rounded">\n\n</code> 段落
              </p>
            </div>

            {/* 预览分块（仅 Web 类型支持基于 URL 预览） */}
            {isWeb && (
              <div className="mt-3">
                <button
                  onClick={handlePreview}
                  disabled={previewLoading}
                  className="flex items-center gap-2 px-3 py-1.5 border border-blue-300 text-blue-600 rounded-lg text-xs hover:bg-blue-50 disabled:opacity-50"
                >
                  {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                  预览分块
                </button>
                {previewError && <p className="text-xs text-red-500 mt-2">{previewError}</p>}
                {previewResult && (
                  <div className="mt-2">
                    <p className="text-xs text-slate-500 mb-1">共 {previewResult.total_chunks} 个块</p>
                    <div className="space-y-1.5 max-h-40 overflow-auto">
                      {previewResult.chunks.map((chunk) => (
                        <div key={chunk.index} className="p-2 bg-slate-50 rounded border border-slate-200">
                          <span className="text-xs text-slate-500">#{chunk.index + 1} · {chunk.char_count} 字符</span>
                          <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{chunk.text.slice(0, 150)}{chunk.text.length > 150 ? '...' : ''}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
            取消
          </button>
          <div className="flex items-center gap-2">
            {saveError && <span className="text-xs text-red-500">{saveError}</span>}
            {configChanged && (
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                仅保存
              </button>
            )}
            <button
              onClick={() => handleSave(configChanged)}
              disabled={saving}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {configChanged ? '保存并重新索引' : '重新索引'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ============ 进度阶段可视化 ============ */
const STAGES = [
  { key: 'extracting', label: '提取文本' },
  { key: 'chunking', label: '分块处理' },
  { key: 'embedding', label: '向量化索引' },
  { key: 'done', label: '完成' },
]

function ProgressStages({ progress }: { progress: IndexProgressEvent | null }) {
  const stage = progress?.stage || 'pending'
  const currentIdx = stage === 'error' ? -1 : STAGES.findIndex(s => s.key === stage)

  return (
    <div className="space-y-5">
      {STAGES.map((s, i) => {
        const completed = i < currentIdx || (i === STAGES.length - 1 && stage === 'done')
        const active = i === currentIdx
        const pending = i > currentIdx

        return (
          <div key={s.key} className="flex items-start gap-3">
            {/* 状态图标 */}
            <div className="mt-0.5 shrink-0">
              {completed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : active ? (
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              ) : (
                <Circle className="w-5 h-5 text-slate-300" />
              )}
            </div>
            {/* 阶段内容 */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${completed ? 'text-emerald-700' : active ? 'text-blue-700' : 'text-slate-400'}`}>
                {s.label}
              </p>
              {/* 当前阶段的详细信息 */}
              {active && progress && (
                <div className="mt-1.5">
                  <p className="text-xs text-slate-500">{progress.message}</p>
                  {/* embedding 阶段显示进度条 */}
                  {s.key === 'embedding' && progress.total > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full transition-all duration-300"
                            style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums">{progress.current}/{progress.total}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* 已完成阶段显示对勾信息 */}
              {completed && i < STAGES.length - 1 && progress && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {i === 0 && stage !== 'pending' ? '已完成' : ''}
                  {i === 1 && stage === 'embedding' ? '已完成' : i === 1 && stage === 'done' ? '已完成' : ''}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
