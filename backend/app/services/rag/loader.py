"""PDF 加载、分块、向量化存储"""
import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Manual
from app.config import CHROMA_DIR

logger = logging.getLogger(__name__)


def parse_separators(separators_str: str) -> list[str]:
    """将逗号分隔的分隔符配置字符串解析为实际分隔符列表

    输入示例: "\\n\\n,\\n" 或 "\\n\\n,\\n,。,***"
    输出: ["\n\n", "\n", "。", "***"]
    """
    parts = separators_str.split(",")
    result = []
    for part in parts:
        p = part.strip()
        if not p:
            continue
        # 将转义的 \n 替换为真实换行符
        p = p.replace("\\n", "\n")
        p = p.replace("\\t", "\t")
        result.append(p)
    return result


def extract_page_text(page) -> str:
    """从 PDF 页面提取文本，表格转为 Markdown 格式保留结构"""
    import fitz

    tables = page.find_tables()
    if not tables.tables:
        return page.get_text()

    elements = []
    table_bboxes = []

    for table in tables.tables:
        md = table.to_markdown()
        elements.append((table.bbox[1], f"<!-- TABLE START -->\n{md}\n<!-- TABLE END -->"))
        table_bboxes.append(fitz.Rect(table.bbox))

    page_dict = page.get_text("dict")
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        block_rect = fitz.Rect(block["bbox"])
        if any(block_rect.intersects(tb) for tb in table_bboxes):
            continue

        lines_text = []
        for line in block.get("lines", []):
            line_text = "".join(span.get("text", "") for span in line.get("spans", []))
            if line_text.strip():
                lines_text.append(line_text)

        if lines_text:
            elements.append((block["bbox"][1], "\n".join(lines_text)))

    elements.sort(key=lambda e: e[0])
    return "\n\n".join(text for _, text in elements)


