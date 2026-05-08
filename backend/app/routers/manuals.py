import asyncio
import hashlib
import json
import logging
import tempfile
from urllib.parse import urlparse
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db, async_session
from app.models import Manual, Vehicle, VehicleShare, User
from app.schemas import ManualOut, ManualUpdate, ChunkPreviewResult, ChunkPreview
from app.config import UPLOAD_DIR, MANUAL_PAGES_DIR
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/manuals", tags=["manuals"])
logger = logging.getLogger(__name__)


class WebKnowledgeRequest(BaseModel):
    vehicle_id: int
    url: str
    chunk_size: int = 500
    chunk_overlap: int = 100
    separators: str = "\\n\\n,\\n"


async def get_user_vehicle_ids(db: AsyncSession, user_id: int) -> list[int]:
    """获取用户有权访问的车辆 ID 列表"""
    result = await db.execute(select(Vehicle.id).where(Vehicle.owner_id == user_id))
    owned = set(row[0] for row in result.all())

    result = await db.execute(
        select(VehicleShare.vehicle_id).where(VehicleShare.user_id == user_id)
    )
    shared = set(row[0] for row in result.all())

    return list(owned | shared)


async def check_vehicle_write_access(db: AsyncSession, vehicle_id: int, user_id: int) -> Vehicle:
    """检查用户是否有权在车辆下写入（上传手册等）"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")

    if vehicle.owner_id == user_id:
        return vehicle

    result = await db.execute(
        select(VehicleShare).where(
            VehicleShare.vehicle_id == vehicle_id,
            VehicleShare.user_id == user_id,
            VehicleShare.permission == "write"
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "需要写入权限")

    return vehicle


@router.get("", response_model=list[ManualOut])
async def list_manuals(
    vehicle_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前用户可访问的手册"""
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)

    if vehicle_id:
        if vehicle_id not in accessible_vehicles:
            raise HTTPException(403, "无权访问该车辆的手册")
        stmt = select(Manual).where(Manual.vehicle_id == vehicle_id)
    else:
        if not accessible_vehicles:
            return []
        stmt = select(Manual).where(Manual.vehicle_id.in_(accessible_vehicles))

    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/upload", response_model=ManualOut)
