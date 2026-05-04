const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || resp.statusText)
  }
  return resp.json()
}

// --- Vehicles ---
export interface Vehicle {
  id: number
  brand: string
  model: string
  year?: number
  vin?: string
  license_plate?: string
  purchase_date?: string
  current_mileage?: number
  photo_path?: string
  photo_url?: string
}

export const getVehicles = () => request<Vehicle[]>('/vehicles')
export const getVehicle = (id: number) => request<Vehicle>(`/vehicles/${id}`)
export const createVehicle = (data: Partial<Vehicle>) =>
  request<Vehicle>('/vehicles', { method: 'POST', body: JSON.stringify(data) })
export const updateVehicle = (id: number, data: Partial<Vehicle>) =>
  request<Vehicle>(`/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteVehicle = (id: number) =>
  request<{ ok: boolean }>(`/vehicles/${id}`, { method: 'DELETE' })
export const uploadVehiclePhoto = async (id: number, file: File) => {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`${BASE}/vehicles/${id}/photo`, { method: 'POST', body: form })
  if (!resp.ok) throw new Error('上传失败')
  return resp.json() as Promise<Vehicle>
}

// --- Records ---
export interface RecordItem {
  id: number
  name: string
  parts_number: string
  operation_type: string
  quantity: number
  unit_price: number
  parts_cost: number
  labor_cost: number
  other_cost: number
  subtotal: number
}

export interface MaintenanceRecord {
  id: number
  vehicle_id: number
  date: string
  mileage?: number
  next_mileage?: number
  next_date?: string
  type?: string
  total_amount: number
  discount: number
  paid_amount: number
  station?: string
  notes?: string
  items: RecordItem[]
}

export const getRecords = (vehicleId?: number) =>
  request<MaintenanceRecord[]>(`/records${vehicleId ? `?vehicle_id=${vehicleId}` : ''}`)
export const getRecord = (id: number) => request<MaintenanceRecord>(`/records/${id}`)
export const createRecord = (data: any) =>
  request<MaintenanceRecord>('/records', { method: 'POST', body: JSON.stringify(data) })
export const updateRecord = (id: number, data: any) =>
  request<MaintenanceRecord>(`/records/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteRecord = (id: number) =>
  request<{ ok: boolean }>(`/records/${id}`, { method: 'DELETE' })

// --- Upload & OCR ---
export interface OCRBlock {
  text: string
  polygon: { X: number; Y: number }[]
}

export interface OCRResult {
  raw_text: string
  fields: Record<string, string>
  items: string[]
  blocks: OCRBlock[]
  field_coords: Record<string, { X: number; Y: number }[]>
  image_base64: string
  error: string
}

export const uploadAndOCR = async (file: File): Promise<OCRResult> => {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!resp.ok) throw new Error('OCR 识别失败')
  return resp.json()
}

// --- Settings ---
export const getSettings = () => request<Record<string, string>>('/settings')
export const updateSettings = (settings: { key: string; value: string }[]) =>
  request<{ ok: boolean }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  })
export const testLLM = () => request<{ ok: boolean; reply?: string; reasoning?: string; model_requested?: string; model_actual?: string; elapsed?: number; error?: string }>('/settings/test-llm', { method: 'POST' })
export const testEmbedding = () => request<{ ok: boolean; model?: string; dimensions?: number; elapsed?: number; error?: string }>('/settings/test-embedding', { method: 'POST' })
export const testOCR = () => request<{ ok: boolean; provider?: string; recognized?: string; elapsed?: number; error?: string }>('/settings/test-ocr', { method: 'POST' })
export const testRAG = () => request<{ ok: boolean; errors?: string[]; info?: Record<string, any>; elapsed?: number }>('/settings/test-rag', { method: 'POST' })
export const testSearch = () => request<{ ok: boolean; query?: string; results?: number; elapsed?: number; error?: string }>('/settings/test-search', { method: 'POST' })
export const getSearchUsage = () => request<{
  month: string
  local_used: number
  used: number
  monthly_limit: number
  remaining: number
  tavily: {
    account?: {
      current_plan?: string
      plan_usage?: number
      plan_limit?: number
      search_usage?: number
    }
    key?: {
      usage?: number
      limit?: number | null
      search_usage?: number
    }
  } | null
}>('/settings/search-usage')

