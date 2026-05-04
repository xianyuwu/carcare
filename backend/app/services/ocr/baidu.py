from app.services.ocr.base import BaseOCR
from app.schemas import OCRResult


class BaiduOCR(BaseOCR):
    """百度云 OCR 适配器"""

    def __init__(self, app_id: str, api_key: str, secret_key: str):
        self.app_id = app_id
        self.api_key = api_key
        self.secret_key = secret_key

    async def recognize(self, image_bytes: bytes) -> OCRResult:
        from aip import AipOcr

        client = AipOcr(self.app_id, self.api_key, self.secret_key)
        result = client.basicGeneral(image_bytes)

        raw_text = "\n".join([item["words"] for item in result.get("words_result", [])])

        from app.services.ocr.aliyun import AliyunOCR
        fields = AliyunOCR._extract_fields(raw_text)
        items = AliyunOCR._extract_items(raw_text)

        return OCRResult(raw_text=raw_text, fields=fields, items=items)
