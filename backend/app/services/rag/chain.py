"""RAG 问答链 - SSE 流式输出"""
import json
import logging
import time
from typing import AsyncGenerator

from app.config import CHROMA_DIR

logger = logging.getLogger(__name__)

# 意图分类 prompt
def _classify_intent_keyword(question: str) -> str:
    """关键词规则意图分类，零延迟"""
    q = question.strip().lower()
    # 闲聊关键词
    greet_words = ["你好", "在吗", "谢谢", "再见", "你是谁", "hi", "hello", "hey", "thanks", "thank", "bye", "你是谁", "你能做什么", "你可以做什么"]
    if any(w in q for w in greet_words) and len(q) < 20:
        return "1"
    # 记录查询关键词
    record_words = ["最近保养", "花了多少钱", "保养历史", "上次保养", "记录", "花了多少", "什么时候做的", "做过哪些", "做了哪些", "换过什么", "换过哪些", "保养几次", "保养记录", "保养明细", "花了", "花费", "费用明细"]
    if any(w in q for w in record_words):
        return "3"
    # 其余都是保养咨询
    return "2"


async def _get_llm_config() -> dict:
    from app.database import async_session
    from app.routers.settings import _get_setting_value
    from app.config import get_secret

    async with async_session() as db:
        return {
            "api_url": await _get_setting_value(db, "llm_api_url"),
            "api_key": get_secret("llm_api_key"),
            "model": await _get_setting_value(db, "llm_model"),
            "embedding_api_url": await _get_setting_value(db, "llm_embedding_api_url"),
            "embedding_api_key": get_secret("llm_embedding_api_key"),
            "embedding_model": await _get_setting_value(db, "llm_embedding_model"),
            # RAG 检索参数
            "rag_top_k": int(await _get_setting_value(db, "rag_top_k") or "5"),
            "rag_score_threshold": float(await _get_setting_value(db, "rag_score_threshold") or "0.5"),
            # Rerank 配置
            "rag_rerank_enabled": (await _get_setting_value(db, "rag_rerank_enabled") or "false").lower() == "true",
            "rag_rerank_api_url": await _get_setting_value(db, "rag_rerank_api_url") or "",
            "rag_rerank_api_key": get_secret("rag_rerank_api_key"),
            "rag_rerank_model": await _get_setting_value(db, "rag_rerank_model") or "",
            # 联网搜索
            "search_api_url": await _get_setting_value(db, "search_api_url") or "https://qianfan.baidubce.com/v2/ai_search",
            "search_api_key": get_secret("search_api_key"),
        }


async def _record_search_usage(query: str):
    """记录一次搜索调用到数据库"""
    from app.database import async_session
    from app.models.models import SearchUsage

    async with async_session() as db:
        db.add(SearchUsage(query=query, credits=1))
        await db.commit()


async def _web_search(question: str, config: dict) -> tuple[str, list[dict]]:
    """调用百度千帆联网搜索 API，原生中文搜索"""
    import httpx

    api_key = config.get("search_api_key", "")
    if not api_key:
        return "", []

    api_url = config.get("search_api_url", "https://qianfan.baidubce.com/v2/ai_search").rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{api_url}/web_search",
                headers={
                    "X-Appbuilder-Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "messages": [{"role": "user", "content": question}],
                    "search_source": "baidu_search_v2",
                    "resource_type_filter": [{"type": "web", "top_k": 3}],
                },
            )
            if resp.status_code != 200:
                logger.warning("百度搜索 API 返回 %s: %s", resp.status_code, resp.text[:200])
                return "", []
            data = resp.json()
            results = data.get("references", [])
            if not results:
                return "", []
            parts = []
            sources = []
            for r in results:
                title = r.get("title", "")
                content = r.get("content", "")
                url = r.get("url", "")
                parts.append(f"- {title}\n  {content}\n  来源：{url}")
                sources.append({"title": title, "url": url, "content": content})
            await _record_search_usage(question)
            return "\n\n".join(parts), sources
    except Exception as e:
        logger.warning("联网搜索失败: %s", e)
        return "", []