// --- Manuals ---
export interface Manual {
  id: number
  vehicle_id: number
  filename: string
  upload_date: string
  page_count: number
  chunk_count: number
  status: string
  source_type: string
  source_url: string
  chunk_size: number
  chunk_overlap: number
  separators: string
  error_message: string
}

export const getManuals = (vehicleId?: number) =>
  request<Manual[]>(`/manuals${vehicleId ? `?vehicle_id=${vehicleId}` : ''}`)
export const uploadManual = async (vehicleId: number, file: File, config?: { chunk_size?: number; chunk_overlap?: number; separators?: string }) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId) })
  if (config?.chunk_size) params.set('chunk_size', String(config.chunk_size))
  if (config?.chunk_overlap) params.set('chunk_overlap', String(config.chunk_overlap))
  if (config?.separators) params.set('separators', config.separators)
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`${BASE}/manuals/upload?${params}`, {
    method: 'POST',
    body: form,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || '上传失败')
  }
  return resp.json()
}
export const addWebKnowledge = (data: { vehicle_id: number; url: string; chunk_size?: number; chunk_overlap?: number; separators?: string }) =>
  request<Manual>('/manuals/web', { method: 'POST', body: JSON.stringify(data) })
export const updateManual = (id: number, data: { chunk_size?: number; chunk_overlap?: number; separators?: string; reindex?: boolean }) =>
  request<Manual>(`/manuals/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteManual = (id: number) =>
  request<{ ok: boolean }>(`/manuals/${id}`, { method: 'DELETE' })
export const reindexManual = (id: number) =>
  request<Manual>(`/manuals/${id}/reindex`, { method: 'POST' })

// 分块预览
export interface ChunkPreview {
  index: number
  text: string
  char_count: number
  has_table: boolean
}
export interface ChunkPreviewResult {
  total_chunks: number
  chunks: ChunkPreview[]
}
export const previewChunks = async (file: File | null, url: string | null, config: { chunk_size: number; chunk_overlap: number; separators: string }): Promise<ChunkPreviewResult> => {
  const params = new URLSearchParams({
    chunk_size: String(config.chunk_size),
    chunk_overlap: String(config.chunk_overlap),
    separators: config.separators,
  })
  if (url) params.set('url', url)

  if (file) {
    const form = new FormData()
    form.append('file', file)
    const resp = await fetch(`${BASE}/manuals/preview-chunks?${params}`, {
      method: 'POST',
      body: form,
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || '预览失败')
    }
    return resp.json()
  } else {
    const resp = await fetch(`${BASE}/manuals/preview-chunks?${params}`, { method: 'POST' })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || '预览失败')
    }
    return resp.json()
  }
}

// 手册页面图片 URL（按需渲染，后端缓存，可选高亮文本）
export const getManualPageUrl = (manualId: number, page: number, highlight?: string) => {
  const url = `${BASE}/manuals/${manualId}/page/${page}`
  if (highlight) return `${url}?highlight=${encodeURIComponent(highlight)}`
  return url
}

export const getManualFileUrl = (manualId: number, page?: number) => {
  const url = `${BASE}/manuals/${manualId}/file`
  if (page != null) return `${url}#page=${page + 1}`
  return url
}

// --- Manual Index Progress (SSE) ---
export interface IndexProgressEvent {
  stage: string  // pending / extracting / chunking / embedding / done / error
  message: string
  current: number
  total: number
}

export async function* indexManualProgress(
  manualId: number,
  signal?: AbortSignal,
): AsyncGenerator<IndexProgressEvent> {
  const resp = await fetch(`${BASE}/manuals/${manualId}/index`, {
    method: 'POST',
    signal,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || '启动索引失败')
  }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          yield {
            stage: parsed.stage || 'pending',
            message: parsed.message || '',
            current: parsed.current || 0,
            total: parsed.total || 0,
          }
        } catch { /* skip */ }
      }
    }
  }
}

