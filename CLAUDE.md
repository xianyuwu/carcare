# 车辆维护保养分析系统 (CarCare)

## 技术栈
- **后端**: FastAPI + SQLAlchemy + SQLite + aiosqlite
- **前端**: React 18 + Vite + TypeScript + TailwindCSS + Zustand
- **OCR**: 多模态大模型（兼容 OpenAI 协议，默认 Qwen-VL），已替换旧的腾讯/阿里/百度云 OCR
- **RAG**: LangChain + ChromaDB + OpenAI 兼容协议 LLM + 可选重排序
- **搜索**: Tavily API（网络搜索，聊天面板可切换）
- **向量数据库**: ChromaDB（本地嵌入）
- **认证**: JWT（python-jose + passlib），OAuth2PasswordBearer

## 项目结构
```
车辆维护保养分析系统/
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # 主应用外壳 + 侧边栏（品牌+菜单+用户信息） + 路由
│   │   ├── main.tsx              # React 入口
│   │   ├── api/
│   │   │   └── client.ts         # 统一 API 客户端
│   │   ├── hooks/
│   │   │   └── useStore.ts       # Zustand 全局状态（含 auth/chatOpen/sidebar/chatMaximized）
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # 仪表盘 + AI 预测 + 花费趋势/项目分布图表
│   │   │   ├── RecordsList.tsx   # 保养记录列表（分页/排序/查重/CRUD 弹窗）
│   │   │   ├── UploadPage.tsx    # OCR 上传（单张+批量模式，串行处理队列，置信度可配置）
│   │   │   ├── ManualPage.tsx    # 知识库管理（手册/网页源）
│   │   │   ├── VehiclePage.tsx   # 车辆档案 CRUD
│   │   │   ├── DictionaryPage.tsx # 项目模板字典
│   │   │   ├── SettingsPage.tsx  # 系统配置（Tab: 服务配置/检索参数/用户管理）
│   │   │   ├── PdfViewerPage.tsx # 全屏 PDF 查看器（缩放/旋转/翻页）
│   │   │   ├── LoginPage.tsx     # 登录页
│   │   │   └── AdminUsersPage.tsx # 用户管理（嵌入设置页，仅管理员可见）
│   │   └── components/
│   │       ├── ChatPanel.tsx      # AI 聊天面板（引用标注/源查看/Markdown/联网搜索/最大化）
│   │       └── AuthGuard.tsx      # 路由守卫 + 用户信息同步到 store
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
│       │   └── models.py         # ORM 模型（11 个表）
│       ├── routers/
│       │   ├── vehicles.py       # /api/vehicles + 照片上传
│       │   ├── records.py        # /api/records CRUD + 分页 + 查重
│       │   ├── upload.py         # /api/upload OCR
│       │   ├── chat.py           # /api/chat SSE + 反馈
│       │   ├── manuals.py        # /api/manuals 知识库管理
│       │   ├── settings.py       # /api/settings + 测试端点 + 搜索用量
│       │   ├── templates.py      # /api/item-templates CRUD + 导入 + 匹配
│       │   ├── dashboard.py      # /api/dashboard AI 预测（缓存 + 按需生成）
│       │   ├── auth.py           # /api/auth 注册/登录/刷新/当前用户
│       │   └── admin_users.py    # /api/admin/users 管理员用户管理
│       ├── schemas/
│       │   └── schemas.py        # Pydantic 模型
│       └── services/
│           ├── ocr/
│           │   ├── factory.py    # OCR 工厂（按配置创建适配器）
│           │   ├── llm_ocr.py    # 多模态 LLM OCR（默认启用，替代旧云厂商）
│           │   ├── paddle_detector.py  # PaddleOCR 文字检测（坐标定位辅助）
│           │   └── prompts.py    # OCR 提示词模板
│           ├── rag/
│           │   ├── chain.py      # RAG 问答链 + 意图分类 + 重排序
│           │   ├── loader.py     # PDF 加载 + 分块 + 向量化
│           │   ├── alerts.py     # AI 预测服务（项目 + 成本，180s 超时）
│           │   ├── progress.py   # SSE 索引进度跟踪
│           │   └── web_scraper.py # 网页内容提取
│           └── auth.py           # JWT 认证服务（哈希/验证/令牌生成）
```

