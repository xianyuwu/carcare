import asyncio
import logging

from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import OCRResult, OCRPageData

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["upload"])


def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    """将 PDF 每页转为 PNG 图片字节"""
    import fitz  # PyMuPDF
    from io import BytesIO
    from PIL import Image

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []
    for page in doc:
        pix = page.get_pixmap(dpi=200)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        buf = BytesIO()
        img.save(buf, format="PNG")
        images.append(buf.getvalue())
    doc.close()
    return images


@router.post("")
async def upload_and_ocr(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    file_bytes = await file.read()
    filename = file.filename or ""

    try:
        from app.services.ocr.factory import get_ocr_service
        service = await get_ocr_service(db)

        logger.info("上传文件: %s, 大小: %d bytes", filename, len(file_bytes))

        if filename.lower().endswith(".pdf"):
            page_images = pdf_to_images(file_bytes)
            if not page_images:
                return OCRResult(raw_text="", fields={}, items=[], error="PDF 文件为空或无法解析")

            # --- 第 1 页 OCR（带重试）---
            result1, _, _ = await service.recognize_with_detect(page_images[0])
            if result1.error or (not result1.items and not result1.fields):
                logger.warning("PDF 第1页 OCR 首次失败 (error=%s, items=%d, fields=%d)，3秒后重试",
                               result1.error, len(result1.items), len(result1.fields))
                await asyncio.sleep(3)
                result1, _, _ = await service.recognize_with_detect(page_images[0])
            logger.info("PDF 第1页 OCR 完成: items=%d, fields=%s, error=%s",
                        len(result1.items), list(result1.fields.keys()), result1.error or "无")

            # 只有 1 页，直接返回
            if len(page_images) == 1:
                return result1

            # --- 第 2 页及之后 OCR（续页模式，逐页处理）---
            continuation_results: list[OCRResult] = []
            for idx in range(1, len(page_images)):
                await asyncio.sleep(2)  # 避免 LLM API 限流
                if hasattr(service, 'recognize_continuation_with_detect'):
                    result, _, _ = await service.recognize_continuation_with_detect(page_images[idx])
                else:
                    result, _, _ = await service.recognize_with_detect(page_images[idx])
                if result.error or not result.items:
                    logger.warning("PDF 第%d页 OCR 首次失败 (error=%s, items=%d)，3秒后重试",
                                   idx + 1, result.error, len(result.items))
                    await asyncio.sleep(3)
                    if hasattr(service, 'recognize_continuation_with_detect'):
                        result, _, _ = await service.recognize_continuation_with_detect(page_images[idx])
                    else:
                        result, _, _ = await service.recognize_with_detect(page_images[idx])
                logger.info("PDF 第%d页 OCR 完成: items=%d, fields=%s, error=%s",
                            idx + 1, len(result.items), list(result.fields.keys()), result.error or "无")
                continuation_results.append(result)

            # --- 合并结果 ---
            # 字段 + 置信度：以第 1 页为主，续页补充空字段
            merged_fields = dict(result1.fields)
            merged_conf = dict(result1.confidence)
            field_page: dict[str, int] = {k: 1 for k in result1.fields}
            for idx, r in enumerate(continuation_results):
                page_num = idx + 2
                for k, v in r.fields.items():
                    if k not in merged_fields or not merged_fields[k]:
                        merged_fields[k] = v
                for k, v in r.confidence.items():
                    if k not in merged_conf:
                        merged_conf[k] = v
                for k in r.fields:
                    if k not in field_page:
                        field_page[k] = page_num

            # items：逐页拼接
            merged_items = list(result1.items)
            items_page = [1] * len(result1.items)
            merged_items_bbox = list(result1.items_bbox or [])
            for idx, r in enumerate(continuation_results):
                page_num = idx + 2
                merged_items.extend(r.items)
                items_page.extend([page_num] * len(r.items))
                merged_items_bbox.extend(r.items_bbox or [])

            # 页面数据（供前端分别渲染标注）
            pages = [
                OCRPageData(
                    image_base64=result1.image_base64,
                    natural_width=result1.natural_width,
                    natural_height=result1.natural_height,
                    field_coords=result1.field_coords, items_bbox=result1.items_bbox or [],
                    bbox=result1.bbox,
                ),
            ]
            for r in continuation_results:
                pages.append(OCRPageData(
                    image_base64=r.image_base64,
                    natural_width=r.natural_width,
                    natural_height=r.natural_height,
                    field_coords=r.field_coords, items_bbox=r.items_bbox or [],
                    bbox=r.bbox,
                ))

            merged = OCRResult(
                raw_text=result1.raw_text + "\n" + "\n".join(r.raw_text for r in continuation_results),
                fields=merged_fields,
                items=merged_items,
                blocks=result1.blocks + sum((r.blocks for r in continuation_results), []),
                field_coords=result1.field_coords,
                image_base64=result1.image_base64,
                error="",
                confidence=merged_conf,
                bbox=result1.bbox,
                items_bbox=merged_items_bbox,
                raw_json=result1.raw_json,
                natural_width=result1.natural_width,
                natural_height=result1.natural_height,
                pages=pages,
                field_page=field_page,
                items_page=items_page,
            )
            return merged
        else:
            # 图片直接 OCR
            result, _, _ = await service.recognize_with_detect(file_bytes)
            return result
    except Exception as e:
        logger.exception("Upload OCR failed")
        return OCRResult(raw_text="", fields={}, items=[], error=str(e))
