import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, Sparkles, User, ZoomIn, ZoomOut, Wrench, TrendingUp, Droplets, FileText, ChevronRight, Paintbrush, ThumbsUp, ThumbsDown, Copy, Check, AlertCircle, RefreshCw, Square, BookOpen, ExternalLink, ChevronDown, ChevronUp, Globe, Search, Link, Minimize2, Maximize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore, type ChatMessage } from '../hooks/useStore'
import { chatStream, submitChatFeedback, getManualPageUrl, getManualFileUrl, getToken, type Source, type SearchSource } from '../api/client'

// 全局事件总线：挂 window 上避免 Vite HMR 重建导致监听丢失
const _win = window as any
if (!_win.__citationBus) _win.__citationBus = new EventTarget()
const citationBus: EventTarget = _win.__citationBus

export function emitCitationOpen(item: CitationItem) {
  citationBus.dispatchEvent(new CustomEvent('open', { detail: item }))
}

const welcomeCards = [
  { icon: Wrench, text: '我下次该做什么保养？', question: '根据我的保养记录，下次保养需要做什么项目？大概什么时候需要去？' },
  { icon: TrendingUp, text: '帮我分析养车成本', question: '帮我分析一下我的养车成本，包括花费趋势和各项占比，看看有没有优化空间。' },
  { icon: Droplets, text: '机油多久换一次合适？', question: '机油多久换一次比较合适？不同类型的机油更换周期有什么区别？' },
  { icon: FileText, text: '生成本月养车报告', question: '根据我的保养记录，生成一份养车报告总结，包括花费统计和保养建议。' },
]

const MESSAGE_WARNING_THRESHOLD = 50

// --- 引用标注组件（纯展示，modal 由 ChatPanel 渲染） ---
function CitationBadge({ source }: { source: CitationItem }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (ref.current) {
      console.log('[CitationBadge] mounted source id:', source.id, 'element:', ref.current)
    }
  }, [source.id])
  return (
    <sup
      ref={ref}
      className="cursor-pointer inline-flex items-center justify-center rounded-full bg-indigo-300 text-indigo-700 hover:bg-indigo-400 transition-colors ml-0.5 px-[5px] py-[1px] text-[11px] leading-none font-normal select-none"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        console.log('[CitationBadge] clicked source id:', source.id)
        emitCitationOpen(source)
      }}
      title={`查看引用来源 ${source.id}`}
    >
      {source.id}
    </sup>
  )
}