// --- Batch Reindex Progress (SSE) ---
export interface ReindexAllEvent {
  current: number
  total: number
  filename: string
  stage: string  // indexing / done
}

export async function* reindexAllProgress(
  signal?: AbortSignal,
): AsyncGenerator<ReindexAllEvent> {
  const resp = await fetch(`${BASE}/manuals/reindex-all`, {
    method: 'POST',
    signal,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || '启动批量重建失败')
  }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          yield {
            current: parsed.current || 0,
            total: parsed.total || 0,
            filename: parsed.filename || '',
            stage: parsed.stage || 'indexing',
          }
        } catch { /* skip */ }
      }
    }
  }
}

// --- Chat (SSE) ---
export interface Source {
  id: number
  text: string
  manual_id: number
  page: number
  filename: string
  source_type?: string  // "pdf" 或 "web"
  source_url?: string   // 网页来源的原始 URL
}

export interface SearchSource {
  id: number
  title: string
  url: string
  content: string
}

export type ChatStreamEvent =
  | { type: 'content'; text: string }
  | { type: 'sources'; data: Source[] }
  | { type: 'search_sources'; data: SearchSource[] }

export async function* chatStream(vehicleId: number, question: string, history: { role: string; content: string }[] = [], signal?: AbortSignal, search?: boolean): AsyncGenerator<ChatStreamEvent> {
  const resp = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_id: vehicleId, question, history, search }),
    signal,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `请求失败（${resp.status}）`)
  }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'sources') {
            yield { type: 'sources', data: parsed.data }
          } else if (parsed.type === 'search_sources') {
            yield { type: 'search_sources', data: parsed.data }
          } else if (parsed.content) {
            yield { type: 'content', text: parsed.content }
          }
        } catch { /* skip */ }
      }
    }
  }
}

// --- Chat Feedback ---
export function submitChatFeedback(vehicleId: number, question: string, answer: string, feedback: 'like' | 'dislike') {
  return request<{ ok: boolean }>('/chat/feedback', {
    method: 'POST',
    body: JSON.stringify({ vehicle_id: vehicleId, question, answer, feedback }),
  })
}

// --- Item Templates ---
export interface ItemTemplate {
  id: number
  name: string
  parts_number: string
  operation_type: string
  reference_unit_price: number
  reference_parts_cost: number
  reference_labor_cost: number
  category: string
  notes: string
  created_at?: string
}

export const getItemTemplates = (params?: { category?: string; search?: string }) => {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (params?.search) qs.set('search', params.search)
  const query = qs.toString()
  return request<ItemTemplate[]>(`/item-templates${query ? `?${query}` : ''}`)
}
export const createItemTemplate = (data: Partial<ItemTemplate>) =>
  request<ItemTemplate>('/item-templates', { method: 'POST', body: JSON.stringify(data) })
export const updateItemTemplate = (id: number, data: Partial<ItemTemplate>) =>
  request<ItemTemplate>(`/item-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteItemTemplate = (id: number) =>
  request<{ ok: boolean }>(`/item-templates/${id}`, { method: 'DELETE' })
export const matchItemTemplates = (texts: string[]) =>
  request<Record<string, ItemTemplate[]>>('/item-templates/match', { method: 'POST', body: JSON.stringify({ texts }) })
export const importFromRecords = () =>
  request<{ imported: number; updated: number; skipped: number; names: string[]; updated_names: string[] }>('/item-templates/import-from-records', { method: 'POST' })

// --- Dashboard ---
export interface ReasoningPoint {
  title: string
  detail: string
}

export interface CostBreakdownItem {
  item: string
  cost: number
  source: string
  note: string
}

export interface Prediction {
  predicted_items: string[]
  reasoning: string
  reasoning_points: ReasoningPoint[]
  estimated_cost: number
  cost_reasoning: string
  cost_breakdown: CostBreakdownItem[]
  generated_at: string | null
}

export const getPrediction = (vehicleId: number) =>
  request<Prediction>(`/dashboard/prediction?vehicle_id=${vehicleId}`)

export const generatePrediction = (vehicleId: number) =>
  request<Prediction>(`/dashboard/prediction/generate?vehicle_id=${vehicleId}`, { method: 'POST' })
