import base64
import json
import logging

from app.services.ocr.base import BaseOCR
from app.schemas import OCRResult, OCRBlock

logger = logging.getLogger(__name__)


# 自定义字段名：保养结算单常见字段
ITEM_NAMES = [
    "结算日期", "里程数", "下次保养里程", "下次保养日期",
    "原价", "优惠", "实付金额", "服务店", "修理号",
    "工单号", "合计", "总计", "应收", "实付",
    "里程", "日期", "折扣",
    "作业项目", "零部件名称", "其他费用",
]


def _polygon_to_list(coord: dict) -> list[dict[str, float]]:
    """将腾讯云 Coord 结构转为 [{X, Y}, ...] 四角列表"""
    if not coord:
        return []
    keys = ["LeftTop", "RightTop", "RightBottom", "LeftBottom"]
    result = []
    for k in keys:
        if k in coord and coord[k]:
            result.append({"X": float(coord[k]["X"]), "Y": float(coord[k]["Y"])})
    return result


class TencentDocOCR(BaseOCR):
    """腾讯云 文档抽取（多模态版）适配器 — ExtractDocMulti"""

    def __init__(self, secret_id: str, secret_key: str):
        self.secret_id = secret_id
        self.secret_key = secret_key

    async def recognize(self, image_bytes: bytes, pdf_page: int | None = None) -> OCRResult:
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.ocr.v20181119 import ocr_client, models

        cred = credential.Credential(self.secret_id, self.secret_key)
        http_profile = HttpProfile()
        client_profile = ClientProfile(httpProfile=http_profile)
        client = ocr_client.OcrClient(cred, "ap-beijing", client_profile)

        req = models.ExtractDocMultiRequest()
        req.ImageBase64 = base64.b64encode(image_bytes).decode()
        req.ReturnFullText = True
        req.EnableCoord = True
        req.ItemNames = ITEM_NAMES
        req.ItemNamesShowMode = False   # 输出默认字段 + 自定义字段
        req.ConfigId = "Table"          # 表格模板，更适合结算单
        req.OutputLanguage = "cn"

        resp = client.ExtractDocMulti(req)
        data = json.loads(resp.to_json_string())

        # 调试：打印 API 原始返回
        logger.info("ExtractDocMulti response StructuralList: %s",
                     json.dumps(data.get("StructuralList", []), ensure_ascii=False, indent=2)[:2000])
        logger.info("ExtractDocMulti WordList count: %d", len(data.get("WordList", [])))

        # ---- 解析 StructuralList → fields + field_coords ----
        fields: dict[str, str] = {}
        field_coords: dict[str, list[dict[str, float]]] = {}
        items: list[str] = []

        for group_info in data.get("StructuralList", []):
            for group in group_info.get("Groups", []):
                for line in group.get("Lines", []):
                    key_info = line.get("Key", {})
                    val_info = line.get("Value", {})

                    key_name = (
                        key_info.get("AutoName")
                        or key_info.get("ConfigName")
                        or ""
                    )
                    value_text = val_info.get("AutoContent", "")

                    if not key_name or not value_text:
                        continue

                    mapped_key = self._map_field_name(key_name, value_text)
                    if mapped_key:
                        fields[mapped_key] = value_text
                        val_coord = val_info.get("Coord")
                        if val_coord:
                            field_coords[mapped_key] = _polygon_to_list(val_coord)
                    else:
                        items.append(f"{key_name}: {value_text}")

        # ---- 解析 WordList → blocks (全文文本 + 坐标) ----
        blocks: list[OCRBlock] = []
        raw_parts: list[str] = []
        for word in data.get("WordList", []):
            text = word.get("DetectedText", "")
            coord = word.get("Coord")
            if text:
                raw_parts.append(text)
                if coord:
                    blocks.append(OCRBlock(text=text, polygon=_polygon_to_list(coord)))

        raw_text = "\n".join(raw_parts)

        # 补充提取
        if not items:
            items = self._extract_items_from_text(raw_text)
        # 补充字段：如果结构性提取没拿到，从全文正则提取
        if not fields.get("date"):
            self._extract_fields_from_text(raw_text, fields)

        # 图片 base64 供前端标注
        img_b64 = base64.b64encode(image_bytes).decode()

        logger.info("ExtractDocMulti result: fields=%s, items=%d, blocks=%d, raw_text_len=%d",
                     list(fields.keys()), len(items), len(blocks), len(raw_text))

        return OCRResult(
            raw_text=raw_text,
            fields=fields,
            items=items,
            blocks=blocks,
            field_coords=field_coords,
            image_base64=img_b64,
        )

    @staticmethod
    def _map_field_name(key_name: str, value: str) -> str | None:
        """将 ExtractDocMulti 返回的字段名映射到我们的 schema 字段"""
        key_lower = key_name.strip()
        mapping = {
            "结算日期": "date", "日期": "date", "维修日期": "date", "进厂日期": "date",
            "里程数": "mileage", "里程": "mileage", "当前里程": "mileage", "进厂里程": "mileage",
            "下次保养里程": "next_mileage", "下次里程": "next_mileage",
            "下次保养日期": "next_date", "下次日期": "next_date",
            "原价": "total_amount", "合计": "total_amount", "总计": "total_amount",
            "应收": "total_amount", "金额": "total_amount", "费用合计": "total_amount",
            "实付金额": "paid_amount", "实付": "paid_amount", "实收": "paid_amount",
            "应付": "paid_amount", "收费": "paid_amount",
            "优惠": "discount", "折扣": "discount", "减免": "discount",
            "服务店": "station", "修理厂": "station", "服务站": "station",
            "4S店": "station", "门店": "station", "经销商": "station",
            "修理号": "order_no", "工单号": "order_no", "维修单号": "order_no",
            "结算单号": "order_no",
            "作业项目": "work_items", "维修项目": "work_items", "保养项目": "work_items",
            "零部件名称": "parts", "配件名称": "parts", "材料名称": "parts",
            "其他费用": "other_fees", "附加费用": "other_fees", "额外费用": "other_fees",
        }
        return mapping.get(key_lower)

    @staticmethod
    def _extract_fields_from_text(text: str, fields: dict[str, str]) -> None:
        """从全文中正则提取字段（补充兜底）"""
        import re
        if "date" not in fields:
            m = re.search(r"(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)", text)
            if m:
                fields["date"] = m.group(1).replace("年", "-").replace("月", "-").replace("日", "").replace("/", "-")
        if "mileage" not in fields:
            m = re.search(r"里程[：:]?\s*(\d[\d,]*)\s*km", text, re.IGNORECASE)
            if m:
                fields["mileage"] = m.group(1).replace(",", "")
        if "total_amount" not in fields:
            m = re.search(r"(?:合计|总计|实付|应收|费用合计)[^\d]*(\d[\d,]*\.?\d*)", text)
            if m:
                fields["total_amount"] = m.group(1).replace(",", "")
        if "station" not in fields:
            m = re.search(r"(?:修理厂|服务店|4S店|服务站|门店)[：:]?\s*(.+?)(?:\n|$)", text)
            if m:
                fields["station"] = m.group(1).strip()

    @staticmethod
    def _extract_items_from_text(text: str) -> list[str]:
        """从全文中提取保养项目（兜底逻辑）"""
        import re
        items = []
        for line in text.split("\n"):
            line = line.strip()
            if not line or len(line) < 2:
                continue
            if re.search(r"\d+\.?\d*\s*$", line) and len(line) > 2:
                name = re.sub(r"\s+[\d,]+\.?\d*\s*$", "", line).strip()
                if name and len(name) < 50:
                    items.append(name)
        return items
