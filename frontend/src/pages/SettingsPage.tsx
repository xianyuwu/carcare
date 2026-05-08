import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateSettings, testLLM, testEmbedding, testOCR, testRAG, testSearch, getSearchUsage } from '../api/client'
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import AdminUsersPage from './AdminUsersPage'

interface SettingField {
  key: string
  label: string
  type?: string
  options?: { value: string; label: string }[]
  secret?: boolean
  plain?: boolean
  placeholder?: string
  sliderMin?: number
  sliderMax?: number
  sliderStep?: number
  helpText?: string
}

const settingGroups: { title: string; desc: string; testKey: 'ocr' | 'llm' | 'embedding' | 'search'; fields: SettingField[] }[] = [
  {
    title: 'OCR 多模态模型配置',
    desc: '配置用于识别结算单图片的多模态大模型（与对话模型独立配置）',
    testKey: 'ocr' as const,
    fields: [
      { key: 'ocr_llm_api_url', label: 'API 地址', placeholder: '如：https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { key: 'ocr_llm_api_key', label: 'API Key', secret: true },
      { key: 'ocr_llm_model', label: '多模态模型', placeholder: '如：qwen-vl-plus' },
    ],
  },
  {
    title: '对话模型配置',
    desc: '配置兼容 OpenAI 协议的对话大模型（用于智能问答）',
    testKey: 'llm' as const,
    fields: [
      { key: 'llm_api_url', label: 'API 地址', placeholder: '如：https://api.openai.com/v1' },
      { key: 'llm_api_key', label: 'API Key', secret: true },
      { key: 'llm_model', label: '对话模型', placeholder: '如：gpt-4o' },
    ],
  },
  {
    title: '向量模型配置',
    desc: '配置兼容 OpenAI 协议的 Embedding 模型（用于手册向量化检索）',
    testKey: 'embedding' as const,
    fields: [
      { key: 'llm_embedding_api_url', label: 'API 地址', placeholder: '如：https://api.openai.com/v1' },
      { key: 'llm_embedding_api_key', label: 'API Key', secret: true },
      { key: 'llm_embedding_model', label: '向量模型', placeholder: '如：text-embedding-3-small' },
    ],
  },
  {
    title: '联网搜索配置',
    desc: '配置 AI 助手联网搜索能力（使用 Tavily API）',
    testKey: 'search' as const,
    fields: [
      { key: 'search_api_key', label: '搜索 API Key', secret: true, placeholder: 'Tavily API Key' },
      { key: 'search_api_url', label: '搜索 API 地址', placeholder: 'https://api.tavily.com' },
      { key: 'search_monthly_limit', label: '每月额度', type: 'number', placeholder: '1000', helpText: '每月免费搜索次数上限' },
    ],
  },
]

// RAG 检索配置组（独立管理，包含 toggle/slider 等特殊控件）
const ragGroup = {
  title: 'RAG 检索配置',
  desc: '配置检索参数，影响智能问答的召回质量',
  fields: [
    { key: 'rag_embed_max_chars', label: '嵌入截断长度', type: 'slider', sliderMin: 50, sliderMax: 2000, sliderStep: 50, helpText: '向量化时每个片段的最大字符数' },
    { key: 'rag_top_k', label: 'Top K', type: 'slider', sliderMin: 1, sliderMax: 20, sliderStep: 1, helpText: '检索与问题最相关的文本片段数量' },
    { key: 'rag_score_threshold', label: 'Score 阈值', type: 'slider', sliderMin: 0, sliderMax: 1, sliderStep: 0.01, helpText: '相似度低于此阈值的片段将被过滤' },
  ],
  rerankFields: [
    { key: 'rag_rerank_api_url', label: 'Rerank API 地址', placeholder: '如：https://api.cohere.ai/v1' },
    { key: 'rag_rerank_api_key', label: 'Rerank API 密钥', secret: true },
    { key: 'rag_rerank_model', label: 'Rerank 模型名称', placeholder: '如：rerank-v3.5' },
  ],
}

type TestKey = 'ocr' | 'llm' | 'embedding' | 'rag' | 'search'
interface TestState {
  loading: boolean
  ok?: boolean
  result?: { [k: string]: any }
  elapsed?: number
  error?: string
}
interface SaveState {
  saving: boolean
  saved?: boolean
}

// --- 搜索用量卡片 ---
function SearchUsageCard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['search-usage'],
    queryFn: getSearchUsage,
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-3 h-3 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
          加载用量数据...
        </div>
      </div>
    )
  }

  if (!data) return null

  const percent = data.monthly_limit > 0 ? Math.round((data.used / data.monthly_limit) * 100) : 0
  const isWarning = percent >= 80
  const isDanger = percent >= 95

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-600">{data.month} 月用量</span>
        <button onClick={() => refetch()} className="text-[10px] text-slate-400 hover:text-blue-500 transition-colors">刷新</button>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
        <span>已使用 <span className={`font-medium ${isDanger ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-slate-700'}`}>{data.used}</span> / {data.monthly_limit} 次</span>
        <span>剩余 <span className={`font-medium ${isDanger ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-emerald-600'}`}>{data.remaining}</span></span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isDanger ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-500'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {data.tavily?.account && (
        <div className="mt-2 text-[10px] text-slate-400">
          Tavily（{data.tavily.account.current_plan}）：已用 {data.tavily.account.plan_usage} / {data.tavily.account.plan_limit} 次
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const user = useStore((s) => s.user)
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const [form, setForm] = useState<Record<string, string>>({})
  const [testStates, setTestStates] = useState<Record<TestKey, TestState>>({
    ocr: { loading: false },
    llm: { loading: false },
    embedding: { loading: false },
    rag: { loading: false },
    search: { loading: false },
  })
  const [saveStates, setSaveStates] = useState<Record<TestKey, SaveState>>({
    ocr: { saving: false },
    llm: { saving: false },
    embedding: { saving: false },
    rag: { saving: false },
    search: { saving: false },
  })
  // 追踪密钥字段是否正在编辑（聚焦时清空脱敏值，让用户输入新值）
  const [activeTab, setActiveTab] = useState<'services' | 'rag' | 'users'>('services')
  const [editingSecrets, setEditingSecrets] = useState<Record<string, boolean>>({})
  // 保存服务端返回的脱敏值，用于失焦恢复
  const [maskedValues, setMaskedValues] = useState<Record<string, string>>({})

  // 记录服务端返回的原始 embedding 模型名，用于变更检测
  const originalEmbeddingModel = useRef<string>('')

  useEffect(() => {
    if (settings) {
      setForm(settings)
      originalEmbeddingModel.current = settings.llm_embedding_model || ''
    }
  }, [settings])

  async function saveGroup(group: typeof settingGroups[number]) {
    const key = group.testKey

    // 向量模型变更提醒
    if (key === 'embedding') {
      const newModel = (form['llm_embedding_model'] || '').trim()
      if (newModel && originalEmbeddingModel.current && newModel !== originalEmbeddingModel.current) {
        const ok = window.confirm(
          `向量模型将从「${originalEmbeddingModel.current}」变更为「${newModel}」。\n\n` +
          '不同模型的向量空间不兼容，保存后需要到「保养知识」页面重新索引所有手册，否则检索结果会不正确。\n\n' +
          '确定要切换模型吗？'
        )
        if (!ok) return
      }
    }

    setSaveStates((prev) => ({ ...prev, [key]: { saving: true } }))
    const items = group.fields.map((f) => ({ key: f.key, value: (form[f.key] || '').trim() }))
    try {
      await updateSettings(items)
      setSaveStates((prev) => ({ ...prev, [key]: { saving: false, saved: true } }))
      qc.invalidateQueries({ queryKey: ['settings'] })
      setTimeout(() => setSaveStates((prev) => ({ ...prev, [key]: { saving: false } })), 2000)
    } catch {
      setSaveStates((prev) => ({ ...prev, [key]: { saving: false } }))
    }
  }

  // RAG 配置组独立保存
  async function saveRagGroup() {
    const key = 'rag' as TestKey
    setSaveStates((prev) => ({ ...prev, [key]: { saving: true } }))
    const items = [
      ...ragGroup.fields.map((f) => ({ key: f.key, value: (form[f.key] || '').trim() })),
      { key: 'rag_rerank_enabled', value: form['rag_rerank_enabled'] || 'false' },
      ...ragGroup.rerankFields.map((f) => ({ key: f.key, value: (form[f.key] || '').trim() })),
    ]
    try {
      await updateSettings(items)
      setSaveStates((prev) => ({ ...prev, [key]: { saving: false, saved: true } }))
      qc.invalidateQueries({ queryKey: ['settings'] })
      setTimeout(() => setSaveStates((prev) => ({ ...prev, [key]: { saving: false } })), 2000)
    } catch {
      setSaveStates((prev) => ({ ...prev, [key]: { saving: false } }))
    }
  }

  async function handleTest(key: TestKey) {
    setTestStates((prev) => ({ ...prev, [key]: { loading: true } }))
    // RAG 组单独处理保存
    if (key === 'rag') {
      await saveRagGroup()
    } else {
      const group = settingGroups.find((g) => g.testKey === key)!
      await saveGroup(group)
    }
    try {
      let res: any
      if (key === 'llm') res = await testLLM()
      else if (key === 'embedding') res = await testEmbedding()
      else if (key === 'rag') res = await testRAG()
      else if (key === 'search') res = await testSearch()
      else res = await testOCR()
      setTestStates((prev) => ({
        ...prev,
        [key]: { loading: false, ok: res.ok, result: res, elapsed: res.elapsed, error: res.error },
      }))
    } catch (err: any) {
      setTestStates((prev) => ({ ...prev, [key]: { loading: false, ok: false, error: err.message } }))
    }
  }

  function renderTestResult(key: TestKey) {
    const ts = testStates[key]
    if (ts.ok === undefined) return null

    return (
      <div className={`mt-3 rounded-lg border text-xs overflow-hidden ${
        ts.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
      }`}>
        <div className={`px-3 py-2 font-medium flex items-center justify-between ${
          ts.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
        }`}>
          <span>{ts.ok ? '连接成功' : '连接失败'}</span>
          {ts.elapsed !== undefined && <span className="font-normal">耗时 {ts.elapsed}s</span>}
        </div>
        <div className="px-3 py-2 space-y-1 text-slate-700">
          {key === 'llm' && ts.result && (
            <>
              <p>模型: <span className="font-medium">{ts.result.model_requested}</span>{ts.result.model_actual && ts.result.model_actual !== ts.result.model_requested && <> → <span className="font-medium">{ts.result.model_actual}</span></>}</p>
              {ts.result.reply ? (
                <p>回复: <span className="text-slate-600">"{ts.result.reply}"</span></p>
              ) : ts.result.reasoning ? (
                <p>思考: <span className="text-slate-600">"{ts.result.reasoning}..."</span></p>
              ) : (
                <p>回复: <span className="text-slate-400">(模型未返回内容)</span></p>
              )}
            </>
          )}
          {key === 'embedding' && ts.result && (
            <>
              <p>模型: <span className="font-medium">{ts.result.model}</span></p>
              <p>向量维度: <span className="font-medium">{ts.result.dimensions}</span></p>
            </>
          )}
          {key === 'ocr' && ts.result && (
            <>
              <p>服务商: <span className="font-medium">{ts.result.provider}</span></p>
              <p>识别结果: <span className="text-slate-600">"{ts.result.recognized || '(空)'}"</span></p>
            </>
          )}
          {key === 'rag' && ts.result && (
            <>
              {ts.result.info && (
                <div className="space-y-0.5">
                  <p>Top K: <span className="font-medium">{ts.result.info.top_k}</span></p>
                  <p>Score 阈值: <span className="font-medium">{ts.result.info.score_threshold}</span></p>
                  <p>嵌入截断长度: <span className="font-medium">{ts.result.info.embed_max_chars}</span></p>
                  {ts.result.info.rerank_enabled !== undefined && (
                    <p>Rerank: <span className="font-medium">{ts.result.info.rerank_enabled ? `已启用 (${ts.result.info.rerank_model || '未配置模型'})` : '未启用'}</span></p>
                  )}
                </div>
              )}
              {ts.result.errors && ts.result.errors.length > 0 && ts.result.errors.map((e: string, i: number) => (
                <p key={i} className="text-red-600">{e}</p>
              ))}
            </>
          )}
          {key === 'search' && ts.result && (
            <>
              <p>搜索词: <span className="font-medium">{ts.result.query}</span></p>
              <p>返回结果: <span className="font-medium">{ts.result.results} 条</span></p>
            </>
          )}
          {!ts.ok && ts.error && (
            <p className="text-red-600">{ts.error}</p>
          )}
        </div>
      </div>
    )
  }

  if (isLoading) return <div className="p-8 text-center text-slate-400">加载中...</div>

  const tabs = [
    { key: 'services' as const, label: '服务配置' },
    { key: 'rag' as const, label: '检索参数' },
    ...(user?.role === 'admin' ? [{ key: 'users' as const, label: '用户管理' }] : []),
  ]

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">系统设置</h2>
        <p className="text-sm text-slate-500 mt-1">配置 OCR 和大模型服务参数</p>
      </div>

      {/* Tab 导航 */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative -mb-px ${
              activeTab === tab.key
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 服务配置 Tab */}
      {activeTab === 'services' && (
        <div className="space-y-6 max-w-2xl">
          {settingGroups.map((group) => {
            const testKey = group.testKey
            const ts = testStates[testKey]
            const ss = saveStates[testKey]
            return (
              <div key={group.title} className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-base font-semibold text-slate-800 mb-1">{group.title}</h3>
                <p className="text-xs text-slate-500 mb-4">{group.desc}</p>
                <div className="space-y-4">
                  {group.fields.map((f) => {
                    if (f.secret) {
                      const isEditing = editingSecrets[f.key]
                      const isPlain = (f as any).plain
                      return (
                        <div key={f.key}>
                          <label className="text-xs text-slate-500 mb-1 block">{f.label}</label>
                          <input
                            type={isPlain ? 'text' : 'password'}
                            value={form[f.key] || ''}
                            placeholder={maskedValues[f.key] ? '已配置，点击修改' : '未配置'}
                            onFocus={() => {
                              if (!isPlain) {
                                setEditingSecrets((prev) => ({ ...prev, [f.key]: true }))
                                setForm((prev) => ({ ...prev, [f.key]: '' }))
                              }
                            }}
                            onBlur={() => {
                              if (!isPlain) {
                                setEditingSecrets((prev) => ({ ...prev, [f.key]: false }))
                                if (!form[f.key] && maskedValues[f.key]) {
                                  setForm((prev) => ({ ...prev, [f.key]: maskedValues[f.key] }))
                                }
                              }
                            }}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                            className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-blue-400 ${
                              isEditing ? 'border-blue-300 bg-white' : 'border-slate-200 bg-slate-50'
                            }`}
                          />
                        </div>
                      )
                    }

                    if (f.type === 'select') {
                      return (
                        <div key={f.key}>
                          <label className="text-xs text-slate-500 mb-1 block">{f.label}</label>
                          <select
                            value={form[f.key] || ''}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-400"
                          >
                            {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      )
                    }

                    return (
                      <div key={f.key}>
                        <label className="text-xs text-slate-500 mb-1 block">{f.label}</label>
                        <input
                          type="text"
                          value={form[f.key] || ''}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-400"
                        />
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
                  <button
                    onClick={() => saveGroup(group)}
                    disabled={ss.saving}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                  >
                    {ss.saving ? '保存中...' : ss.saved ? '已保存' : '保存'}
                  </button>
                  <button
                    onClick={() => handleTest(testKey)}
                    disabled={ts.loading}
                    className="px-4 py-1.5 border border-blue-600 text-blue-600 rounded-lg text-xs hover:bg-blue-50 disabled:opacity-50"
                  >
                    {ts.loading ? '测试中...' : `测试${testKey === 'llm' ? '对话模型' : testKey === 'embedding' ? '向量模型' : testKey === 'search' ? '搜索连接' : 'OCR 连接'}`}
                  </button>
                </div>

                {renderTestResult(testKey)}
                {testKey === 'search' && <SearchUsageCard />}
              </div>
            )
          })}
        </div>
      )}

      {/* 检索参数 Tab */}
      {activeTab === 'rag' && (
        <div className="max-w-2xl">
          {(() => {
            const ts = testStates['rag']
            const ss = saveStates['rag']
            const rerankEnabled = (form['rag_rerank_enabled'] || 'false') === 'true'
            return (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-base font-semibold text-slate-800 mb-1">{ragGroup.title}</h3>
                <p className="text-xs text-slate-500 mb-4">{ragGroup.desc}</p>
                <div className="space-y-5">
                  {ragGroup.fields.map((f) => {
                    const numVal = parseFloat(form[f.key] || String(f.sliderMin))
                    return (
                      <div key={f.key}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-slate-500">{f.label}</label>
                          {f.helpText && <span className="text-[10px] text-slate-400">{f.helpText}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={f.sliderMin}
                            max={f.sliderMax}
                            step={f.sliderStep}
                            value={numVal}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                            className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                          />
                          <input
                            type="number"
                            min={f.sliderMin}
                            max={f.sliderMax}
                            step={f.sliderStep}
                            value={numVal}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value)
                              if (!isNaN(v) && v >= (f.sliderMin ?? 0) && v <= (f.sliderMax ?? 9999)) {
                                setForm({ ...form, [f.key]: String(v) })
                              }
                            }}
                            className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-center focus:outline-none focus:border-blue-400"
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 mt-0.5 px-0.5">
                          <span>{f.sliderMin}</span>
                          <span>{f.sliderMax}</span>
                        </div>
                      </div>
                    )
                  })}

                  <div className="pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs text-slate-500">启用 Rerank 模型</label>
                        <p className="text-[10px] text-slate-400 mt-0.5">对检索结果重排序，提升召回精度（需额外 API 调用）</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, rag_rerank_enabled: rerankEnabled ? 'false' : 'true' })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          rerankEnabled ? 'bg-blue-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            rerankEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {rerankEnabled && (
                      <div className="mt-3 space-y-3 pl-0">
                        {ragGroup.rerankFields.map((f) => {
                          if (f.secret) {
                            const isEditing = editingSecrets[f.key]
                            return (
                              <div key={f.key}>
                                <label className="text-xs text-slate-500 mb-1 block">{f.label}</label>
                                <input
                                  type="password"
                                  value={form[f.key] || ''}
                                  placeholder={maskedValues[f.key] ? '已配置，点击修改' : '未配置'}
                                  onFocus={() => {
                                    setEditingSecrets((prev) => ({ ...prev, [f.key]: true }))
                                    setForm((prev) => ({ ...prev, [f.key]: '' }))
                                  }}
                                  onBlur={() => {
                                    setEditingSecrets((prev) => ({ ...prev, [f.key]: false }))
                                    if (!form[f.key] && maskedValues[f.key]) {
                                      setForm((prev) => ({ ...prev, [f.key]: maskedValues[f.key] }))
                                    }
                                  }}
                                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-blue-400 ${
                                    isEditing ? 'border-blue-300 bg-white' : 'border-slate-200 bg-slate-50'
                                  }`}
                                />
                              </div>
                            )
                          }
                          return (
                            <div key={f.key}>
                              <label className="text-xs text-slate-500 mb-1 block">{f.label}</label>
                              <input
                                type="text"
                                value={form[f.key] || ''}
                                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                                placeholder={f.placeholder}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-400"
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
                  <button
                    onClick={() => saveRagGroup()}
                    disabled={ss.saving}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                  >
                    {ss.saving ? '保存中...' : ss.saved ? '已保存' : '保存'}
                  </button>
                  <button
                    onClick={() => handleTest('rag')}
                    disabled={ts.loading}
                    className="px-4 py-1.5 border border-blue-600 text-blue-600 rounded-lg text-xs hover:bg-blue-50 disabled:opacity-50"
                  >
                    {ts.loading ? '测试中...' : '测试检索配置'}
                  </button>
                </div>

                {renderTestResult('rag')}
              </div>
            )
          })()}
        </div>
      )}

      {/* 用户管理 Tab */}
      {activeTab === 'users' && user?.role === 'admin' && (
        <AdminUsersPage embedded />
      )}
    </div>
  )
}