def split_texts(
    pages: list[str],
    chunk_size: int = 500,
    chunk_overlap: int = 100,
    separators_str: str = "\\n\\n,\\n",
    manual_id: int = 0,
    vehicle_id: int = 0,
) -> list[dict]:
    """将页面文本分块，返回 chunk 列表（dict 格式，含 text + metadata）

    抽取为独立函数，供 index_manual 和 preview_chunks 共用。
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    separators = parse_separators(separators_str)
    # 确保表格边界分隔符在最前面（如果原文含表格）
    if "<!-- TABLE END -->" not in separators:
        separators = ["<!-- TABLE END -->"] + separators

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=separators,
    )
    metadatas = [{"manual_id": manual_id, "vehicle_id": vehicle_id, "page": i} for i in range(len(pages))]
    docs = splitter.create_documents(pages, metadatas=metadatas)

    chunks = []
    for doc in docs:
        chunks.append({
            "text": doc.page_content,
            "metadata": {
                **doc.metadata,
                "has_table": "<!-- TABLE START -->" in doc.page_content,
            },
        })
    return chunks


async def index_manual(
    manual_id: int,
    db: AsyncSession,
    progress_callback=None,
):
    """将手册内容分块并向量化存入 ChromaDB

    Args:
        progress_callback: 可选的异步回调函数，签名为 async (stage, message, current, total)
    """
    import fitz
    from langchain_openai import OpenAIEmbeddings
    import chromadb

    async def _progress(stage: str, message: str = "", current: int = 0, total: int = 0):
        if progress_callback:
            await progress_callback(stage, message, current, total)

    manual = await db.get(Manual, manual_id)
    if not manual:
        return

    manual.status = "indexing"
    await db.commit()

    try:
        # 1. 根据来源类型提取文本
        await _progress("extracting", "提取文本中...")
        if manual.source_type == "web":
            from app.services.rag.web_scraper import fetch_web_text
            text, _title = await fetch_web_text(manual.source_url)
            pages = [text] if text else []
            manual.page_count = 1 if text else 0
        else:
            from app.storage import get_storage, LocalStorage
            storage = get_storage()
            key = manual.file_path or f"manuals/{manual.vehicle_id}/{manual.filename}"
            if isinstance(storage, LocalStorage):
                pdf_path = storage.url(key)
            else:
                import tempfile
                tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                tmp.write(storage.read(key) or b"")
                tmp.close()
                pdf_path = tmp.name
            try:
                doc = fitz.open(pdf_path)
                pages = []
                for page in doc:
                    pages.append(extract_page_text(page))
                doc.close()
                manual.page_count = len(pages)
            finally:
                if not isinstance(storage, LocalStorage):
                    import os as _os
                    try:
                        _os.unlink(pdf_path)
                    except Exception:
                        pass

        await _progress("extracting", f"文本提取完成，共 {manual.page_count} 页")

        # 2. 分块（使用手册记录中保存的参数）
        await _progress("chunking", "分块处理中...")
        chunks = split_texts(
            pages,
            chunk_size=manual.chunk_size or 500,
            chunk_overlap=manual.chunk_overlap or 100,
            separators_str=manual.separators or "\\n\\n,\\n",
            manual_id=manual_id,
            vehicle_id=manual.vehicle_id,
        )
        manual.chunk_count = len(chunks)

        await _progress("chunking", f"分块完成，共 {len(chunks)} 个块")

        # 3. 获取 embedding 配置
        from app.database import async_session
        from app.config import get_secret

        async with async_session() as settings_db:
            from app.routers.settings import _get_setting_value
            emb_api_url = await _get_setting_value(settings_db, "llm_embedding_api_url")
            embedding_model = await _get_setting_value(settings_db, "llm_embedding_model")
            embed_max_chars = int(await _get_setting_value(settings_db, "rag_embed_max_chars") or "200")
        emb_api_key = get_secret("llm_embedding_api_key")

        # 4. 向量化存入 ChromaDB
        import os
        _socks_keys = ["ALL_PROXY", "all_proxy"]
        _saved_socks = {k: os.environ.pop(k, "") for k in _socks_keys}
        try:
            embeddings = OpenAIEmbeddings(
                model=embedding_model or "text-embedding-3-small",
                openai_api_key=emb_api_key,
                openai_api_base=emb_api_url,
                check_embedding_ctx_length=False,
            )
        finally:
            for k, v in _saved_socks.items():
                if v:
                    os.environ[k] = v

        client = chromadb.PersistentClient(path=str(CHROMA_DIR))

        try:
            client.delete_collection(name=f"manual_{manual_id}")
        except Exception:
            pass

        collection = client.get_or_create_collection(
            name=f"manual_{manual_id}",
            metadata={"vehicle_id": manual.vehicle_id},
        )

        texts = [c["text"] for c in chunks]
        metas = [c["metadata"] for c in chunks]
        ids = [f"manual_{manual_id}_chunk_{i}" for i in range(len(chunks))]

        batch_size = 20
        total_batches = (len(texts) + batch_size - 1) // batch_size
        max_retries = 3
        for i in range(0, len(texts), batch_size):
            batch_idx = i // batch_size + 1
            await _progress("embedding", f"向量化 {batch_idx}/{total_batches} 批...", batch_idx, total_batches)

            batch_texts = texts[i:i + batch_size]
            batch_ids = ids[i:i + batch_size]
            batch_metas = metas[i:i + batch_size]
            # 截断文本用于嵌入，避免超长文本降低向量质量
            embed_texts = [t[:embed_max_chars] for t in batch_texts]
            # 带 retry 的 embedding 调用，避免偶发限流导致整批失败
            for attempt in range(1, max_retries + 1):
                try:
                    batch_embeds = await embeddings.aembed_documents(embed_texts)
                    break
                except Exception as embed_err:
                    if attempt == max_retries:
                        raise
                    wait = 2 ** attempt  # 指数退避: 2s, 4s
                    logger.warning(
                        "Embedding batch %d failed (attempt %d/%d): %s, retry in %ds",
                        i // batch_size, attempt, max_retries, embed_err, wait,
                    )
                    await asyncio.sleep(wait)
            collection.add(ids=batch_ids, documents=batch_texts, metadatas=batch_metas, embeddings=batch_embeds)
            # batch 间短暂停顿，降低 API 限流风险
            if i + batch_size < len(texts):
                await asyncio.sleep(0.5)

        manual.status = "ready"
        manual.error_message = ""
        await db.commit()
        await _progress("done", "处理完成")

    except Exception as e:
        logger.exception("index_manual failed for manual_id=%s: %s", manual_id, e)
        manual.status = "error"
        manual.error_message = str(e)[:2000]
        await db.commit()
        await _progress("error", str(e)[:200])
