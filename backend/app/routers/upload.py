import base64
import logging

from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import OCRResult, OCRBlock

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

        if filename.lower().endswith(".pdf"):
            # PDF：先转 PNG，再逐页 OCR（保证坐标与显示图片一致）
            page_images = pdf_to_images(file_bytes)
            if not page_images:
                return OCRResult(raw_text="", fields={}, items=[], error="PDF 文件为空或无法解析")

            # 第一页图片作为前端标注底图
            img_b64 = base64.b64encode(page_images[0]).decode()

            pages_to_ocr = min(len(page_images), 3)
            all_raw_text: list[str] = []
            all_items: list[str] = []
            merged_fields: dict[str, str] = {}
            merged_blocks: list[OCRBlock] = []
            merged_field_coords: dict[str, list[dict[str, float]]] = {}

            for page_idx in range(pages_to_ocr):
                # 传 PNG 图片字节，不再传原始 PDF 字节
                result = await service.recognize(page_images[page_idx])
                if result.error:
                    logger.warning("PDF page %d OCR error: %s", page_idx + 1, result.error)
                    continue
                if result.raw_text:
                    all_raw_text.append(result.raw_text)
                all_items.extend(result.items)
                merged_fields.update(result.fields)
                # 只用第一页的坐标和 blocks（对应前端显示的底图）
                if page_idx == 0:
                    merged_blocks = result.blocks
                    merged_field_coords = result.field_coords

            raw_text = "\n\n".join(all_raw_text)
            return OCRResult(
                raw_text=raw_text,
                fields=merged_fields,
                items=all_items,
                blocks=merged_blocks,
                field_coords=merged_field_coords,
                image_base64=img_b64,
            )
        else:
            # 图片：直接 OCR
            result = await service.recognize(file_bytes)
            return result
    except Exception as e:
        logger.exception("Upload OCR failed")
        return OCRResult(raw_text="", fields={}, items=[], error=str(e))
