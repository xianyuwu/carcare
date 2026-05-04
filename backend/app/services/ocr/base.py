from abc import ABC, abstractmethod
from app.schemas import OCRResult


class BaseOCR(ABC):
    """OCR 服务抽象基类"""

    @abstractmethod
    async def recognize(self, image_bytes: bytes, pdf_page: int | None = None) -> OCRResult:
        ...