## API 路由
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 登录（OAuth2 表单格式） |
| POST | `/api/auth/refresh` | 刷新令牌 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| CRUD | `/api/vehicles` | 车辆档案（含照片上传） |
| GET | `/api/records?page=&page_size=&sort_order=` | 保养记录列表（分页+排序） |
| GET | `/api/records/check-duplicate` | 检查同车辆同日是否已有记录 |
| POST | `/api/records` | 创建保养记录 |
| PUT | `/api/records/{id}` | 编辑保养记录 |
| DELETE | `/api/records/{id}` | 删除保养记录 |
| POST | `/api/upload` | 上传图片 + OCR 识别 |
| POST | `/api/chat` | 智能问答 (SSE 流式，支持搜索模式) |
| POST | `/api/chat/feedback` | 聊天反馈（点赞/点踩） |
| CRUD | `/api/manuals` | 保养手册管理（含 PDF 上传/索引/预览分块） |
| POST | `/api/manuals/web` | 从 URL 导入网页作为知识源 |
| POST | `/api/manuals/reindex-all` | 批量重新索引过时手册 |
| GET | `/api/manuals/{id}/file` | 返回手册原始 PDF 文件 |
| GET | `/api/manuals/{id}/page/{n}` | 返回手册页面图片 |
| GET/PUT | `/api/settings` | 系统配置 |
| POST | `/api/settings/test-llm` | 测试 LLM 连接 |
| POST | `/api/settings/test-embedding` | 测试 Embedding 模型 |
| POST | `/api/settings/test-ocr` | 测试 OCR 服务 |
| POST | `/api/settings/test-rag` | 测试 RAG 完整流程 |
| POST | `/api/settings/test-search` | 测试搜索 API |
| GET | `/api/settings/search-usage` | 搜索 API 用量（含 Tavily 配额） |
| CRUD | `/api/item-templates` | 项目模板字典（含导入/匹配） |
| GET | `/api/dashboard/prediction?vehicle_id=` | 获取缓存的 AI 预测 |
| POST | `/api/dashboard/prediction/generate?vehicle_id=` | 重新生成 AI 预测 |

## 数据库表
- **vehicles**: 车辆档案（品牌/型号/VIN/里程/照片/owner_id）
- **maintenance_records**: 保养记录（日期/里程/金额/OCR 原文/user_id）
- **maintenance_items**: 保养项目明细（名称/配件号/操作类型/配件费/工费）
- **settings**: 系统配置键值对（OCR/LLM/Embedding/RAG/搜索参数）
- **manuals**: 保养手册元数据（含 source_type/source_url 区分 PDF/网页源，user_id）
- **item_templates**: 项目模板字典（名称/类别/默认价格）
- **ai_predictions**: AI 预测缓存（预测项目+费用，避免重复调用 LLM）
- **chat_feedback**: 聊天反馈记录（消息 ID/评分/时间戳）
- **search_usage**: 搜索 API 调用量追踪
- **users**: 用户（email/password_hash/nickname/role/is_active）
- **vehicle_shares**: 车辆分享（vehicle_id/user_id/permission）

## 开发进度
- [x] Phase 1: 项目骨架 + 数据库 + 基础 API
- [x] Phase 2: OCR 服务 + 上传录入流程
- [x] Phase 3: RAG Pipeline + 智能问答
- [x] Phase 4: 设置页面 + 手册管理 + 仪表盘
- [x] Phase 5: 前后端联调验证通过
- [x] Phase 6: 多模态 LLM OCR 替代旧云厂商 OCR + 原图标注可视化校对
- [x] Phase 7: 保养记录管理增强（编辑/手动添加/hash 路由/分页/排序）
- [x] Phase 8: 项目模板字典系统
- [x] Phase 9: 仪表盘 AI 预测（缓存 + 按需重新生成，图表渲染修复）
- [x] Phase 10: ChatPanel 增强（引用标注/源查看/Markdown/最大化/联网搜索/仅展示引用来源）
- [x] Phase 11: 网络搜索集成（Tavily API + 用量追踪）
- [x] Phase 12: RAG 重排序 + 网页知识源
- [x] Phase 13: PDF 查看器 + 侧边栏折叠
- [x] Phase 14: 用户认证系统（JWT + 角色权限 + 车辆分享）
- [x] Phase 15: 设置页 Tab 布局（服务配置/检索参数/用户管理）
- [x] Phase 16: 批量上传录入（串行处理队列/逐张审核/查重防重复/置信度阈值可配置）
- [x] Phase 17: 入库前 vehicle+date 查重
- [ ] 待做: 响应式适配、拖拽上传优化、保养项目去重（LLM 归一化）

## 启动方式
```bash
# 后端（从 backend 目录启动）
cd backend
python3 -m uvicorn app.main:app --reload --port 8000

# 前端（从 frontend 目录启动）
cd frontend
npm run dev  # http://localhost:3000, 自动代理 /api 到后端
```
- 后端 API 文档: http://localhost:8000/docs
- 默认管理员: admin@carcare.local / admin123
- Python: /opt/miniconda3/bin/python3
- Node.js: /opt/homebrew/bin/node (v25.9.0)

## 协作规范
- 收到需求后先给方案（改哪些文件、怎么改），用户确认后再执行，不要直接改代码

## 关键决策
- 数据库选 SQLite：个人使用足够，零配置，后续可迁移
- OCR 改为多模态 LLM：统一兼容 OpenAI 协议的模型，不再依赖云厂商 SDK；坐标定位用 PaddleOCR 辅助
- RAG 用 LangChain + ChromaDB：成熟方案，本地向量存储；支持可选重排序提升检索质量
- 搜索用 Tavily API：聊天面板内置网络搜索，带用量追踪和配额检查
- 前端 React + Vite：单页应用，hash 路由
- 状态管理用 Zustand：轻量，替代 Context/Redux
- 密钥管理：敏感密钥存 `.env`，非敏感配置存数据库 `settings` 表
- 认证用 JWT：access token + refresh token，OAuth2PasswordBearer
- 批量上传串行处理：避免 LLM API 限流，间隔 5 秒，单文件 10 分钟超时
- 入库查重：vehicle_id + date 软拦截，弹窗确认而非硬拒绝
- 参考资料仅显示被引用的来源：过滤未在回复中标注 [N] 的链接