async def upload_manual(
    vehicle_id: int,
    file: UploadFile = File(...),
    chunk_size: int = Query(500),
    chunk_overlap: int = Query(100),
    separators: str = Query("\\n\\n,\\n"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """上传手册（需要写入权限）"""
    await check_vehicle_write_access(db, vehicle_id, current_user.id)

    dest = UPLOAD_DIR / f"manual_{vehicle_id}_{file.filename}"
    content = await file.read()
    dest.write_bytes(content)

    manual = Manual(
        vehicle_id=vehicle_id,
        user_id=current_user.id,
        filename=file.filename,
        file_path=str(dest),
        status="pending",
        source_type="pdf",
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=separators,
    )
    db.add(manual)
    await db.commit()
    await db.refresh(manual)
    return manual


@router.post("/web", response_model=ManualOut)
async def add_web_knowledge(
    req: WebKnowledgeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """从 Web 地址抓取内容（需要写入权限）"""
    await check_vehicle_write_access(db, req.vehicle_id, current_user.id)

    from app.services.rag.web_scraper import fetch_web_text

    text, title = await fetch_web_text(req.url)
    if not text:
        raise HTTPException(400, "无法从该网址提取内容")

    # 用页面标题作为显示名，无标题时用域名
    display_name = title or urlparse(req.url).netloc
    filename = display_name + ".txt"
    dest = UPLOAD_DIR / f"manual_{req.vehicle_id}_web_{filename}"
    dest.write_text(text, encoding="utf-8")

    manual = Manual(
        vehicle_id=req.vehicle_id,
        user_id=current_user.id,
        filename=filename,
        file_path=str(dest),
        status="pending",
        source_type="web",
        source_url=req.url,
        chunk_size=req.chunk_size,
        chunk_overlap=req.chunk_overlap,
        separators=req.separators,
    )
    db.add(manual)
    await db.commit()
    await db.refresh(manual)
    return manual


@router.post("/preview-chunks", response_model=ChunkPreviewResult)
async def preview_chunks(
    file: UploadFile | None = File(None),
    url: str | None = Query(None),
    chunk_size: int = Query(500),
    chunk_overlap: int = Query(100),
    separators: str = Query("\\n\\n,\\n"),
):
    """预览分块结果，不存入数据库和 ChromaDB"""
    from app.services.rag.loader import extract_page_text, split_texts

    pages = []

    if file:
        import fitz
        content = await file.read()
        # 用临时文件打开 PDF
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        doc = fitz.open(tmp_path)
        for page in doc:
            pages.append(extract_page_text(page))
        doc.close()
        import os
        os.unlink(tmp_path)
    elif url:
        from app.services.rag.web_scraper import fetch_web_text
        text, _title = await fetch_web_text(url)
        if not text:
            raise HTTPException(400, "无法从该网址提取内容")
        pages = [text]
    else:
        raise HTTPException(400, "请提供文件或 URL")

    chunks = split_texts(pages, chunk_size=chunk_size, chunk_overlap=chunk_overlap, separators_str=separators)

    # 最多返回前 20 个块预览
    preview = chunks[:20]
    return ChunkPreviewResult(
        total_chunks=len(chunks),
        chunks=[
            ChunkPreview(
                index=i,
                text=c["text"],
                char_count=len(c["text"]),
                has_table=c["metadata"].get("has_table", False),
            )
            for i, c in enumerate(preview)
        ],
    )


@router.post("/{manual_id}/index")
async def index_with_progress(
    manual_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """启动后台索引并通过 SSE 流式推送进度"""
    manual = await db.get(Manual, manual_id)
    if not manual:
        raise HTTPException(404, "手册不存在")

    # 检查访问权限
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if manual.vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权访问该手册")

    if manual.status == "indexing":
        raise HTTPException(409, "手册正在索引中，请稍后")

    from app.services.rag.progress import update_progress, get_progress

    # 初始化进度
    update_progress(manual_id, "pending", "准备中...")

    # 后台索引任务：使用独立的 DB session，避免请求结束后 session 关闭
    async def _run_index():
        async with async_session() as bg_db:
            async def _progress_cb(stage, message="", current=0, total=0):
                update_progress(manual_id, stage, message, current, total)

            from app.services.rag.loader import index_manual
            await index_manual(manual_id, bg_db, progress_callback=_progress_cb)

    # 用 create_task 启动后台索引，不 await
    asyncio.create_task(_run_index())

    async def progress_stream():
        while True:
            progress = get_progress(manual_id)
            if progress:
                yield f"data: {json.dumps(progress.to_dict(), ensure_ascii=False)}\n\n"
                if progress.stage in ("done", "error"):
                    break
            await asyncio.sleep(0.5)
        yield "data: [DONE]\n\n"

    return StreamingResponse(progress_stream(), media_type="text/event-stream")


@router.put("/{manual_id}", response_model=ManualOut)
async def update_manual(
    manual_id: int,
    body: ManualUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新手册配置（需要写入权限）"""
    manual = await db.get(Manual, manual_id)
    if not manual:
        raise HTTPException(404, "手册不存在")

    # 检查写入权限
    await check_vehicle_write_access(db, manual.vehicle_id, current_user.id)

    if manual.status == "indexing":
        raise HTTPException(409, "手册正在索引中，请稍后")

    if body.chunk_size is not None:
        manual.chunk_size = body.chunk_size
    if body.chunk_overlap is not None:
        manual.chunk_overlap = body.chunk_overlap
    if body.separators is not None:
        manual.separators = body.separators
    await db.commit()

    if body.reindex:
        from app.services.rag.loader import index_manual
        await index_manual(manual.id, db)

    await db.refresh(manual)
    return manual


@router.post("/reindex-all")
async def reindex_all():
    """批量重建所有 stale 手册，SSE 推送整体进度"""
    from app.services.rag.loader import index_manual
    from app.services.rag.progress import update_progress

    # 查询所有 stale 手册
    async with async_session() as db:
        stmt = select(Manual).where(Manual.status == "stale").order_by(Manual.id)
        result = await db.execute(stmt)
        manuals = result.scalars().all()

    if not manuals:
        return {"ok": True, "message": "无需重建"}

    total = len(manuals)

    async def progress_stream():
        for idx, manual in enumerate(manuals):
            current = idx + 1
            yield f"data: {json.dumps({'current': current, 'total': total, 'filename': manual.filename, 'stage': 'indexing'}, ensure_ascii=False)}\n\n"

            async with async_session() as bg_db:
                try:
                    await index_manual(manual.id, bg_db)
                except Exception as e:
                    logger.warning("批量重建：手册 %s 失败: %s", manual.id, e)

            yield f"data: {json.dumps({'current': current, 'total': total, 'filename': manual.filename, 'stage': 'done'}, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(progress_stream(), media_type="text/event-stream")


@router.post("/{manual_id}/reindex", response_model=ManualOut)
async def reindex_manual(
    manual_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """重新索引手册（需要写入权限）"""
    manual = await db.get(Manual, manual_id)
    if not manual:
        raise HTTPException(404, "手册不存在")

    await check_vehicle_write_access(db, manual.vehicle_id, current_user.id)

    if manual.status == "indexing":
        raise HTTPException(409, "手册正在索引中，请稍后")

    from app.services.rag.loader import index_manual
    await index_manual(manual.id, db)
    await db.refresh(manual)
    return manual


@router.delete("/{manual_id}")
async def delete_manual(
    manual_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除手册（需要写入权限）"""
    manual = await db.get(Manual, manual_id)
    if not manual:
        raise HTTPException(404, "手册不存在")

    await check_vehicle_write_access(db, manual.vehicle_id, current_user.id)

    # 删除对应的 ChromaDB 向量数据
    try:
        import chromadb
        from app.config import CHROMA_DIR
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        client.delete_collection(name=f"manual_{manual_id}")
    except Exception:
        pass  # collection 可能不存在，忽略
    await db.delete(manual)
    await db.commit()
    return {"ok": True}


@router.get("/{manual_id}/file")
async def get_manual_file(
    manual_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """返回手册原始文件（PDF）"""
    manual = await db.get(Manual, manual_id)
    if not manual:
        raise HTTPException(404, "手册不存在")

    # 检查访问权限
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if manual.vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权访问该手册")

    # 网页来源没有原始文件，跳转到原始 URL
    if manual.source_type == "web" and manual.source_url:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=manual.source_url)

    file_path = UPLOAD_DIR / f"manual_{manual.vehicle_id}_{manual.filename}"
    if not file_path.exists():
        raise HTTPException(404, "文件不存在")

    return FileResponse(
        str(file_path),
        media_type="application/pdf",
        filename=manual.filename,
        content_disposition_type="inline",
    )


@router.get("/{manual_id}/page/{page_num}")
async def get_manual_page(
    manual_id: int,
    page_num: int,
    highlight: str | None = Query(None, description="需要高亮的文本"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """渲染 PDF 指定页为 PNG 图片"""
    manual = await db.get(Manual, manual_id)
    if not manual:
        raise HTTPException(404, "手册不存在")

    # 检查访问权限
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if manual.vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权访问该手册")

    pdf_path = UPLOAD_DIR / f"manual_{manual.vehicle_id}_{manual.filename}"
    if not pdf_path.exists():
        raise HTTPException(404, "PDF 文件不存在")

    if highlight:
        h = hashlib.md5(highlight.encode()).hexdigest()[:8]
        cache_path = MANUAL_PAGES_DIR / f"{manual_id}_{page_num}_{h}.png"
    else:
        cache_path = MANUAL_PAGES_DIR / f"{manual_id}_{page_num}.png"

    if cache_path.exists():
        return FileResponse(cache_path, media_type="image/png")

    import fitz
    doc = fitz.open(str(pdf_path))
    if page_num < 0 or page_num >= len(doc):
        doc.close()
        raise HTTPException(400, f"页码超出范围（共 {len(doc)} 页）")

    page = doc[page_num]
    zoom = 2.0
    mat = fitz.Matrix(zoom, zoom)

    rects = []
    if highlight:
        rects = page.search_for(highlight)
        if not rects and len(highlight) > 20:
            rects = page.search_for(highlight[:50])
        if not rects and len(highlight) > 10:
            rects = page.search_for(highlight[:20])

    pix = page.get_pixmap(matrix=mat)

    if rects:
        from PIL import Image, ImageDraw
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        draw = ImageDraw.Draw(img, "RGBA")
        for rect in rects:
            x0, y0, x1, y1 = rect.x0 * zoom, rect.y0 * zoom, rect.x1 * zoom, rect.y1 * zoom
            draw.rectangle([x0, y0, x1, y1], fill=(255, 255, 0, 60), outline=(255, 200, 0, 160), width=2)
        img.convert("RGB").save(str(cache_path))
    else:
        pix.save(str(cache_path))

    doc.close()
    return FileResponse(cache_path, media_type="image/png")
