FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
RUN npm config set registry https://registry.npmmirror.com
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

# PaddlePaddle 需要 libgomp1（先切到阿里云 Debian 镜像，避免 Docker Desktop DNS 劫持问题）
RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 先装 Paddle（它需要特定版本依赖），再装其他包
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ --default-timeout=600 $(grep 'paddle' requirements.txt)
RUN grep -v 'paddle' requirements.txt > /tmp/requirements-small.txt \
    && pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ --default-timeout=600 -r /tmp/requirements-small.txt

COPY backend/ .
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
RUN mkdir -p /app/data/files /app/data/chroma /app/data/manual_pages

# 禁用 oneDNN 避免 Paddle 3.x PIR 模型格式兼容问题
ENV FLAGS_use_onednn=0
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
