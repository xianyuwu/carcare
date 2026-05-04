from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import time

from app.database import get_db
from app.models import Setting, Manual
from app.schemas import SettingsUpdate
from app.config import DEFAULT_SETTINGS, get_secret, get_all_secrets, update_secrets, ENV_SECRETS, is_masked

router = APIRouter(prefix="/api/settings", tags=["settings"])


async def _get_setting_value(db: AsyncSession, key: str) -> str:
    """获取配置值：敏感密钥从环境变量读，其余从数据库读"""
    from app.config import ENV_SECRETS
    if key in ENV_SECRETS:
        return get_secret(key)
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else ""


@router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    # 非敏感配置从数据库读
    result = await db.execute(select(Setting))
    rows = result.scalars().all()
    settings_map = {row.key: row.value for row in rows}
    db_settings = {key: settings_map.get(key, default) for key, default in DEFAULT_SETTINGS.items()}
    # 敏感密钥从 .env 读（脱敏）
    secrets = get_all_secrets()
    return {**db_settings, **secrets}


@router.put("")
async def update_settings(data: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    # 保存前读取旧的 embedding 模型值
    old_emb_model = ""
    result = await db.execute(select(Setting).where(Setting.key == "llm_embedding_model"))
    row = result.scalar_one_or_none()
    if row:
        old_emb_model = row.value

    secret_updates = {}
    new_emb_model = old_emb_model
    for item in data.settings:
        item.value = item.value.strip()
        if item.key == "llm_embedding_model":
            new_emb_model = item.value
        if item.key in ENV_SECRETS:
            # 密钥：脱敏值跳过，新值收集后写入
            if not is_masked(item.value) and item.value:
                secret_updates[item.key] = item.value
            continue
        # 非密钥配置写入数据库
        existing = await db.get(Setting, item.key)
        if existing:
            existing.value = item.value
        else:
            db.add(Setting(key=item.key, value=item.value))
    await db.commit()
    # 批量更新密钥
    if secret_updates:
        update_secrets(secret_updates)

    # Embedding 模型变更：将所有 ready 手册标记为 stale
    if new_emb_model != old_emb_model and old_emb_model:
        from sqlalchemy import update as sa_update
        await db.execute(
            sa_update(Manual).where(Manual.status == "ready").values(status="stale")
        )
        await db.commit()

    return {"ok": True}


@router.post("/test-llm")
async def test_llm(db: AsyncSession = Depends(get_db)):
    import httpx

    api_url = await _get_setting_value(db, "llm_api_url")
    api_key = get_secret("llm_api_key")
    model = await _get_setting_value(db, "llm_model")

    if not api_url or not api_key:
        return {"ok": False, "error": "请先配置 API Key 和 API 地址", "elapsed": 0}

    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model or "gpt-4o", "messages": [{"role": "user", "content": "Say hello"}], "max_tokens": 500},
            )
            elapsed = round(time.time() - start, 2)
            if resp.status_code == 200:
                data = resp.json()
                msg = data.get("choices", [{}])[0].get("message", {})
                reply = msg.get("content", "").strip()
                reasoning = msg.get("reasoning_content", "").strip()
                return {"ok": True, "model_requested": model or "gpt-4o", "model_actual": data.get("model", model), "reply": reply, "reasoning": reasoning[:200], "elapsed": elapsed}
            else:
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:300]}", "elapsed": elapsed}
    except Exception as e:
        return {"ok": False, "error": str(e), "elapsed": round(time.time() - start, 2)}


@router.post("/test-embedding")
async def test_embedding(db: AsyncSession = Depends(get_db)):
    import httpx

    api_url = await _get_setting_value(db, "llm_embedding_api_url")
    api_key = get_secret("llm_embedding_api_key")
    model = await _get_setting_value(db, "llm_embedding_model")

    if not api_url or not api_key:
        return {"ok": False, "error": "请先配置 API Key 和 API 地址", "elapsed": 0}

    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/embeddings",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model or "text-embedding-3-small", "input": "Hello world"},
            )
            elapsed = round(time.time() - start, 2)
            if resp.status_code == 200:
                data = resp.json()
                embedding = data.get("data", [{}])[0].get("embedding", [])
                return {"ok": True, "model": data.get("model", model), "dimensions": len(embedding), "elapsed": elapsed}
            else:
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:300]}", "elapsed": elapsed}
    except Exception as e:
        return {"ok": False, "error": str(e), "elapsed": round(time.time() - start, 2)}


@router.post("/test-ocr")
async def test_ocr(db: AsyncSession = Depends(get_db)):
    provider = await _get_setting_value(db, "ocr_provider")

    start = time.time()
    try:
        from io import BytesIO
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGB", (300, 80), "white")
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("/System/Library/Helvetica.ttc", 36)
        except Exception:
            font = ImageFont.load_default()
        draw.text((20, 20), "CARCARE TEST", fill="black", font=font)

        buf = BytesIO()
        img.save(buf, format="PNG")
        image_bytes = buf.getvalue()

        from app.services.ocr.factory import get_ocr_service
        service = await get_ocr_service(db)
        result = await service.recognize(image_bytes)
        elapsed = round(time.time() - start, 2)

        recognized = result.raw_text.strip() if result.raw_text else ""
        return {"ok": True, "provider": provider, "recognized": recognized[:200], "elapsed": elapsed}
    except Exception as e:
        elapsed = round(time.time() - start, 2)
        return {"ok": False, "error": str(e), "elapsed": elapsed}


