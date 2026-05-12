# ─── Stage 1: 编译前端 ───
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: 运行后端 + 托管前端 ───
FROM python:3.12-slim
WORKDIR /app

# 系统依赖：PyMuPDF 需要 libmupdf，PaddleOCR 需要 libgomp1
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 后端代码
COPY backend/ .

# 前端编译产物
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# 数据目录（挂载卷）
RUN mkdir -p /app/data/files /app/data/chroma /app/data/manual_pages

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
