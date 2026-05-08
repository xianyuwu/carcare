# 车辆管家 (CarCare)

个人车辆维护保养分析系统。通过 OCR 自动识别结算单、RAG 智能问答、AI 保养预测，帮助车主管理保养记录和养车成本。

## 功能

- **OCR 上传录入**：上传保养结算单图片，多模态大模型自动识别日期、里程、项目、费用等字段，支持原图标注校对。支持单张和批量上传。
- **保养记录管理**：列表查看、手动添加、编辑、删除保养记录，按日期排序、分页。
- **保养知识库**：上传车辆保养手册 PDF 或导入网页，自动向量化索引，支持 RAG 智能检索。
- **AI 助手**：右侧聊天面板，基于保养手册和历史记录回答问题，支持联网搜索。
- **仪表盘**：车辆信息总览、保养花费趋势图表、项目分布饼图、AI 预测下次保养项目和费用。
- **项目字典**：保养项目模板库，预设常见项目及参考价格，OCR 识别时自动匹配。
- **多用户支持**：用户注册登录、角色权限（管理员/普通用户）、车辆分享。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + SQLAlchemy + SQLite + aiosqlite |
| 前端 | React 18 + Vite + TypeScript + TailwindCSS + Zustand |
| OCR | 多模态大模型（兼容 OpenAI 协议，默认 Qwen-VL） |
| RAG | LangChain + ChromaDB + 兼容 OpenAI 协议的 Embedding |
| 搜索 | Tavily API |
| 图表 | Recharts |

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- 可用的多模态大模型 API（OpenAI 兼容协议，如 Qwen-VL / GPT-4o）

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
   - **联网搜索**（可选）：Tavily API Key
3. 进入「保养知识」，上传车辆保养手册 PDF（建议上传）

## 项目结构

```
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── config.py            # 配置管理 + 密钥读写
│   │   ├── database.py          # SQLAlchemy + 初始化
│   │   ├── models/models.py     # ORM 模型
│   │   ├── routers/             # API 路由
│   │   ├── schemas/schemas.py   # Pydantic 模型
│   │   └── services/
│   │       ├── ocr/             # OCR 服务（多模态 LLM）
│   │       └── rag/             # RAG 检索 + AI 预测
│   └── data/                    # 数据库 + 向量存储 + 上传文件
├── frontend/
│   └── src/
│       ├── App.tsx              # 主应用 + 路由
│       ├── api/client.ts        # API 客户端
│       ├── hooks/useStore.ts    # Zustand 状态管理
│       ├── pages/               # 页面组件
│       └── components/          # 公共组件
└── CLAUDE.md                    # 开发文档
```

## 数据库表

| 表 | 说明 |
|---|---|
| `vehicles` | 车辆档案 |
| `maintenance_records` | 保养记录 |
| `maintenance_items` | 保养项目明细 |
| `manuals` | 保养手册 |
| `item_templates` | 项目模板字典 |
| `ai_predictions` | AI 预测缓存 |
| `settings` | 系统配置 |
| `users` | 用户 |
| `chat_feedback` | 聊天反馈 |
| `search_usage` | 搜索用量追踪 |
