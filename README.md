# 车辆管家 (CarCare)

个人车辆维护保养分析系统。通过 OCR 自动识别结算单、RAG 智能问答、AI 保养预测，帮助车主管理保养记录和养车成本。

## 功能

- **OCR 上传录入**：上传保养结算单图片/PDF，多模态大模型自动识别日期、里程、项目、费用等字段，PaddleOCR 辅助坐标定位，原图标注高亮校对。支持单张和批量上传。
- **保养记录管理**：列表查看、手动添加、编辑、删除保养记录，按日期/里程排序、分页。入库前 vehicle+date 查重拦截。
- **保养知识库**：上传车辆保养手册 PDF 或导入网页，自动向量化索引，支持 RAG 智能检索。可选重排序（Rerank）提升检索质量。
- **AI 助手**：右侧聊天面板，基于保养手册和历史记录回答问题，支持引用标注、源查看、Markdown 渲染、联网搜索。
- **仪表盘**：车辆信息总览、保养花费趋势图表、项目分布饼图、AI 预测下次保养项目和费用（缓存 + 按需生成）。
- **项目字典**：保养项目模板库，预设常见项目及参考价格，OCR 识别时自动匹配。
- **多用户支持**：用户注册登录、JWT 认证、角色权限（管理员/普通用户）、车辆分享。

## 功能截图

<!-- TODO: 替换为实际截图，建议放到 docs/screenshots/ 目录 -->

![OCR 上传录入](docs/screenshots/ocr-upload.png)
*OCR 上传录入：多模态大模型识别结算单，原图标注高亮校对*

![保养记录管理](docs/screenshots/records-list.png)
*保养记录管理：列表查看、分页、排序、编辑*

![AI 助手](docs/screenshots/ai-chat.png)
*AI 助手：基于保养手册和历史记录的智能问答，支持引用标注*

![仪表盘](docs/screenshots/dashboard.png)
*仪表盘：花费趋势图表、项目分布饼图、AI 保养预测*

![保养知识库](docs/screenshots/knowledge-base.png)
*保养知识库：PDF 手册上传、向量化索引、RAG 检索*

## 技术架构

### 系统总览

![保养知识库](docs/screenshots/system-architecture.png)

### RAG 知识库检索流程

![ai-chatbot-flowchart](/Users/rainwu/软件开发/车辆维护保养分析系统/docs/screenshots/ai-chatbot-flowchart.png)

### AI 问答流程（chat_stream）

![chat_stream](/Users/rainwu/软件开发/车辆维护保养分析系统/docs/screenshots/chat_stream.png)

### AI 保养预测流程

![ai-prediction-flow](/Users/rainwu/软件开发/车辆维护保养分析系统/docs/screenshots/ai-prediction-flow.png)

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI + SQLAlchemy + SQLite / PostgreSQL + asyncpg |
| 前端 | React 18 + Vite + TypeScript + TailwindCSS + Zustand |
| OCR | 多模态大模型（兼容 OpenAI 协议）+ PaddleOCR 坐标检测 |
| RAG | LangChain + ChromaDB + 兼容 OpenAI 协议的 Embedding + 可选重排序 |
| 搜索 | 百度千帆 AppBuilder |
| 图表 | Recharts |
| 认证 | JWT（python-jose + passlib） |
| 部署 | Docker Compose（多阶段构建：Node 前端 + Python 后端） |

## 快速开始

### 环境要求

- Python 3.12+
- Node.js 18+
- 可用的多模态大模型 API（OpenAI 兼容协议，如 Qwen-VL / GPT-4o）
- （可选）PaddlePaddle 3.3.1 + PaddleOCR 3.5.0，用于文字坐标定位

### 后端

```bash
cd backend
cp .env.example .env    # 编辑 .env 填入 API 密钥
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

后端 API 文档：http://localhost:8000/docs

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端地址：http://localhost:3000（自动代理 `/api` 到后端 8000 端口）

### 初始化配置

1. 打开 http://localhost:3000，使用默认管理员账号登录：`admin@carcare.local` / `admin123`
2. 进入「系统设置」，配置：
   - **对话模型**：LLM API 地址、Key、模型名
   - **OCR 多模态模型**：用于识别结算单的模型（需支持图片输入）
   - **向量模型**：Embedding API 地址、Key、模型名
   - **联网搜索**（可选）：百度千帆 AppBuilder API Key
3. 进入「保养知识」，上传车辆保养手册 PDF（建议上传，提升 AI 问答准确度）

## Docker 部署

```bash
# 1. 准备环境变量
cp .env.example .env
# 编辑 .env，填入各 API 密钥
# 生产环境务必设置 JWT_SECRET（openssl rand -hex 32）

# 2. 启动
docker compose up -d

# 3. 查看日志
docker compose logs -f
```

服务默认监听 `0.0.0.0:8000`。数据持久化在 `./data` 目录（SQLite 数据库、上传文件、向量库、车辆照片）。

### 启用 PostgreSQL

取消 `docker-compose.yml` 中 postgres 服务的注释，并在 `.env` 中设置：

```env
DATABASE_URL=postgresql+asyncpg://carcare:carcare2024@postgres:5432/carcare
```

### 从 SQLite 迁移数据到 PostgreSQL

```bash
# SSH 隧道转发 PG 端口（如果 PG 不对外暴露）
ssh -L 5433:localhost:5432 root@<服务器IP>

# 运行迁移脚本
cd backend
DATABASE_URL=postgresql+asyncpg://carcare:carcare2024@localhost:5433/carcare python migrate_to_pg.py
```

## 项目结构

```
├── backend/
│   ├── .env / .env.example       # 密钥配置 / 配置模板
│   ├── requirements.txt
│   ├── Dockerfile                # 多阶段构建
│   ├── docker-compose.yml
│   ├── migrate_to_pg.py          # SQLite → PG 迁移脚本
│   ├── data/                     # 数据库 + 向量存储 + 上传文件 + 照片
│   └── app/
│       ├── main.py               # FastAPI 入口
│       ├── config.py             # 配置管理 + 密钥读写
│       ├── database.py           # SQLAlchemy + 初始化 + PG/SQLite 切换
│       ├── storage.py            # 存储抽象层（本地 / S3）
│       ├── models/models.py      # ORM 模型（11 个表）
│       ├── routers/              # API 路由（10 个模块）
│       ├── schemas/schemas.py    # Pydantic 模型
│       └── services/
│           ├── auth.py           # JWT 认证服务
│           ├── ocr/              # OCR 服务（多模态 LLM + PaddleOCR 坐标）
│           └── rag/              # RAG 检索 + AI 预测 + 网页抓取
├── frontend/
│   └── src/
│       ├── App.tsx               # 主应用 + 侧边栏 + 路由
│       ├── api/client.ts         # API 客户端
│       ├── hooks/useStore.ts     # Zustand 全局状态
│       ├── pages/                # 页面组件（10 个）
│       └── components/           # 公共组件（ChatPanel、AuthGuard）
└── CLAUDE.md                     # 开发文档
```

## 数据库表

| 表 | 说明 |
|---|---|
| `vehicles` | 车辆档案 |
| `maintenance_records` | 保养记录 |
| `maintenance_items` | 保养项目明细 |
| `manuals` | 保养手册（PDF / 网页源） |
| `item_templates` | 项目模板字典 |
| `ai_predictions` | AI 预测缓存 |
| `settings` | 系统配置键值对 |
| `users` | 用户 |
| `vehicle_shares` | 车辆分享 |
| `chat_feedback` | 聊天反馈 |
| `search_usage` | 搜索用量追踪 |
