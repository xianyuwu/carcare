# 车辆维护保养分析系统 (CarCare)

## 技术栈
- **后端**: FastAPI + SQLAlchemy + SQLite + aiosqlite
- **前端**: React + Vite + TypeScript + TailwindCSS + Zustand
- **OCR**: 腾讯云 ExtractDocMulti / 阿里云 / 百度云（策略模式，后台可切换）
  - 腾讯云默认使用 `TencentDocOCR`（结构化提取 + 坐标定位），基础 `TencentOCR` 适配器存在但未启用
- **RAG**: LangChain + ChromaDB + OpenAI 兼容协议 LLM + 可选重排序
- **搜索**: Tavily API（网络搜索，聊天面板可切换）
- **向量数据库**: ChromaDB（本地嵌入）

## 项目结构
```
车辆维护保养分析系统/
├── index.html                    # 原始单页原型（遗留，不再使用）
├── dist/                         # 原型构建产物（遗留）
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # 主应用外壳 + 侧边栏 + 路由
│   │   ├── main.tsx              # React 入口
│   │   ├── api/
│   │   │   └── client.ts         # 统一 API 客户端
│   │   ├── hooks/
│   │   │   └── useStore.ts       # Zustand 全局状态
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # 仪表盘 + AI 预测
│   │   │   ├── RecordsList.tsx   # 保养记录列表 + 创建/编辑弹窗
│   │   │   ├── UploadPage.tsx    # OCR 上传 + 原图标注校对
│   │   │   ├── ManualPage.tsx    # 知识库管理（手册/网页源）
│   │   │   ├── VehiclePage.ts    # 车辆档案 CRUD
│   │   │   ├── DictionaryPage.tsx # 项目模板字典
│   │   │   ├── SettingsPage.tsx  # 系统配置（OCR/LLM/Embedding/RAG/搜索）
│   │   │   ├── PdfViewerPage.tsx # 全屏 PDF 查看器
│   │   │   └── AssistantPage.tsx # 独立聊天页（已废弃，被 ChatPanel 取代）
│   │   └── components/
│   │       └── ChatPanel.tsx     # 右侧可调整 AI 聊天面板（引用/源查看/Markdown）
├── backend/
│   ├── .env / .env.example       # 密钥配置（敏感） / 配置模板
│   ├── requirements.txt
│   ├── data/
│   │   ├── carcare.db            # 主数据库
│   │   ├── chroma/               # ChromaDB 向量存储
│   │   ├── manual_pages/         # PDF 页面图片缓存
│   │   ├── uploads/              # 上传文件 + 网页抓取文本
│   │   └── vehicle_photos/       # 车辆照片
│   └── app/
│       ├── main.py               # FastAPI 入口
│       ├── config.py             # 配置管理 + 密钥读写
│       ├── database.py           # SQLAlchemy + 初始化 + 模板种子数据
│       ├── models/
│       │   └── models.py         # 9 个 ORM 模型
│       ├── routers/
│       │   ├── vehicles.py       # /api/vehicles + 照片上传
│       │   ├── records.py        # /api/records CRUD
│       │   ├── upload.py         # /api/upload OCR
│       │   ├── chat.py           # /api/chat SSE + 反馈
│       │   ├── manuals.py        # /api/manuals 知识库管理
│       │   ├── settings.py       # /api/settings + 测试端点 + 搜索用量
│       │   ├── templates.py      # /api/item-templates CRUD + 导入 + 匹配
│       │   └── dashboard.py      # /api/dashboard AI 预测
│       ├── schemas/
│       │   └── schemas.py        # Pydantic 模型
│       └── services/
│           ├── ocr/
│           │   ├── base.py       # OCR 抽象基类
│           │   ├── factory.py    # OCR 工厂（按配置创建适配器）
│           │   ├── tencent_doc.py # 腾讯云 ExtractDocMulti（默认启用）
│           │   ├── tencent.py    # 腾讯云基础 OCR（未启用）
│           │   ├── aliyun.py     # 阿里云适配器
│           │   └── baidu.py      # 百度云适配器
│           └── rag/
│               ├── chain.py      # RAG 问答链 + 意图分类 + 重排序
│               ├── loader.py     # PDF 加载 + 分块 + 向量化
│               ├── alerts.py     # AI 预测服务（项目 + 成本）
│               ├── progress.py   # SSE 索引进度跟踪
│               └── web_scraper.py # 网页内容提取
```

## API 路由
| 方法 | 路径 | 说明 |
|------|------|------|
| CRUD | `/api/vehicles` | 车辆档案（含照片上传） |
| GET/POST | `/api/records` | 保养记录列表/创建 |
| PUT | `/api/records/{id}` | 编辑保养记录 |
| DELETE | `/api/records/{id}` | 删除保养记录 |
| POST | `/api/upload` | 上传图片 + OCR 识别 |
| POST | `/api/chat` | 智能问答 (SSE 流式，支持搜索模式) |
| POST | `/api/chat/feedback` | 聊天反馈（点赞/点踩） |
| CRUD | `/api/manuals` | 保养手册管理（含 PDF 上传/索引/预览分块） |
| POST | `/api/manuals/web` | 从 URL 导入网页作为知识源 |
| POST | `/api/manuals/reindex-all` | 批量重新索引过时手册 |
| GET/PUT | `/api/settings` | 系统配置 |
| POST | `/api/settings/test-llm` | 测试 LLM 连接 |
| POST | `/api/settings/test-embedding` | 测试 Embedding 模型 |
| POST | `/api/settings/test-ocr` | 测试 OCR 服务 |
| POST | `/api/settings/test-rag` | 测试 RAG 完整流程 |
| POST | `/api/settings/test-search` | 测试搜索 API |
| GET | `/api/settings/search-usage` | 搜索 API 用量（含 Tavily 配额） |
| CRUD | `/api/item-templates` | 项目模板字典（含导入/匹配） |
| GET | `/api/dashboard/prediction` | AI 预测下次保养项目+成本 |