async def _get_vehicle_context(vehicle_id: int) -> str:
    from app.database import async_session
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models import Vehicle, MaintenanceRecord

    async with async_session() as db:
        vehicle = await db.get(Vehicle, vehicle_id)
        if not vehicle:
            return "未找到车辆信息"

        stmt = (
            select(MaintenanceRecord)
            .where(MaintenanceRecord.vehicle_id == vehicle_id)
            .options(selectinload(MaintenanceRecord.items))
            .order_by(MaintenanceRecord.date.desc())
        )
        result = await db.execute(stmt)
        records = result.scalars().all()

    latest_mileage = records[0].mileage if records and records[0].mileage else None
    ctx = f"车辆：{vehicle.brand} {vehicle.model}，当前里程：{latest_mileage or '未知'} km\n"
    if records:
        ctx += "\n全部保养记录（含项目明细）：\n"
        for r in records:
            total = r.paid_amount or 0
            items_str = ""
            if r.items:
                item_parts = []
                for it in r.items:
                    detail = it.name
                    if it.parts_cost or it.labor_cost:
                        detail += f"（配件{it.parts_cost}元+工费{it.labor_cost}元）"
                    item_parts.append(detail)
                items_str = f"：{'、'.join(item_parts)}"
            ctx += f"- {r.date}，{r.mileage}km，{r.type or '保养'}，合计¥{total}{items_str}\n"

    return ctx


async def _get_vehicle_search_prefix(vehicle_id: int) -> str:
    """获取车辆品牌型号里程，用于拼接联网搜索查询"""
    from app.database import async_session
    from sqlalchemy import select
    from app.models import Vehicle, MaintenanceRecord

    async with async_session() as db:
        vehicle = await db.get(Vehicle, vehicle_id)
        if not vehicle:
            return ""
        stmt = (
            select(MaintenanceRecord)
            .where(MaintenanceRecord.vehicle_id == vehicle_id)
            .order_by(MaintenanceRecord.date.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        latest = result.scalar_one_or_none()
        mileage = latest.mileage if latest and latest.mileage else None

    parts = [vehicle.brand, vehicle.model]
    if vehicle.year:
        parts.append(f"{vehicle.year}款")
    if mileage:
        parts.append(f"{mileage}公里")
    return " ".join(p for p in parts if p)


async def _retrieve_context(vehicle_id: int, question: str, config: dict) -> list[dict]:
    """检索相关 chunks，返回带元数据的列表，用于引用标注"""
    import chromadb
    from langchain_openai import OpenAIEmbeddings

    top_k = config.get("rag_top_k", 5)
    score_threshold = config.get("rag_score_threshold", 0.5)

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collections = client.list_collections()
    embeddings = OpenAIEmbeddings(
        model=config.get("embedding_model", "text-embedding-3-small"),
        openai_api_key=config["embedding_api_key"],
        openai_api_base=config["embedding_api_url"],
        check_embedding_ctx_length=False,
    )

    query_embed = await embeddings.aembed_query(question)
    raw_chunks = []

    for col in collections:
        if col.metadata and col.metadata.get("vehicle_id") == vehicle_id:
            # 多取一些，后面会按 score 过滤
            fetch_n = min(top_k * 3, 50)
            results = col.query(query_embeddings=[query_embed], n_results=fetch_n)
            if results["documents"] and results["metadatas"] and results["distances"]:
                for doc, meta, dist in zip(results["documents"][0], results["metadatas"][0], results["distances"][0]):
                    # ChromaDB 默认用 L2 距离，转为余弦相似度的近似值
                    # 距离越小越相似，这里用 1 / (1 + dist) 做近似归一化
                    score = 1.0 / (1.0 + dist)
                    if score >= score_threshold:
                        raw_chunks.append({
                            "text": doc,
                            "manual_id": meta.get("manual_id"),
                            "page": meta.get("page"),
                            "score": score,
                        })

    # 按 score 降序排列，取 top_k
    raw_chunks.sort(key=lambda c: c["score"], reverse=True)
    raw_chunks = raw_chunks[:top_k]

    # Rerank 重排序（如果启用）
    if config.get("rag_rerank_enabled") and config.get("rag_rerank_api_url") and config.get("rag_rerank_api_key"):
        raw_chunks = await _rerank_chunks(question, raw_chunks, config)
        raw_chunks = raw_chunks[:top_k]

    # 查询手册文件名
    manual_ids = list({c["manual_id"] for c in raw_chunks if c["manual_id"]})
    filename_map: dict[int, str] = {}
    source_type_map: dict[int, str] = {}
    source_url_map: dict[int, str] = {}
    if manual_ids:
        from app.database import async_session
        from sqlalchemy import select
        from app.models import Manual
        async with async_session() as db:
            stmt = select(Manual).where(Manual.id.in_(manual_ids))
            result = await db.execute(stmt)
            for manual in result.scalars().all():
                filename_map[manual.id] = manual.filename
                source_type_map[manual.id] = manual.source_type
                source_url_map[manual.id] = manual.source_url or ""

    return [
        {
            "text": c["text"],
            "manual_id": c["manual_id"],
            "page": c["page"],
            "filename": filename_map.get(c["manual_id"], "未知手册"),
            "source_type": source_type_map.get(c["manual_id"], "pdf"),
            "source_url": source_url_map.get(c["manual_id"], ""),
        }
        for c in raw_chunks
    ]


async def _rerank_chunks(question: str, chunks: list[dict], config: dict) -> list[dict]:
    """调用 Rerank API 对 chunks 重排序"""
    import httpx

    api_url = config["rag_rerank_api_url"].rstrip("/")
    api_key = config["rag_rerank_api_key"]
    model = config.get("rag_rerank_model", "")

    documents = [c["text"] for c in chunks]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{api_url}/rerank",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "query": question,
                    "documents": documents,
                    "top_n": len(documents),
                },
            )
            if resp.status_code != 200:
                logger.warning("Rerank API 返回 %s: %s", resp.status_code, resp.text[:200])
                return chunks

            data = resp.json()
            results = data.get("results", [])
            # 按 rerank_score 降序重排
            reranked = []
            for item in sorted(results, key=lambda x: x.get("relevance_score", 0), reverse=True):
                idx = item.get("index", 0)
                if 0 <= idx < len(chunks):
                    reranked.append(chunks[idx])
            return reranked if reranked else chunks
    except Exception as e:
        logger.warning("Rerank 调用失败: %s，使用原始排序", e)
        return chunks


