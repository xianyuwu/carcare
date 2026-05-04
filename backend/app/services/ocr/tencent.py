from app.services.ocr.base import BaseOCR
from app.schemas import OCRResult


class TencentOCR(BaseOCR):
    """腾讯云 OCR 适配器"""

    def __init__(self, secret_id: str, secret_key: str):
        self.secret_id = secret_id
        self.secret_key = secret_key

    async def recognize(self, image_bytes: bytes) -> OCRResult:
        import base64
        import json
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.ocr.v20181119 import ocr_client, models

        cred = credential.Credential(self.secret_id, self.secret_key)
        http_profile = HttpProfile()
        client_profile = ClientProfile(httpProfile=http_profile)
        client = ocr_client.OcrClient(cred, "ap-beijing", client_profile)

        req = models.GeneralBasicOCRRequest()
        req.ImageBase64 = base64.b64encode(image_bytes).decode()

        resp = client.GeneralBasicOCR(req)
        text_detections = json.loads(resp.to_json_string())["TextDetections"]

        raw_text = "\n".join([item["DetectedText"] for item in text_detections])

        # 复用阿里云的字段提取逻辑
        from app.services.ocr.aliyun import AliyunOCR
        fields = AliyunOCR._extract_fields(raw_text)
        items = AliyunOCR._extract_items(raw_text)

        return OCRResult(raw_text=raw_text, fields=fields, items=items)