// --- 引用来源 Modal：PDF 页面 / 网页知识库 / 搜索来源 ---
function SourceModal({ source, onClose }: { source: CitationItem; onClose: () => void }) {
  const isSearch = isSearchCitation(source)
  const isWeb = !isSearch && (source as Source).source_type === 'web'
  const isPdf = !isSearch && !isWeb

  // PDF 来源：渲染页面图片（用 fetch + auth header 拿 blob，避免 <img> 不带 token）
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)

  // 带鉴权的页面图片 URL（blob URL）
  const [pageBlobUrl, setPageBlobUrl] = useState<string | null>(null)

  const rawPageUrl = isPdf && (source as Source).manual_id && (source as Source).page != null
    ? getManualPageUrl((source as Source).manual_id, (source as Source).page, (source as Source).text)
    : null

  useEffect(() => {
    if (!rawPageUrl) return
    const token = getToken()
    if (!token) { setImgError('未登录'); setLoading(false); return }
    let blobUrl = ''
    fetch(rawPageUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error(`加载失败 (${res.status})`)
        return res.blob()
      })
      .then(blob => {
        blobUrl = URL.createObjectURL(blob)
        setPageBlobUrl(blobUrl)
      })
      .catch(err => {
        setImgError(err.message)
        setLoading(false)
      })
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [rawPageUrl])

  const externalUrl = isSearch ? source.url : (isWeb ? (source as Source).source_url : null)

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }) }

  const onDragStart = (e: React.MouseEvent) => {
    if (scale <= 1) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setOffset({
        x: dragRef.current.offsetX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.offsetY + (ev.clientY - dragRef.current.startY),
      })
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 顶部标题和标签
  const title = isSearch ? source.title : (source as Source).filename
  const badge = isSearch
    ? <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">搜索来源</span>
    : isWeb
      ? <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs font-medium">网页来源</span>
      : (source as Source).page != null
        ? <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium">第 {(source as Source).page + 1} 页</span>
        : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-xl shadow-2xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部信息栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            {isSearch ? <Globe className="w-4 h-4" /> : isWeb ? <Link className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
            <span className="truncate max-w-[320px] font-medium" title={title}>{title}</span>
            {badge}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PDF 来源：渲染页面图片 */}
        {isPdf && rawPageUrl && (
          <div className="flex-1 overflow-hidden bg-slate-100 relative flex flex-col items-center">
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow-md border border-slate-200 px-2 py-1">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className="w-7 h-7 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors" title="缩小">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-slate-500 w-10 text-center select-none tabular-nums">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="w-7 h-7 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors" title="放大">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-slate-200 mx-0.5" />
              <button onClick={resetView} className="text-xs text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded transition-colors" title="重置">重置</button>
            </div>
            <div className="w-full h-full flex items-center justify-center" style={{ cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }} onMouseDown={onDragStart}>
              {imgError && <p className="text-sm text-slate-400">{imgError}</p>}
              {loading && !imgError && <div className="flex items-center justify-center"><div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /></div>}
              {pageBlobUrl && (
                <img
                  src={pageBlobUrl}
                  alt={`第 ${(source as Source).page! + 1} 页`}
                  className="shadow-lg rounded border border-slate-200 select-none pointer-events-none"
                  style={{ display: loading ? 'none' : 'block', maxWidth: '90%', transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)` }}
                  onLoad={() => setLoading(false)}
                  onError={() => { setImgError('图片加载失败'); setLoading(false) }}
                />
              )}
            </div>
          </div>
        )}

        {/* 网页知识库 / 搜索来源：卡片式预览 */}
        {(isWeb || isSearch) && (
          <div className="flex-1 overflow-auto p-6">
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h3 className="text-base font-medium text-slate-800 mb-3">{title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap break-words">
                {isSearch ? source.content : (source as Source).text}
              </p>
            </div>
            {externalUrl && (
              <div className="mt-4 flex justify-end">
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-700 hover:underline transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  查看原文
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// 统一引用类型，用于 CitationBadge 和弹窗
type CitationItem = Source | (SearchSource & { _kind: 'search' })

function isSearchCitation(item: CitationItem): item is SearchSource & { _kind: 'search' } {
  return '_kind' in item && item._kind === 'search'
}

// --- 带 引用标注的 Markdown 渲染 ---
function CitationMarkdown({ content, sources, searchSources }: {
  content: string
  sources?: Source[]
  searchSources?: SearchSource[]
}) {
  // 构建 id → CitationItem 的映射，合并手册来源和搜索来源
  const citationMap = useMemo(() => {
    const map = new Map<number, CitationItem>()
    if (sources?.length) {
      for (const s of sources) map.set(s.id, s)
    }
    if (searchSources?.length) {
      for (const s of searchSources) map.set(s.id, { ...s, _kind: 'search' })
    }
    return map
  }, [sources, searchSources])

  const processed = useMemo(() => {
    if (!citationMap.size) return content
    return content.replace(/\[(\d+)\]/g, (match, num) => {
      const n = parseInt(num)
      if (citationMap.has(n)) {
        return `[${num}](citation:${num})`
      }
      return match
    })
  }, [content, citationMap])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => url}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith('citation:')) {
            const id = parseInt(href.replace('citation:', ''))
            const item = citationMap.get(id)
            if (item) return <CitationBadge source={item} />
          }
          return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  )
}

// --- 参考资料栏：去重显示引用了哪些文档/网页（仅展示被实际引用的来源） ---
function ReferenceBar({ sources, searchSources, content }: {
  sources: Source[]
  searchSources?: SearchSource[]
  content: string
}) {
  const [expanded, setExpanded] = useState(false)

  // 从回复内容中提取被引用的编号，只展示实际用到的来源
  const citedIds = useMemo(() => {
    const ids = new Set<number>()
    const matches = content.matchAll(/\[(\d+)\]/g)
    for (const m of matches) ids.add(parseInt(m[1]))
    return ids
  }, [content])

  // 按 manual_id 去重，同一个文档/网页算一篇，过滤未引用的
  const uniqueRefs = useMemo(() => {
    const map = new Map<number, { source: Source; pages: number[] }>()
    for (const s of sources) {
      if (!citedIds.has(s.id)) continue
      const existing = map.get(s.manual_id)
      if (existing) {
        if (s.page != null && !existing.pages.includes(s.page)) {
          existing.pages.push(s.page)
        }
      } else {
        map.set(s.manual_id, { source: s, pages: s.page != null ? [s.page] : [] })
      }
    }
    return Array.from(map.values())
  }, [sources, citedIds])

  // 过滤出被引用的搜索来源
  const citedSearchSources = useMemo(() => {
    if (!searchSources?.length) return []
    return searchSources.filter(s => citedIds.has(s.id))
  }, [searchSources, citedIds])

  const hasSearch = citedSearchSources.length > 0
  const totalCount = uniqueRefs.length + citedSearchSources.length

  if (totalCount === 0) return null

  return (
    <div className="flex flex-col items-end mt-1.5 pt-1.5 border-t border-slate-200/60">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-500 transition-colors"
      >
        <span>参考 {totalCount} 篇资料</span>
        {expanded
          ? <ChevronUp className="w-3 h-3" />
          : <ChevronDown className="w-3 h-3" />
        }
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 flex flex-col items-end">
          {uniqueRefs.map(({ source, pages }) => {
            const isWeb = source.source_type === 'web'
            const displayName = isWeb ? source.filename.replace(/\.txt$/, '') : source.filename

            // 网页知识库来源：Link 图标，新 tab 打开原文
            if (isWeb && source.source_url) {
              const truncated = displayName.length > 15 ? displayName.slice(0, 15) + '...' : displayName
              return (
                <a
                  key={source.manual_id}
                  href={source.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={displayName}
                  className="flex items-center justify-end gap-1.5 text-[11px] text-purple-500 hover:text-purple-700 hover:underline transition-colors"
                >
                  <Link className="w-3 h-3 shrink-0" />
                  <span>{truncated}</span>
                </a>
              )
            }
            // PDF 手册：BookOpen 图标
            return (
              <button
                key={source.manual_id}
                onClick={() => window.open(`#pdf-viewer/${source.manual_id}?page=${(source.page ?? 0) + 1}`, '_blank')}
                className="flex items-center justify-end gap-1.5 text-[11px] text-slate-500 hover:text-indigo-600 transition-colors"
              >
                <BookOpen className="w-3 h-3 shrink-0" />
                <span className="truncate">{displayName}</span>
              </button>
            )
          })}
          {/* 搜索来源：Search + Globe 图标，新 tab 打开原文 */}
          {hasSearch && citedSearchSources.map((s, i) => {
            const truncated = s.title.length > 15 ? s.title.slice(0, 15) + '...' : s.title
            return (
              <a
                key={`search-${i}`}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.title}
                className="flex items-center justify-end gap-1.5 text-[11px] text-blue-500 hover:text-blue-700 hover:underline transition-colors"
              >
                <Search className="w-3 h-3 shrink-0 text-slate-400" />
                <Globe className="w-3 h-3 shrink-0" />
                <span>{truncated}</span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- 消息气泡（memo 包裹，避免流式更新时历史消息重渲染）---
const ChatBubble = memo(function ChatBubble({
  msg, index, isLastAssistant, streaming, copiedId,
  onFeedback, onCopy, onRegenerate,
}: {
  msg: ChatMessage
  index: number
  isLastAssistant: boolean
  streaming: boolean
  copiedId: number | null
  onFeedback: (i: number, type: 'like' | 'dislike') => void
  onCopy: (i: number) => void
  onRegenerate: (i: number) => void
}) {
  return (
    <div className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        msg.role === 'assistant' ? 'bg-blue-100' : 'bg-purple-600'
      }`}>
        {msg.role === 'assistant'
          ? <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          : <User className="w-3.5 h-3.5 text-white" />
        }
      </div>
      <div className="flex flex-col max-w-[85%]">
        <div className={`rounded-2xl px-3.5 py-2.5 ${
          msg.role === 'user'
            ? 'bg-purple-600 text-white rounded-tr-sm'
            : 'bg-slate-100 text-slate-800 rounded-tl-sm'
        }`}>
          {msg.role === 'assistant' ? (
            msg.content ? (
              <>
              <div className="text-sm leading-relaxed prose prose-slate prose-sm max-w-none overflow-x-auto
                [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-slate-800
                [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h2]:text-slate-800
                [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-slate-700
                [&_p]:my-1 [&_p]:text-slate-700
                [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc [&_li]:text-slate-700 [&_li]:text-[13px]
                [&_ol]:my-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_ol]:text-slate-700
                [&_strong]:text-slate-800 [&_strong]:font-semibold
                [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:text-purple-700
                [&_pre]:bg-slate-800 [&_pre]:text-slate-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-2 [&_pre]:text-xs [&_pre]:overflow-x-auto
                [&_pre>_code]:bg-transparent [&_pre>_code]:p-0 [&_pre>_code]:text-slate-100
                [&_blockquote]:border-l-2 [&_blockquote]:border-purple-400 [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-slate-600 [&_blockquote]:italic
                [&_table]:w-full [&_table]:text-xs [&_table]:my-2 [&_table]:border-collapse
                [&_thead]:bg-slate-200/80
                [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-700 [&_th]:border [&_th]:border-slate-300
                [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:border [&_td]:border-slate-200 [&_td]:text-slate-600
                [&_tbody_tr:nth-child(even)]:bg-slate-50
                [&_a]:text-purple-600 [&_a]:underline
              ">
                <CitationMarkdown content={msg.content} sources={msg.sources} searchSources={msg.searchSources} />
                <ReferenceBar sources={msg.sources || []} searchSources={msg.searchSources} content={msg.content} />
              </div>
              {msg.warning && (
                <div className="flex items-start gap-1.5 mt-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{msg.warning}</span>
                </div>
              )}
              </>
            ) : (
              <div className="flex items-center gap-1.5 py-1">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-[bounce_1s_ease-in-out_infinite]" />
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-[bounce_1s_ease-in-out_0.15s_infinite]" />
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-[bounce_1s_ease-in-out_0.3s_infinite]" />
              </div>
            )
          ) : (
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
          )}
        </div>
        {msg.role === 'assistant' && msg.content && (
          <div className="flex items-center gap-0.5 mt-1 ml-1">
            <button
              onClick={() => onFeedback(index, 'like')}
              className={`p-1.5 rounded-md transition-colors ${
                msg.feedback === 'like' ? 'text-blue-500 bg-blue-50' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'
              }`}
              title="有帮助"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onFeedback(index, 'dislike')}
              className={`p-1.5 rounded-md transition-colors ${
                msg.feedback === 'dislike' ? 'text-red-500 bg-red-50' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
              }`}
              title="没帮助"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onCopy(index)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              title="复制"
            >
              {copiedId === index
                ? <Check className="w-3.5 h-3.5 text-green-500" />
                : <Copy className="w-3.5 h-3.5" />
              }
            </button>
            <button
              onClick={() => onRegenerate(index)}
              disabled={streaming}
              className="p-1.5 rounded-md text-slate-400 hover:text-purple-500 hover:bg-purple-50 transition-colors disabled:opacity-50"
              title="重新生成"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

export default function ChatPanel() {
  const { currentVehicleId, pendingQuestion, setPendingQuestion, chatOpen, setChatOpen, chatMaximized, setChatMaximized, chatMessages, setChatMessages, clearChatMessages } = useStore()
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [searchEnabled, setSearchEnabled] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingHandled = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // 流式输出节流：缓冲 SSE 内容，减少 setState 频率，避免闪烁
  const bufferRef = useRef<{ msg: ChatMessage; index: number; rafId: number | null }>({
    msg: { role: 'assistant', content: '' }, index: -1, rafId: null,
  })

  // 节流更新：用 requestAnimationFrame 合并多次 SSE 事件为一次 setState
  const flushBuffer = useCallback(() => {
    const buf = bufferRef.current
    buf.rafId = null
    setChatMessages((prev) => {
      const updated = [...prev]
      if (buf.index >= 0 && buf.index < updated.length) {
        updated[buf.index] = { ...buf.msg }
      }
      return updated
    })
  }, [setChatMessages])

  const scheduleFlush = useCallback(() => {
    const buf = bufferRef.current
    if (!buf.rafId) {
      buf.rafId = requestAnimationFrame(flushBuffer)
    }
  }, [flushBuffer])

  // Modal 状态：当前查看的引用来源（手册或搜索来源）
  const [modalSource, setModalSource] = useState<CitationItem | null>(null)

  const modalSourceRef = useRef(modalSource)
  modalSourceRef.current = modalSource

  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent).detail as CitationItem
      if (modalSourceRef.current) {
        setModalSource(null)
        setTimeout(() => setModalSource(item), 50)
      } else {
        setModalSource(item)
      }
    }
    citationBus.addEventListener('open', handler)
    return () => citationBus.removeEventListener('open', handler)
  }, [])

  function stopStreaming() {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  useEffect(() => {
    if (pendingQuestion && !pendingHandled.current && !streaming) {
      pendingHandled.current = true
      send(pendingQuestion)
      setPendingQuestion(null)
    }
  }, [pendingQuestion, streaming])

  useEffect(() => {
    if (!chatOpen) {
      pendingHandled.current = false
    }
  }, [chatOpen])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  function handleFeedback(index: number, type: 'like' | 'dislike') {
    setChatMessages((prev) => {
      const updated = [...prev]
      const msg = updated[index]
      if (msg.feedback === type) {
        updated[index] = { ...msg, feedback: null }
        return updated
      }
      updated[index] = { ...msg, feedback: type }
      const question = updated.slice(0, index).reverse().find(m => m.role === 'user')?.content || ''
      submitChatFeedback(currentVehicleId!, question, msg.content, type)
      return updated
    })
  }

  function handleCopy(index: number) {
    const content = chatMessages[index].content
    navigator.clipboard.writeText(content)
    setCopiedId(index)
    setTimeout(() => setCopiedId(null), 1500)
  }

  // 重新生成指定位置的 AI 回复
  async function regenerate(assistantIndex: number) {
    if (streaming) return
    const question = chatMessages.slice(0, assistantIndex).reverse().find(m => m.role === 'user')?.content
    if (!question) return
    const questionIndex = chatMessages.slice(0, assistantIndex).map((m, idx) => ({ ...m, idx })).filter(m => m.role === 'user').pop()?.idx ?? -1
    const historySnapshot = chatMessages.slice(0, questionIndex).map(m => ({ role: m.role, content: m.content }))
    const newMsg: ChatMessage = { role: 'assistant', content: '' }
    setChatMessages((prev) => {
      const updated = [...prev]
      updated[assistantIndex] = newMsg
      bufferRef.current.index = assistantIndex
      return updated
    })
    setStreaming(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      for await (const event of chatStream(currentVehicleId!, question, historySnapshot, ac.signal, searchEnabled)) {
        if (event.type === 'content') {
          newMsg.content += event.text
        } else if (event.type === 'sources') {
          newMsg.sources = event.data
        } else if (event.type === 'search_sources') {
          newMsg.searchSources = event.data
        } else if (event.type === 'warning') {
          newMsg.warning = event.data
        }
        bufferRef.current.msg = { ...newMsg }
        scheduleFlush()
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        newMsg.content = newMsg.content || `出错了：${err.message}`
        setChatMessages((prev) => {
          const updated = [...prev]
          updated[assistantIndex] = { ...newMsg }
          return updated
        })
      }
    } finally {
      if (bufferRef.current.rafId) {
        cancelAnimationFrame(bufferRef.current.rafId)
        bufferRef.current.rafId = null
      }
      setChatMessages((prev) => {
        const updated = [...prev]
        updated[assistantIndex] = { ...newMsg }
        return updated
      })
      abortRef.current = null
      setStreaming(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  async function send(question: string) {
    if (!question.trim() || streaming) return
    const userMsg: ChatMessage = { role: 'user', content: question }
    const historySnapshot = chatMessages.map(m => ({ role: m.role, content: m.content }))
    setChatMessages((prev) => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setChatMessages((prev) => {
      const updated = [...prev, assistantMsg]
      bufferRef.current.index = updated.length - 1
      return updated
    })

    const ac = new AbortController()
    abortRef.current = ac
    try {
      for await (const event of chatStream(currentVehicleId!, question, historySnapshot, ac.signal, searchEnabled)) {
        if (event.type === 'content') {
          assistantMsg.content += event.text
        } else if (event.type === 'sources') {
          assistantMsg.sources = event.data
        } else if (event.type === 'search_sources') {
          assistantMsg.searchSources = event.data
        } else if (event.type === 'warning') {
          assistantMsg.warning = event.data
        }
        bufferRef.current.msg = { ...assistantMsg }
        scheduleFlush()
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        assistantMsg.content = assistantMsg.content || `出错了：${err.message}`
        setChatMessages((prev) => {
          const updated = [...prev]
          updated[bufferRef.current.index] = { ...assistantMsg }
          return updated
        })
      }
    } finally {
      // 取消 pending 的 rAF，强制刷新最后的内容
      if (bufferRef.current.rafId) {
        cancelAnimationFrame(bufferRef.current.rafId)
        bufferRef.current.rafId = null
      }
      setChatMessages((prev) => {
        const updated = [...prev]
        updated[bufferRef.current.index] = { ...assistantMsg }
        return updated
      })
      abortRef.current = null
      setStreaming(false)
      // 等待 React 完成 DOM 更新后再聚焦
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // 判断是否需要显示分节提醒
  const showWarning = chatMessages.length > MESSAGE_WARNING_THRESHOLD

  return (
    <>
    <div
      className={`${chatMaximized ? 'w-1/3' : 'w-96'} shrink-0 flex flex-col bg-white border-l border-slate-200 animate-slide-in transition-all duration-200`}
    >
        {/* 顶栏 */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">AI 助手</h3>
              <p className="text-[10px] text-purple-200">基于保养手册和历史记录</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setChatMaximized(!chatMaximized)}
              className="w-8 h-8 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors"
              title={chatMaximized ? '还原宽度' : '最大化'}
            >
              {chatMaximized
                ? <Minimize2 className="w-4 h-4 text-white" />
                : <Maximize2 className="w-4 h-4 text-white" />
              }
            </button>
            <button
              onClick={() => setChatOpen(false)}
              className="w-8 h-8 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors"
              title="关闭"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* 对话区 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col h-full">
              <div className="flex-1 flex flex-col items-center justify-center px-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center mb-4">
                  <span className="text-2xl">🤖</span>
                </div>
                <p className="text-base font-medium text-slate-700 mb-1">你好，我是车辆管家小助手</p>
                <p className="text-sm text-slate-500 text-center mb-6">基于你的保养记录和车辆数据，可以回答关于养车的各种问题。</p>
                <div className="w-full space-y-2.5 max-w-sm">
                  {welcomeCards.map((card) => {
                    const Icon = card.icon
                    return (
                      <button
                        key={card.text}
                        onClick={() => send(card.question)}
                        disabled={streaming}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-purple-300 hover:bg-purple-50/50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0 group-hover:bg-purple-100 transition-colors">
                          <Icon className="w-4 h-4 text-purple-600" />
                        </div>
                        <span className="flex-1 text-sm text-slate-700">{card.text}</span>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-purple-400 transition-colors shrink-0" />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            chatMessages.map((msg, i) => (
              <div key={i}>
                {i === MESSAGE_WARNING_THRESHOLD && showWarning && (
                  <div className="flex items-center gap-2 my-4 px-2">
                    <div className="flex-1 h-px bg-amber-200" />
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full shrink-0">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>对话较长，早期上下文可能已丢失，建议清空重新开始</span>
                    </div>
                    <div className="flex-1 h-px bg-amber-200" />
                  </div>
                )}
                <ChatBubble
                  msg={msg}
                  index={i}
                  isLastAssistant={i === chatMessages.length - 1 && msg.role === 'assistant'}
                  streaming={streaming}
                  copiedId={copiedId}
                  onFeedback={handleFeedback}
                  onCopy={handleCopy}
                  onRegenerate={regenerate}
                />
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div className="border-t border-slate-200 px-2.5 py-2 shrink-0">
          {/* 输入框容器：内含输入框 + 按钮行 */}
          <div className="bg-slate-50 rounded-xl px-3 border border-slate-200 focus-within:border-purple-400 focus-within:ring-1 focus-within:ring-purple-100 transition-all flex flex-col">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder="输入问题或需求..."
              className="w-full py-3 text-sm bg-transparent focus:outline-none placeholder:text-slate-400"
              disabled={streaming}
            />
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { clearChatMessages(); pendingHandled.current = false }}
                  disabled={chatMessages.length === 0 || streaming}
                  className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-red-500 disabled:text-slate-300 transition-colors"
                  title="清空对话"
                >
                  <Paintbrush className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-slate-300" />
                <button
                  onClick={() => setSearchEnabled(!searchEnabled)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                    searchEnabled
                      ? 'text-white bg-blue-500'
                      : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'
                  }`}
                  title={searchEnabled ? '联网搜索已开启' : '开启联网搜索'}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">联网搜索</span>
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={stopStreaming}
                  disabled={!streaming}
                  className={`p-1.5 rounded-md transition-colors ${
                    streaming
                      ? 'text-slate-500 hover:text-red-500 hover:bg-red-50'
                      : 'text-slate-300'
                  }`}
                  title="停止生成"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              <button
                onClick={() => send(input)}
                disabled={streaming || !input.trim()}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-purple-500 disabled:text-slate-300 transition-colors"
              >
                <Send className="w-3.5 h-3.5 hover:stroke-[2.5]" />
              </button>
            </div>
            </div>
          </div>

          {/* 免责声明 */}
          <div className="text-center mt-1.5">
            <span className="text-[10px] text-slate-400">内容由AI生成，请仔细甄别</span>
          </div>
        </div>

    </div>
    {modalSource && createPortal(
      <SourceModal
        key={modalSource.id}
        source={modalSource}
        onClose={() => setModalSource(null)}
      />,
      document.body
    )}
  </>
  )
}