@router.post("/test-rag")
async def test_rag(db: AsyncSession = Depends(get_db)):
    """验证 RAG 检索参数配置：Top K、Score 阈值、Rerank 连通性"""
    start = time.time()
    errors = []
    info: dict = {}

    # 1. 验证 Top K
    try:
        top_k = int(await _get_setting_value(db, "rag_top_k") or "5")
        if not 1 <= top_k <= 20:
            errors.append("Top K 必须在 1-20 之间")
        info["top_k"] = top_k
    except ValueError:
        errors.append("Top K 格式错误，必须是整数")

    # 2. 验证 Score 阈值
    try:
        threshold = float(await _get_setting_value(db, "rag_score_threshold") or "0.5")
        if not 0 <= threshold <= 1:
            errors.append("Score 阈值必须在 0-1 之间")
        info["score_threshold"] = threshold
    except ValueError:
        errors.append("Score 阈值格式错误，必须是数字")

    # 3. 验证嵌入截断长度
    try:
        max_chars = int(await _get_setting_value(db, "rag_embed_max_chars") or "200")
        if not 50 <= max_chars <= 2000:
            errors.append("嵌入截断长度必须在 50-2000 之间")
        info["embed_max_chars"] = max_chars
    except ValueError:
        errors.append("嵌入截断长度格式错误，必须是整数")

    # 4. 验证 Rerank（如果启用）
    rerank_enabled = (await _get_setting_value(db, "rag_rerank_enabled") or "false").lower() == "true"
    info["rerank_enabled"] = rerank_enabled
    if rerank_enabled:
        rerank_url = await _get_setting_value(db, "rag_rerank_api_url")
        rerank_key = get_secret("rag_rerank_api_key")
        rerank_model = await _get_setting_value(db, "rag_rerank_model")
        if not rerank_url:
            errors.append("Rerank 已启用但未配置 API 地址")
        elif not rerank_key:
            errors.append("Rerank 已启用但未配置 API 密钥")
        else:
            # 尝试连通性测试
            import httpx
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.post(
                        f"{rerank_url.rstrip('/')}/rerank",
                        headers={"Authorization": f"Bearer {rerank_key}", "Content-Type": "application/json"},
                        json={"model": rerank_model, "query": "test", "documents": ["hello"], "top_n": 1},
                    )
                    if resp.status_code == 200:
                        info["rerank_model"] = rerank_model
                    else:
                        errors.append(f"Rerank API 返回 {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                errors.append(f"Rerank 连接失败: {e}")

    elapsed = round(time.time() - start, 2)
    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "info": info,
        "elapsed": elapsed,
    }


@router.post("/test-search")
async def test_search(db: AsyncSession = Depends(get_db)):
    """测试联网搜索 API 连通性"""
    import httpx

    api_url = await _get_setting_value(db, "search_api_url")
    api_key = get_secret("search_api_key")

    if not api_url or not api_key:
        return {"ok": False, "error": "请先配置搜索 API Key 和 API 地址", "elapsed": 0}

    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/search",
                headers={"Content-Type": "application/json"},
                json={
                    "api_key": api_key,
                    "query": "汽车保养机油更换周期",
                    "max_results": 1,
                    "include_answer": False,
                },
            )
            elapsed = round(time.time() - start, 2)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                return {"ok": True, "query": "汽车保养机油更换周期", "results": len(results), "elapsed": elapsed}
            else:
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:300]}", "elapsed": elapsed}
    except Exception as e:
        return {"ok": False, "error": str(e), "elapsed": round(time.time() - start, 2)}

# Tavily 用量缓存（5 分钟 TTL，避免触发限流）
_tavily_cache: dict = {"data": None, "expires": 0}


@router.get("/search-usage")
async def get_search_usage(db: AsyncSession = Depends(get_db)):
    """查询搜索用量：本地当月统计 + Tavily API 实时额度"""
    from app.models.models import SearchUsage
    from datetime import datetime
    import httpx
    import time as _time

    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)

    result = await db.execute(
        select(func.count(SearchUsage.id)).where(SearchUsage.created_at >= month_start)
    )
    local_count = result.scalar() or 0

    limit = int(await _get_setting_value(db, "search_monthly_limit") or "1000")

    # Tavily API：缓存 5 分钟，避免 10 次/10 分钟限流
    tavily_info = None
    if _tavily_cache["data"] and _time.time() < _tavily_cache["expires"]:
        tavily_info = _tavily_cache["data"]
    else:
        api_url = await _get_setting_value(db, "search_api_url")
        api_key = get_secret("search_api_key")
        if api_url and api_key:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{api_url.rstrip('/')}/usage",
                        headers={"Authorization": f"Bearer {api_key}"},
                    )
                    if resp.status_code == 200:
                        tavily_info = resp.json()
                        _tavily_cache["data"] = tavily_info
                        _tavily_cache["expires"] = _time.time() + 300  # 5 分钟
            except Exception:
                # 失败时用缓存（即使过期也比没有好）
                if _tavily_cache["data"]:
                    tavily_info = _tavily_cache["data"]

    # 优先用 Tavily 的实际用量，本地仅作备用
    used = local_count
    real_limit = limit
    if tavily_info and tavily_info.get("account"):
        acc = tavily_info["account"]
        used = acc.get("plan_usage", local_count)
        real_limit = acc.get("plan_limit", limit)

    return {
        "month": f"{now.year}-{now.month:02d}",
        "local_used": local_count,
        "used": used,
        "monthly_limit": real_limit,
        "remaining": max(0, real_limit - used),
        "tavily": tavily_info,
    }