## 数据库表
- **vehicles**: 车辆档案（品牌/型号/VIN/里程等）
- **maintenance_records**: 保养记录（日期/里程/金额/OCR 原文等）
- **maintenance_items**: 保养项目明细
- **settings**: 系统配置键值对（OCR/LLM/Embedding/RAG/搜索参数）
- **manuals**: 保养手册元数据（含 source_type/source_url 区分 PDF/网页源）
- **item_templates**: 项目模板字典（名称/类别/默认价格/匹配关键词）
- **ai_predictions**: AI 预测缓存（预测项目+成本，避免重复调用 LLM）
- **chat_feedback**: 聊天反馈记录（消息 ID/评分/时间戳）
- **search_usage**: 搜索 API 调用量追踪

## 开发进度
- [x] Phase 1: 项目骨架 + 数据库 + 基础 API
- [x] Phase 2: OCR 服务 + 上传录入流程
- [x] Phase 3: RAG Pipeline + 智能问答
- [x] Phase 4: 设置页面 + 手册管理 + 仪表盘
- [x] Phase 5: 前后端联调验证通过
- [x] Phase 6: 腾讯云 ExtractDocMulti OCR + 原图标注可视化校对
- [x] Phase 7: 保养记录管理增强（编辑/手动添加/hash 路由）
- [x] Phase 8: 项目模板字典系统
  - 后端: `ItemTemplate` 模型 + CRUD + 从保养记录导入 + OCR 项目匹配
  - 后端: 12 个预设模板种子数据（机油/刹车片/滤芯等）
  - 前端: `DictionaryPage.tsx` 管理页面
- [x] Phase 9: 仪表盘 AI 预测
  - 后端: `alerts.py` 预测服务 + `ai_predictions` 缓存表
  - 后端: `/api/dashboard/prediction` 接口
  - 前端: 仪表盘 3 栏预测 UI
- [x] Phase 10: ChatPanel 增强
  - 可调整大小的右侧聊天面板（取代独立 AssistantPage）
  - Markdown 渲染 + 引用徽章 `[1]` `[2]` 链接源文档
  - 源查看弹窗（PDF 页面图片/网页内容/搜索结果）
  - 复制/反馈/重新生成按钮 + 欢迎卡片
- [x] Phase 11: 网络搜索集成
  - Tavily API 搜索，聊天面板可切换开关
  - `search_usage` 表追踪调用量
  - `/api/settings/search-usage` 带配额检查 + 5 分钟缓存
- [x] Phase 12: RAG 重排序 + 网页知识源
  - 可配置重排序 API（Cohere 或兼容服务）
  - `web_scraper.py` 网页抓取 + trafilatura 解析
  - 手册 embedding 模型变更时自动标记 stale
  - 批量重新索引 + SSE 索引进度流
- [x] Phase 13: PDF 查看器 + 侧边栏折叠
  - 全屏 PDF 查看器（缩放/旋转/翻页，react-pdf）
  - 侧边栏可折叠，打开聊天面板自动折叠
  - PDF 查看器 hash 路由: `#pdf-viewer/{manualId}?page=N`
- [ ] 待做: OCR 识别效果调优、拖拽上传优化、响应式适配、补充百度/阿里云坐标支持

## 启动方式
```bash
# 后端（从 backend 目录启动）
cd backend
python3 -m uvicorn app.main:app --reload --port 8000

# 前端（从 frontend 目录启动）
cd frontend
/opt/homebrew/bin/npm run dev  # http://localhost:3000, 自动代理 /api 到后端
```
- 后端 API 文档: http://localhost:8000/docs
- Python: /opt/miniconda3/bin/python3
- Node.js: /opt/homebrew/bin/node (v25.9.0)

## 协作规范
- 收到需求后先给方案（改哪些文件、怎么改），用户确认后再执行，不要直接改代码

## 关键决策
- 数据库选 SQLite：个人使用足够，零配置，后续可迁移
- OCR 策略模式：后台配置切换云厂商，不硬编码；腾讯云默认用 ExtractDocMulti
- RAG 用 LangChain + ChromaDB：成熟方案，本地向量存储；支持可选重排序提升检索质量
- 搜索用 Tavily API：聊天面板内置网络搜索，带用量追踪和配额检查
- 前端 React + Vite：与原型一致，后续 React Native 转 App
- 状态管理用 Zustand：轻量，替代 Context/Redux
- 密钥管理：敏感密钥存 `.env`，非敏感配置存数据库 `settings` 表
