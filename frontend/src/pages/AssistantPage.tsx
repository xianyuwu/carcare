import { useState, useRef, useEffect } from 'react'
import { Send, Paintbrush, Square } from 'lucide-react'
import { useStore } from '../hooks/useStore'
import { chatStream } from '../api/client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const quickQuestions = [
  '下次保养该做什么？',
  '刹车片多久换一次？',
  '机油选什么规格？',
  '我的花费合理吗？',
]

export default function AssistantPage() {
  const { currentVehicleId, pendingQuestion, setPendingQuestion } = useStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingHandled = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // 处理从仪表盘跳转过来的追问
  useEffect(() => {
    if (pendingQuestion && !pendingHandled.current && !streaming) {
      pendingHandled.current = true
      send(pendingQuestion)
      setPendingQuestion(null)
    }
  }, [pendingQuestion])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function stopStreaming() {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  async function send(question: string) {
    if (!question.trim() || streaming) return
    const userMsg: Message = { role: 'user', content: question }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    const assistantMsg: Message = { role: 'assistant', content: '' }
    setMessages((prev) => [...prev, assistantMsg])

    const ac = new AbortController()
    abortRef.current = ac
    try {
      for await (const chunk of chatStream(currentVehicleId!, question, [], ac.signal)) {
        assistantMsg.content += chunk
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...assistantMsg }
          return updated
        })
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        assistantMsg.content = `出错了：${err.message}`
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...assistantMsg }
          return updated
        })
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  function clearMessages() {
    setMessages([])
    pendingHandled.current = false
  }

  return (
    <div className="p-8 flex flex-col h-full">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">智能问答</h2>
        <p className="text-sm text-slate-500 mt-1">基于保养手册和你的历史记录回答问题</p>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-slate-200 p-6 overflow-auto mb-4">
        {messages.length === 0 ? (
          <div className="text-center text-slate-400 py-16">
            <p className="text-sm">向 AI 助手提问关于车辆保养的问题</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-2xl rounded-2xl px-4 py-3 ${
                  msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}{streaming && msg.role === 'assistant' && i === messages.length - 1 ? '▌' : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-2.5 py-2">
        {/* 输入框容器：内含输入框 + 按钮行 */}
        <div className="bg-white rounded-xl px-3 border border-slate-200 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all flex flex-col">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            placeholder="输入你的问题，例如：机油多久换一次？"
            className="w-full py-3 text-sm focus:outline-none"
            disabled={streaming}
          />
          <div className="flex items-center justify-between pb-2">
            <button
              onClick={clearMessages}
              disabled={messages.length === 0 || streaming}
              className="w-7 h-7 rounded-full bg-slate-500 hover:bg-red-500 disabled:bg-slate-400 flex items-center justify-center transition-colors shrink-0"
              title="清空对话"
            >
              <Paintbrush className="w-3 h-3 text-white" />
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={stopStreaming}
                disabled={!streaming}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                  streaming
                    ? 'bg-slate-500 hover:bg-red-500 text-white'
                    : 'border border-slate-400 text-slate-400'
                }`}
                title="停止生成"
              >
                <Square className="w-3 h-3" />
              </button>
            <button
              onClick={() => send(input)}
              disabled={streaming || !input.trim()}
              className="w-7 h-7 rounded-full bg-slate-500 hover:bg-red-500 disabled:bg-slate-400 flex items-center justify-center transition-colors shrink-0"
            >
              <Send className="w-3 h-3 text-white" />
            </button>
            </div>
          </div>
          </div>

        {/* 免责声明 */}
        <div className="text-center mt-1.5">
          <span className="text-[10px] text-slate-400">内容由AI生成，请仔细甄别</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 justify-center">
        {quickQuestions.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-full hover:border-blue-400 hover:text-blue-600"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
