import { useState, useEffect, useCallback, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { X, ZoomIn, ZoomOut, RotateCw, FileText } from 'lucide-react'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

function parseViewerParams() {
  const hash = location.hash.slice(1)   // /pdf-viewer/1?page=5
  const [path, query] = hash.split('?') // /pdf-viewer/1
  const parts = path.split('/')         // ['', 'pdf-viewer', '1']
  const manualId = parseInt(parts[2]) || 0
  const params = new URLSearchParams(query || '')
  const page = parseInt(params.get('page') || '1') || 1
  return { manualId, page }
}

export default function PdfViewerPage() {
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.2)
  const [rotation, setRotation] = useState(0)
  const [manualId, setManualId] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const initialScrollDone = useRef(false)

  useEffect(() => {
    const { manualId: id, page } = parseViewerParams()
    setManualId(id)
    setCurrentPage(page)
  }, [])

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setLoading(false)
  }, [])

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message)
    setLoading(false)
  }, [])

  // 文档加载后滚动到初始页
  useEffect(() => {
    if (numPages > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true
      const { page } = parseViewerParams()
      if (page > 1) {
        // 等待页面渲染后再滚动
        requestAnimationFrame(() => {
          const el = pageRefs.current.get(page)
          el?.scrollIntoView({ behavior: 'auto' })
        })
      }
    }
  }, [numPages])

  // IntersectionObserver 追踪当前可见页码
  useEffect(() => {
    if (!numPages) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const page = Number(entry.target.getAttribute('data-page'))
            if (page) setCurrentPage(page)
          }
        }
      },
      { root: scrollRef.current, rootMargin: '-40% 0px -40% 0px', threshold: 0 }
    )
    pageRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [numPages, scale, rotation])

  const goToPage = (n: number) => {
    const page = Math.max(1, Math.min(numPages, n))
    setCurrentPage(page)
    pageRefs.current.get(page)?.scrollIntoView({ behavior: 'smooth' })
  }
  const zoomIn = () => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))
  const zoomOut = () => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))
  const rotate = () => setRotation(r => (r + 90) % 360)

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === '+' || e.key === '=') zoomIn()
      else if (e.key === '-') zoomOut()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const pdfUrl = manualId ? `/api/manuals/${manualId}/file` : ''

  // manualId 未就绪时不渲染 Document，避免 react-pdf 空 URL 报错
  if (!manualId) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100" onContextMenu={(e) => e.preventDefault()}>
      {/* 工具栏 */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-700 min-w-0">
          <FileText className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="truncate">文档预览</span>
        </div>

        {/* 页码 */}
        <div className="flex items-center gap-1 text-sm text-slate-600">
          <input
            type="number"
            value={currentPage}
            onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
            className="w-14 text-center border border-slate-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:border-blue-400"
            min={1}
            max={numPages}
          />
          <span>/ {numPages}</span>
        </div>

        {/* 缩放 + 旋转 + 关闭 */}
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors" title="缩小">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors" title="放大">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={rotate} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors" title="旋转">
            <RotateCw className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-slate-200 mx-1" />
          <button onClick={() => window.close()} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-red-50 hover:text-red-500 transition-colors" title="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 连续滚动区域 */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center text-slate-500 mt-20">
            <FileText className="w-12 h-12 text-slate-300 mb-3" />
            <p className="text-sm">加载失败：{error}</p>
          </div>
        ) : (
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center mt-20">
                <div className="w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <div className="flex flex-col items-center gap-4 py-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
                <div
                  key={page}
                  ref={(el) => { if (el) pageRefs.current.set(page, el) }}
                  data-page={page}
                  className="shadow-lg bg-white"
                >
                  <Page
                    pageNumber={page}
                    scale={scale}
                    rotate={rotation}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    loading={
                      <div className="flex items-center justify-center" style={{ width: 600 * scale, height: 800 * scale }}>
                        <div className="w-6 h-6 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                      </div>
                    }
                  />
                </div>
              ))}
            </div>
          </Document>
        )}
      </div>
    </div>
  )
}
