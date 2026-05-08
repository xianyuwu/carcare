import base64
import logging

from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import OCRResult

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
            page_images = pdf_to_images(file_bytes)
            if not page_images:
                return OCRResult(raw_text="", fields={}, items=[], error="PDF 文件为空或无法解析")
            # PDF 只取第一页，同时用于 OCR 和前端标注
            result, _, _ = await service.recognize_with_detect(page_images[0])
            return result
        else:
            # 图片直接 OCR
            result, _, _ = await service.recognize_with_detect(file_bytes)
            return result
    except Exception as e:
        logger.exception("Upload OCR failed")
        return OCRResult(raw_text="", fields={}, items=[], error=str(e))