async def chat_stream(vehicle_id: int, question: str, history: list[dict] = [], search: bool | None = None) -> AsyncGenerator[str, None]:
    """SSE 流式问答，带意图路由"""
    import httpx

    t_total = time.time()
    timings: list[str] = []  # 收集各阶段耗时，SSE 流末返回给前端

    # 1. 获取配置
    t0 = time.time()
    try:
        config = await _get_llm_config()
    except Exception as e:
        logger.error("获取 LLM 配置失败: %s", e, exc_info=True)
        yield f"data: {json.dumps({'content': f'LLM 配置读取失败：{e}'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return
    timings.append(f"获取配置: {time.time() - t0:.2f}s")

    # 2. 意图分类（关键词规则，零延迟）
    t0 = time.time()
    intent = _classify_intent_keyword(question)
    timings.append(f"意图分类[{intent}]: {time.time() - t0:.2f}s")

    # 3. 根据意图组装上下文和 system prompt
    # 所有意图共用的硬约束，放在 prompt 开头提高权重
    BOUNDARY = (
        "【严格限制】你只能回答与车辆保养、汽车使用、汽车维护、养车费用相关的问题。"
        "如果用户问的问题与车辆保养无关，拒绝回答，直接回复："
        "\"我是车辆保养顾问，只能回答与车辆保养、汽车使用、维护、养车费用相关的问题。\""
        "不要解释为什么不回答，不要延伸话题。"
    )

    from datetime import date
    today_str = f"\n\n当前日期：{date.today().strftime('%Y年%m月%d日')}。"

    # 联网搜索（意图非闲聊时才搜索），搜索词带上车辆上下文
    search_text = ""
    search_sources: list[dict] = []
    should_search = search or False
    if should_search and intent != "1":
        t0 = time.time()
        vehicle_prefix = await _get_vehicle_search_prefix(vehicle_id)
        search_query = f"{vehicle_prefix} {question}" if vehicle_prefix else question
        search_text, search_sources = await _web_search(search_query, config)
        timings.append(f"联网搜索({len(search_sources)}条): {time.time() - t0:.2f}s")

    # 搜索结果编号函数：在 sources 加载后调用，生成带编号的搜索上下文
    def _build_search_ctx(offset: int) -> tuple[str, list[dict]]:
        """offset = 已有 sources 数量，搜索编号从 offset+1 开始"""
        if not search_sources:
            return "", []
        parts = []
        numbered = []
        for i, s in enumerate(search_sources):
            num = offset + i + 1
            parts.append(f"[{num}] {s['title']}\n{s['content']}\n来源：{s['url']}")
            numbered.append({**s, "id": num})
        ctx = (
            "\n\n## 联网搜索结果\n"
            "以下是从互联网搜索到的相关信息，请结合这些信息回答。\n\n"
            + "\n\n".join(parts)
            + "\n\n请注意：搜索结果仅供参考，请结合保养手册和车辆记录给出建议。"
        )
        return ctx, numbered

    sources: list[dict] = []
    rag_warning = ""

    if intent == "1":
        # 闲聊：精简 prompt，不加载数据
        system_prompt = (
            BOUNDARY + today_str
            + "\n\n你是「车辆保养顾问」AI 助手。请简短回复（2-3 句话），"
            "告诉用户你能做什么：基于保养手册回答问题、查询保养记录、预估下次保养项目和费用。"
        )
    elif intent == "2":
        # 保养咨询：车辆上下文和 RAG 检索并行
        import asyncio
        t0 = time.time()
        async def _load_vehicle_ctx():
            return await _get_vehicle_context(vehicle_id)

        async def _load_sources():
            nonlocal rag_warning
            try:
                result = await _retrieve_context(vehicle_id, question, config)
                if not result:
                    rag_warning = "知识库检索未找到相关内容，可能是手册未索引或 Embedding 服务异常，建议检查知识库状态和 Embedding 配置。"
                return result
            except Exception as e:
                logger.warning("Embedding 检索失败，降级为无手册上下文: %s", e)
                rag_warning = f"知识库检索失败（{e}），建议检查 Embedding API 配置和账号状态。"
                return []

        vehicle_ctx, sources = await asyncio.gather(_load_vehicle_ctx(), _load_sources())
        timings.append(f"车辆上下文+RAG检索({len(sources)}条)(并行): {time.time() - t0:.2f}s")

        # 给每个 chunk 编号，方便 LLM 引用
        manual_ctx = ""
        if sources:
            manual_ctx = "\n\n".join(f"[{i+1}] {s['text']}" for i, s in enumerate(sources))

        # 搜索结果编号接在手册之后
        search_ctx_for_prompt, numbered_search = _build_search_ctx(len(sources))
        search_sources = numbered_search  # 替换为带编号的版本

        system_prompt = f"""{BOUNDARY}{today_str}

你是一位专业的汽车保养顾问。请根据以下信息回答用户的问题。

## 车辆信息
{vehicle_ctx}

## 保养手册相关内容
{manual_ctx}

## 回答要求
- 基于保养手册的事实回答，如果手册中没有相关信息请说明
- 给出具体的保养建议和预估费用
- 如果不确定，请明确告知
- 引用内容时，在对应语句末尾标注来源编号，格式如 [1] 或 [1][2]
- 编号同时覆盖保养手册和联网搜索结果，请正确引用
- 不要在回答末尾单独列出参考文献

## 表格数据处理
- 保养手册内容可能包含 Markdown 格式的表格，代表保养周期表、零件规格等结构化数据
- 读取表格时注意表头行定义了列含义（如里程数、月份、保养项目）
- 保养周期表通常以"每 X 公里或每 Y 个月"的格式给出，回答时请转换为具体建议
- 引用表格数据时准确转述对应行和列的值，不要混淆不同列{search_ctx_for_prompt}"""
    elif intent == "3":
        # 记录查询：加载车辆和记录，不检索手册
        t0 = time.time()
        vehicle_ctx = await _get_vehicle_context(vehicle_id)
        timings.append(f"车辆上下文: {time.time() - t0:.2f}s")
        search_ctx_for_prompt, numbered_search = _build_search_ctx(0)
        search_sources = numbered_search
        system_prompt = f"""{BOUNDARY}{today_str}

你是一位专业的汽车保养顾问。用户正在查询保养记录。

## 车辆信息
{vehicle_ctx}

## 回答要求
- 根据车辆信息和保养记录回答用户的问题
- 如果涉及费用，请列出明细和汇总
- 如果没有相关记录，请如实告知
- 引用搜索内容时，在对应语句末尾标注来源编号，格式如 [1] 或 [1][2]{search_ctx_for_prompt}"""
    else:
        # 其他：加载车辆上下文，不检索手册
        t0 = time.time()
        vehicle_ctx = await _get_vehicle_context(vehicle_id)
        timings.append(f"车辆上下文: {time.time() - t0:.2f}s")
        search_ctx_for_prompt, numbered_search = _build_search_ctx(0)
        search_sources = numbered_search
        system_prompt = f"""{BOUNDARY}{today_str}

你是一位专业的汽车保养顾问。请根据以下信息回答用户的问题。

## 车辆信息
{vehicle_ctx}

## 回答要求
- 尽量基于已有信息回答
- 如果不确定，请明确告知
- 引用搜索内容时，在对应语句末尾标注来源编号，格式如 [1] 或 [1][2]{search_ctx_for_prompt}"""

    # 4. 流式调用 LLM（带历史消息，限制最近 10 条控制 token 用量）
    timings.append(f"准备总耗时: {time.time() - t_total:.2f}s")
    logger.info("⏱ %s", " | ".join(timings))
    MAX_HISTORY = 25
    recent_history = history[-MAX_HISTORY:] if history else []
    messages = [
        {"role": "system", "content": system_prompt},
        *recent_history,
        {"role": "user", "content": question},
    ]

    # 闲聊时限制 max_tokens，避免大篇幅回复
    llm_params: dict = {
        "model": config["model"],
        "messages": messages,
        "stream": True,
    }
    if intent == "1":
        llm_params["max_tokens"] = 200

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{config['api_url']}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json",
                },
                json=llm_params,
            ) as resp:
                if resp.status_code != 200:
                    error_body = await resp.aread()
                    logger.error("LLM API 返回 %s: %s", resp.status_code, error_body.decode())
                    yield f"data: {json.dumps({'content': f'LLM 服务异常（{resp.status_code}）'}, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if content:
                                yield f"data: {json.dumps({'content': content})}\n\n"
                        except json.JSONDecodeError:
                            continue
    except Exception as e:
        logger.error("LLM 调用失败: %s", e, exc_info=True)
        yield f"data: {json.dumps({'content': f'LLM 调用失败：{e}'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 流式内容结束后，发送 warning、引用来源元数据、耗时诊断
    if timings:
        yield f"data: {json.dumps({'type': 'timings', 'data': timings}, ensure_ascii=False)}\n\n"
    if rag_warning:
        yield f"data: {json.dumps({'type': 'warning', 'data': rag_warning}, ensure_ascii=False)}\n\n"
    if intent == "2" and sources:
        sources_payload = [
            {
                "id": i + 1,
                "text": s["text"],
                "manual_id": s["manual_id"],
                "page": s["page"],
                "filename": s["filename"],
                "source_type": s.get("source_type", "pdf"),
                "source_url": s.get("source_url", ""),
            }
            for i, s in enumerate(sources)
        ]
        yield f"data: {json.dumps({'type': 'sources', 'data': sources_payload}, ensure_ascii=False)}\n\n"
    if search_sources:
        yield f"data: {json.dumps({'type': 'search_sources', 'data': search_sources}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
