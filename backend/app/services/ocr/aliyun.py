import re
from app.services.ocr.base import BaseOCR
from app.schemas import OCRResult


class AliyunOCR(BaseOCR):
    """阿里云 OCR 适配器"""

    def __init__(self, access_key_id: str, access_key_secret: str, endpoint: str):
        self.access_key_id = access_key_id
        self.access_key_secret = access_key_secret
        self.endpoint = endpoint

    async def recognize(self, image_bytes: bytes) -> OCRResult:
        import base64
        import json
        import httpx

        b64 = base64.b64encode(image_bytes).decode()

        # 使用阿里云 OCR 通用识别 API
        url = f"https://{self.endpoint}/?Action=RecognizeGeneral"
        headers = {
            "Authorization": f"APPCODE {self.access_key_id}",
            "Content-Type": "application/json",
        }
        payload = {
            "image": b64,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        raw_text = data.get("Data", {}).get("content", "")
        fields = self._extract_fields(raw_text)
        items = self._extract_items(raw_text)

        return OCRResult(raw_text=raw_text, fields=fields, items=items)

    @staticmethod
    def _extract_fields(text: str) -> dict[str, str]:
        """从 OCR 文本中提取结构化字段"""
        fields = {}

        # 日期
        date_match = re.search(r"(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)", text)
        if date_match:
            fields["date"] = date_match.group(1).replace("年", "-").replace("月", "-").replace("日", "").replace("/", "-")

        # 里程
        mileage_match = re.search(r"里程[：:]?\s*(\d[\d,]*)\s*km", text, re.IGNORECASE)
        if mileage_match:
            fields["mileage"] = mileage_match.group(1).replace(",", "")

        # 金额
        amount_match = re.search(r"(?:合计|总计|实付|应收)[^\d]*(\d[\d,]*\.?\d*)", text)
        if amount_match:
            fields["total_amount"] = amount_match.group(1).replace(",", "")

        # 服务店
        station_match = re.search(r"(?:修理厂|服务店|4S店|服务站)[：:]?\s*(.+?)(?:\n|$)", text)
        if station_match:
            fields["station"] = station_match.group(1).strip()

        return fields

    @staticmethod
    def _extract_items(text: str) -> list[str]:
        """提取保养项目列表"""
        items = []
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # 匹配包含价格的项目行
            if re.search(r"\d+\.?\d*\s*$", line) and len(line) > 2:
                # 去掉末尾价格部分
                name = re.sub(r"\s+[\d,]+\.?\d*\s*$", "", line).strip()
                if name and len(name) < 50:
                    items.append(name)
        return items
