"""
llm_ocr.py
LLM 多模态 OCR 实现（基于 OpenAI 兼容接口，如阿里云百炼 Qwen-VL）

职责：
1. 接收图片字节，必要时用 PIL 缩放（长边 > 2000px）+ EXIF 方向校正
2. 将图片编码为 base64 data URL
3. 组装 messages，调用多模态模型
4. 解析返回 JSON，做字段兜底
5. 将 _bbox（归一化 [x1,y1,x2,y2]）转换为 polygon（[{X,Y}...]）供前端标注
"""

import base64
import json
import logging
import time
from io import BytesIO

from PIL import Image, ImageOps

from app.schemas import OCRResult, OCRBlock, OCRItem
from app.services.ocr.base import BaseOCR
from app.services.ocr.prompts import SYSTEM_PROMPT, build_user_prompt, build_continuation_prompt

logger = logging.getLogger(__name__)

MAX_LONG_EDGE = 2000


def _resize_if_needed(image_bytes: bytes) -> tuple[bytes, int, int, int, int]:
    """
    如果图片长边超过 MAX_LONG_EDGE，等比缩放后返回压缩后的 JPEG 字节。
    自动应用 EXIF 方向校正，确保模型看到的图片方向与浏览器显示一致。
    返回 (processed_bytes, orig_w, orig_h, proc_w, proc_h)，
    orig = 校正+缩放前的尺寸（EXIF校正后），proc = 最终输出尺寸。
    坐标归一化统一用 orig 尺寸，确保前后端基准一致。
    """
    img = Image.open(BytesIO(image_bytes))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    orig_w, orig_h = img.size
    long_edge = max(orig_w, orig_h)

    if long_edge <= MAX_LONG_EDGE:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue(), orig_w, orig_h, orig_w, orig_h

    scale = MAX_LONG_EDGE / long_edge
    new_w = int(orig_w * scale)
    new_h = int(orig_h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=90)
    logger.info(f"图片已缩放：{orig_w}x{orig_h} → {new_w}x{new_h}")
    return buf.getvalue(), orig_w, orig_h, new_w, new_h


def _build_default_result() -> dict:
    """所有字段均为 null / 默认值的兜底结构，避免前端因字段缺失崩溃。"""
    return {
        "date": None,
        "mileage": None,
        "maintenance_type": None,
        "service_store": None,
        "next_mileage": None,
        "next_date": None,
        "cost": {"original": None, "discount": None, "actual": None},
        "items": [],
        "remark": None,
        "_confidence": {
            "date": 0.0,
            "mileage": 0.0,
            "maintenance_type": 0.0,
            "service_store": 0.0,
            "next_mileage": 0.0,
            "next_date": 0.0,
            "cost": 0.0,
            "items": 0.0,
            "remark": 0.0,
        },
    }


def _ensure_dict(result) -> dict:
    """确保 LLM 返回值是 dict；若为数组则取首个元素。"""
    if isinstance(result, dict):
        return result
    if isinstance(result, list) and result and isinstance(result[0], dict):
        logger.warning(f"LLM 返回了数组而非对象，自动取首个元素")
        return result[0]
    logger.error(f"LLM 返回了非 dict/list 类型: {type(result).__name__}")
    return {}


def _merge_defaults(result: dict) -> dict:
    """
    将模型返回的 dict 与默认结构合并：
    - 模型返回了的字段保留原值
    - 模型未返回的字段补默认值
    """
    default = _build_default_result()

    for key in default:
        if key not in result:
            result[key] = default[key]

    if not isinstance(result.get("cost"), dict):
        result["cost"] = default["cost"]
    else:
        for sub_key in ("original", "discount", "actual"):
            if sub_key not in result["cost"]:
                result["cost"][sub_key] = None

    if not isinstance(result.get("_confidence"), dict):
        result["_confidence"] = default["_confidence"]
    else:
        for conf_key in default["_confidence"]:
            if conf_key not in result["_confidence"]:
                result["_confidence"][conf_key] = 0.0

    # _bbox 必须是 dict[str, list]
    if not isinstance(result.get("_bbox"), dict):
        result["_bbox"] = {}

    # _items_bbox 必须是 list，每个元素必须是 list
    raw_items_bbox = result.get("_items_bbox")
    if not isinstance(raw_items_bbox, list):
        result["_items_bbox"] = []
    else:
        result["_items_bbox"] = [b for b in raw_items_bbox if isinstance(b, list)]

    if not isinstance(result.get("items"), list):
        result["items"] = []
    else:
        # 过滤掉非 dict 的 items 元素（LLM 偶尔返回数组而非对象）
        result["items"] = [
            item for item in result["items"] if isinstance(item, dict)
        ]
        for item in result["items"]:
            item.setdefault("name", None)
            item.setdefault("part_number", None)
            item.setdefault("operation", None)
            item.setdefault("quantity", 1)
            item.setdefault("unit_price", 0)
            item.setdefault("parts_fee", 0)
            item.setdefault("labor_fee", 0)
            item.setdefault("other_fee", 0)

    return result


def _bbox_to_polygon(bbox: list[float], img_w: float = 1, img_h: float = 1) -> list[dict[str, float]]:
    """将归一化 [x1,y1,x2,y2] 转换为像素级四角坐标 [{X,Y}, ...]"""
    if not bbox or len(bbox) != 4:
        return []
    x1, y1, x2, y2 = bbox
    return [
        {"X": x1 * img_w, "Y": y1 * img_h},
        {"X": x2 * img_w, "Y": y1 * img_h},
        {"X": x2 * img_w, "Y": y2 * img_h},
        {"X": x1 * img_w, "Y": y2 * img_h},
    ]


def _extract_blocks_from_items(items: list[dict]) -> list[OCRBlock]:
    """从 items 中提取带坐标的文本块"""
    blocks = []
    items_bbox = []
    try:
        # 从 items 提取名称作为 block text
        for item in items:
            name = item.get("name") or ""
            blocks.append(OCRBlock(text=name, polygon=[]))
    except Exception:
        pass
    return blocks


def _iou(box, det):
    """计算两个归一化 bbox 的 IoU"""
    x1, y1 = max(box[0], det[0]), max(box[1], det[1])
    x2, y2 = min(box[2], det[2]), min(box[3], det[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = (box[2] - box[0]) * (box[3] - box[1]) + (det[2] - det[0]) * (det[3] - det[1]) - inter
    return inter / union if union > 0 else 0


def _match_by_text(target: str, detect_blocks: list[dict]) -> int:
    """
    文本内容匹配：在 PaddleDetector 检测块中找文本最匹配的块。
    返回 block index 或 -1。
    """
    import re
    target = str(target).strip()
    if not target:
        return -1

    best_idx, best_score = -1, 0
    target_nums = re.findall(r'\d+\.?\d*', target)

    for i, blk in enumerate(detect_blocks):
        text = blk.get("text", "").strip()
        if not text:
            continue
        # 子串包含（双向），越接近满分越高
        if target in text:
            score = 0.5 + 0.5 * (len(target) / max(len(text), 1))
            if score > best_score:
                best_score, best_idx = score, i
            continue
        if text in target and len(text) >= 2:
            score = 0.3 + 0.3 * (len(text) / max(len(target), 1))
            if score > best_score:
                best_score, best_idx = score, i
            continue
        # 数字匹配（金额、里程等场景）
        if target_nums:
            text_nums = re.findall(r'\d+\.?\d*', text)
            common = set(target_nums) & set(text_nums)
            if common:
                score = 0.2 + 0.3 * (len(common) / len(target_nums))
                if score > best_score:
                    best_score, best_idx = score, i

    return best_idx if best_score >= 0.2 else -1


def _match_by_proximity(llm_box: list[float], detect_blocks: list[dict]) -> int:
    """空间近邻匹配：找中心距 LLM bbox 中心最近的检测块"""
    cx = (llm_box[0] + llm_box[2]) / 2
    cy = (llm_box[1] + llm_box[3]) / 2
    bbox_diag = ((llm_box[2] - llm_box[0]) ** 2 + (llm_box[3] - llm_box[1]) ** 2) ** 0.5
    max_dist = max(bbox_diag * 3, 0.15)

    best_idx, best_dist = -1, float('inf')
    for i, blk in enumerate(detect_blocks):
        det = blk["bbox"]
        dist = ((cx - (det[0] + det[2]) / 2) ** 2 + (cy - (det[1] + det[3]) / 2) ** 2) ** 0.5
        if dist < best_dist:
            best_dist, best_idx = dist, i

    return best_idx if (best_idx >= 0 and best_dist <= max_dist) else -1


def _match_item_combined(
    item_name: str,
    llm_box: list[float] | None,
    detect_blocks: list[dict],
    used: set[int],
) -> int:
    """
    综合文本+空间匹配（用于 items）。
    文本匹配是基础，空间距离作为加权——当多个检测块文本匹配时，
    优先选距离 LLM bbox 中心最近的那个。
    """
    import re
    target = str(item_name).strip()
    if not target:
        return -1

    target_nums = re.findall(r'\d+\.?\d*', target)

    # LLM bbox 中心作为空间参考点
    if llm_box and len(llm_box) == 4:
        llm_cx = (llm_box[0] + llm_box[2]) / 2
        llm_cy = (llm_box[1] + llm_box[3]) / 2
    else:
        llm_cx, llm_cy = None, None

    best_idx, best_score = -1, -1

    for i, blk in enumerate(detect_blocks):
        if i in used:
            continue
        text = blk.get("text", "").strip()
        if not text:
            continue

        # 文本匹配分（与 _match_by_text 一致）
        text_score = 0
        if target in text:
            text_score = 0.5 + 0.5 * (len(target) / max(len(text), 1))
        elif text in target and len(text) >= 2:
            text_score = 0.3 + 0.3 * (len(text) / max(len(target), 1))

        if target_nums:
            text_nums = re.findall(r'\d+\.?\d*', text)
            common = set(target_nums) & set(text_nums)
            if common:
                text_score = max(text_score, 0.2 + 0.3 * (len(common) / len(target_nums)))

        if text_score < 0.2:
            continue

        # 空间加分：有 LLM bbox 时，距离越近加分越多（0~0.3）
        spatial_bonus = 0
        if llm_cx is not None:
            det = blk["bbox"]
            det_cx = (det[0] + det[2]) / 2
            det_cy = (det[1] + det[3]) / 2
            dist = ((llm_cx - det_cx) ** 2 + (llm_cy - det_cy) ** 2) ** 0.5
            spatial_bonus = max(0, 0.3 * (1 - min(dist / 0.3, 1)))

        combined = text_score + spatial_bonus
        if combined > best_score:
            best_score, best_idx = combined, i

    return best_idx if best_score >= 0.2 else -1


def _refine_coords_with_detector(
    llm_result: dict,
    detect_blocks: list[dict],
) -> dict:
    """
    用 PaddleDetector 的精准坐标修正 LLM 返回的近似 bbox。

    匹配策略（按优先级）：
    1. 文本内容匹配：检测块文本包含字段值 → 直接用精准坐标
    2. IoU 空间重叠：检测块与 LLM bbox 重叠度最高
    3. 空间近邻兜底：中心点距 LLM bbox 中心最近的检测块
    """
    if not detect_blocks:
        return llm_result

    refined = dict(llm_result)
    refined_bbox = {}
    llm_bbox = llm_result.get("_bbox") or {}
    llm_items_bbox = llm_result.get("_items_bbox") or []

    # 收集各字段的值，用于文本匹配
    field_values: dict[str, str] = {}
    for key in ("date", "mileage", "maintenance_type", "service_store",
                "next_mileage", "next_date", "remark"):
        val = llm_result.get(key)
        if val is not None:
            field_values[key] = str(val)
    cost = llm_result.get("cost", {})
    if isinstance(cost, dict):
        for sub in ("original", "discount", "actual"):
            val = cost.get(sub)
            if val is not None:
                field_values[f"cost_{sub}"] = str(val)
        # 旧格式兜底：LLM 可能仍返回 "cost" 而非 "cost_original"
        if "cost" in llm_bbox and "cost_original" not in llm_bbox:
            field_values["cost"] = str(cost.get("original", ""))

    def _find_best(llm_box, field_value: str | None = None) -> int:
        """综合策略找最佳匹配，返回 block index 或 -1"""
        # 策略 1：文本匹配（最可靠）
        if field_value:
            idx = _match_by_text(field_value, detect_blocks)
            if idx >= 0:
                return idx
        # 策略 2：IoU 匹配
        best_idx, best_score = -1, 0
        for i, blk in enumerate(detect_blocks):
            score = _iou(llm_box, blk["bbox"])
            if score > best_score:
                best_score, best_idx = score, i
        if best_idx >= 0 and best_score >= 0.05:
            return best_idx
        # 策略 3：近邻匹配
        return _match_by_proximity(llm_box, detect_blocks)

    # 修正字段 bbox
    for field, llm_box in llm_bbox.items():
        if not llm_box or len(llm_box) != 4:
            refined_bbox[field] = llm_box
            continue
        best_idx = _find_best(llm_box, field_values.get(field))
        if best_idx >= 0:
            refined_bbox[field] = detect_blocks[best_idx]["bbox"]
            logger.info(f"字段 [{field}] 精化成功：LLM {llm_box} → 检测 {detect_blocks[best_idx]['bbox']} | text={detect_blocks[best_idx].get('text','')!r}")
        else:
            refined_bbox[field] = llm_box
            logger.warning(f"字段 [{field}] 所有策略失败，保留LLM bbox={llm_box}")

    # 修正 items bbox：用综合文本+空间匹配
    llm_items = llm_result.get("items") or []
    refined_items_bbox = []
    used_det_indices: set[int] = set()
    for i in range(max(len(llm_items_bbox), len(llm_items))):
        llm_item_box = llm_items_bbox[i] if i < len(llm_items_bbox) else None
        item_name = llm_items[i].get("name") if i < len(llm_items) else None

        # 综合匹配：文本 + 空间加权，used 集合防止重复占用
        best_idx = _match_item_combined(item_name, llm_item_box, detect_blocks, used_det_indices)

        if best_idx >= 0:
            used_det_indices.add(best_idx)
            refined_items_bbox.append(detect_blocks[best_idx]["bbox"])
            logger.info(f"items[{i}] 精化：{item_name!r} → {detect_blocks[best_idx].get('text','')!r}")
        else:
            # 保留原始值（可能是 null），保持索引对齐
            refined_items_bbox.append(llm_item_box)
            logger.warning(f"items[{i}] 匹配失败：{item_name!r}")

    refined["_bbox"] = refined_bbox
    refined["_items_bbox"] = refined_items_bbox
    return refined


def _map_llm_to_ocr_result(
    llm_result: dict,
    image_bytes: bytes,
    raw_json: str = "",
    norm_w: int | None = None,
    norm_h: int | None = None,
) -> OCRResult:
    """
    将 LLM 返回的 dict 转换为前端 OCRResult 格式。
    norm_w/norm_h：坐标归一化用的图片宽度/高度，必须为原图尺寸，
    确保前端 SVG viewBox 与显示图片尺寸一致。
    """
    from PIL import Image
    from io import BytesIO

    # norm_w/norm_h 由调用方传入（必须），不再 fallback 到 image_bytes 自身尺寸
    if norm_w is None or norm_h is None:
        img_ref = Image.open(BytesIO(image_bytes))
        norm_w = img_ref.size[0]
        norm_h = img_ref.size[1]
    fields: dict[str, str] = {}
    field_coords: dict[str, list[dict[str, float]]] = {}

    # 字段映射：LLM 输出名 → OCRResult 字段名
    field_mapping = {
        "date": "date",
        "mileage": "mileage",
        "maintenance_type": "type",
        "service_store": "station",
        "next_mileage": "next_mileage",
        "next_date": "next_date",
        "remark": "notes",
    }

    bbox_data: dict[str, list[float]] = llm_result.get("_bbox", {})
    cost = llm_result.get("cost", {}) or {}

    for llm_key, ocr_key in field_mapping.items():
        value = llm_result.get(llm_key)
        if value is not None:
            fields[ocr_key] = str(value)
        if llm_key in bbox_data and bbox_data[llm_key] is not None:
            field_coords[ocr_key] = _bbox_to_polygon(bbox_data[llm_key], norm_w, norm_h)

    # 金额字段（三个独立坐标：cost_original → total_amount, cost_discount → discount, cost_actual → paid_amount）
    # 兼容旧格式：LLM 可能仍返回 "cost" 而非 "cost_original"
    cost_bbox_map = {
        "cost_original": "total_amount",
        "cost_discount": "discount",
        "cost_actual": "paid_amount",
    }
    if cost.get("original") is not None:
        fields["total_amount"] = str(cost["original"])
        # 优先新格式 cost_original，fallback 到旧格式 cost
        bbox_key = "cost_original" if "cost_original" in bbox_data else "cost"
        if bbox_key in bbox_data and bbox_data[bbox_key] is not None:
            field_coords["total_amount"] = _bbox_to_polygon(bbox_data[bbox_key], norm_w, norm_h)
    if cost.get("discount") is not None:
        fields["discount"] = str(cost["discount"])
        if "cost_discount" in bbox_data and bbox_data["cost_discount"] is not None:
            field_coords["discount"] = _bbox_to_polygon(bbox_data["cost_discount"], norm_w, norm_h)
    if cost.get("actual") is not None:
        fields["paid_amount"] = str(cost["actual"])
        if "cost_actual" in bbox_data and bbox_data["cost_actual"] is not None:
            field_coords["paid_amount"] = _bbox_to_polygon(bbox_data["cost_actual"], norm_w, norm_h)

    # items：提取完整项目对象
    llm_items = llm_result.get("items", []) or []
    ocr_items: list[OCRItem] = []
    item_names: list[str] = []
    for item in llm_items:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or ""
        if not name:
            continue
        item_names.append(name)
        ocr_items.append(OCRItem(
            name=name,
            part_number=item.get("part_number") or "",
            operation=item.get("operation") or "",
            quantity=item.get("quantity") or 1,
            unit_price=item.get("unit_price") or 0,
            parts_fee=item.get("parts_fee") or 0,
            labor_fee=item.get("labor_fee") or 0,
            other_fee=item.get("other_fee") or 0,
        ))

    # blocks：items 名称作为文本块（无 polygon）
    blocks = [OCRBlock(text=name, polygon=[]) for name in item_names]

    # items_bbox 转换（保留索引对齐，空列表代替 null，前端按 idx 取对应 bbox）
    items_bbox_raw = llm_result.get("_items_bbox") or []
    items_bbox: list[list[float]] = []
    for bbox in items_bbox_raw:
        if isinstance(bbox, list) and len(bbox) == 4 and all(v is not None for v in bbox):
            items_bbox.append(bbox)
        else:
            items_bbox.append([])  # 保留索引位置，前端 length !== 4 时跳过渲染

    # confidence：映射 LLM key → 前端 key（与 field_mapping + 费用映射保持一致）
    raw_confidence: dict = llm_result.get("_confidence") or {}
    conf_key_map = {**field_mapping, "cost": "total_amount", **cost_bbox_map}
    confidence: dict[str, float] = {}
    for llm_key, v in raw_confidence.items():
        if v is not None:
            mapped = conf_key_map.get(llm_key)
            if mapped:
                confidence[mapped] = float(v)

    img_b64 = base64.b64encode(image_bytes).decode()

    # bbox：过滤 null 值 + 映射 key 与 field_mapping 一致
    bbox_clean: dict[str, list[float]] = {}
    for llm_key, v in bbox_data.items():
        if v is None:
            continue
        if llm_key in cost_bbox_map:
            bbox_clean[cost_bbox_map[llm_key]] = v
        elif llm_key == "cost" and "cost_original" not in bbox_data:
            # 旧格式 fallback
            bbox_clean["total_amount"] = v
        else:
            mapped = field_mapping.get(llm_key)
            if mapped:
                bbox_clean[mapped] = v

    return OCRResult(
        raw_text="",
        fields=fields,
        items=ocr_items,
        blocks=blocks,
        field_coords=field_coords,
        image_base64=img_b64,
        confidence=confidence,
        bbox=bbox_clean,
        items_bbox=items_bbox,
        raw_json=raw_json,
        natural_width=norm_w,
        natural_height=norm_h,
    )


class LLMOCR(BaseOCR):
    """LLM 多模态 OCR（OpenAI 兼容接口）"""

    def __init__(self, api_url: str, api_key: str, model: str):
        self.api_url = api_url
        self.api_key = api_key
        self.model = model

    async def recognize(self, image_bytes: bytes, pdf_page: int | None = None) -> OCRResult:
        """同步调用，同步返回（FastAPI 在线程池中运行，不阻塞事件循环）"""
        import openai

        t_start = time.time()

        # 1. 图片预处理
        processed_bytes, _, _, proc_w, proc_h = _resize_if_needed(image_bytes)
        b64_image = base64.b64encode(processed_bytes).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64_image}"

        # 2. 构造消息
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": build_user_prompt()},
                ],
            },
        ]

        # 3. 调用模型
        client = openai.OpenAI(api_key=self.api_key, base_url=self.api_url)
        logger.info(
            f"LLM OCR 调用模型 [{self.model}]，图片大小 {len(processed_bytes) / 1024:.1f} KB"
        )

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=8192,
            )
        except Exception as api_err:
            fallback_model = "qwen3.6-flash"
            logger.warning(
                f"模型 [{self.model}] 调用失败：{api_err}，尝试降级到 [{fallback_model}]"
            )
            try:
                response = client.chat.completions.create(
                    model=fallback_model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=8192,
                )
                self.model = fallback_model
            except Exception as fallback_err:
                logger.error(f"Fallback 模型 [{fallback_model}] 也失败：{fallback_err}")
                return OCRResult(raw_text="", fields={}, items=[], error=f"OCR 模型调用失败：{fallback_err}")

        elapsed = time.time() - t_start
        raw_content = response.choices[0].message.content
        logger.info(
            f"LLM OCR 模型 [{self.model}] 响应完成，耗时 {elapsed:.2f}s\n"
            f"── 原始返回 ──\n{raw_content}\n──────────────"
        )

        # 4. 解析 JSON — 返回空时重试一次（可能是限流导致）
        if not raw_content or not raw_content.strip():
            logger.warning(f"LLM 返回内容为空，2 秒后重试...")
            time.sleep(2)
            try:
                response = client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=8192,
                )
                raw_content = response.choices[0].message.content
            except Exception as retry_err:
                logger.error(f"重试失败：{retry_err}")
                return OCRResult(raw_text="", fields={}, items=[], error=f"OCR 模型调用失败：{retry_err}")

        if not raw_content or not raw_content.strip():
            logger.error(f"LLM 返回内容为空（已重试），请检查 API 是否触发限流或内容审核")
            return OCRResult(raw_text="", fields={}, items=[], error="LLM 返回为空，可能触发了 API 限流，请稍后重试")

        try:
            llm_result = json.loads(raw_content)
            llm_result = _ensure_dict(llm_result)
        except json.JSONDecodeError as e:
            logger.warning(f"JSON 解析失败，尝试手动提取：{e}")
            start_idx = raw_content.find("{")
            end_idx = raw_content.rfind("}") + 1
            if start_idx >= 0 and end_idx > start_idx:
                llm_result = json.loads(raw_content[start_idx:end_idx])
                llm_result = _ensure_dict(llm_result)
            else:
                return OCRResult(
                    raw_text="",
                    fields={},
                    items=[],
                    error=f"JSON 解析失败：{e}",
                )

        # 5. 字段兜底
        llm_result = _merge_defaults(llm_result)

        # 6. 转换为 OCRResult（坐标归一化用原图尺寸，确保前后端基准一致）
        return _map_llm_to_ocr_result(llm_result, processed_bytes, raw_content, proc_w, proc_h)

    async def recognize_with_detect(
        self, image_bytes: bytes
    ) -> tuple[OCRResult, list[dict], bytes]:
        """
        LLM OCR + PaddleDetector 联合调用。
        两者使用完全相同的 processed_bytes，确保归一化坐标空间一致。

        Returns:
            (OCRResult, detect_blocks, processed_bytes)
            - OCRResult: LLM 识别结果（坐标待精化）
            - detect_blocks: PaddleDetector 精准坐标
            - processed_bytes: 两边共用的已缩放图片字节
        """
        import openai
        from PIL import Image
        from io import BytesIO

        t_start = time.time()

        # 1. 图片预处理（发送给 LLM 用 processed_bytes，坐标归一化统一用 orig 尺寸）
        processed_bytes, orig_w, orig_h, proc_w, proc_h = _resize_if_needed(image_bytes)
        b64_image = base64.b64encode(processed_bytes).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64_image}"

        # 2. PaddleDetector（检测用 processed_bytes，归一化用 orig 尺寸 → 与 LLM bbox 空间一致）
        from app.services.ocr.paddle_detector import get_detector
        detector = get_detector()
        # 用 processed_bytes 的实际尺寸归一化，确保与 LLM bbox 坐标空间一致
        detect_blocks = detector.detect(processed_bytes, known_size=(proc_w, proc_h))

        # 3. LLM 识别
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": build_user_prompt()},
                ],
            },
        ]

        client = openai.OpenAI(api_key=self.api_key, base_url=self.api_url)
        logger.info(f"LLM OCR+检测 调用模型 [{self.model}]")

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=8192,
            )
        except Exception as api_err:
            fallback_model = "qwen3.6-flash"
            logger.warning(f"模型 [{self.model}] 失败，降级到 [{fallback_model}]")
            try:
                response = client.chat.completions.create(
                    model=fallback_model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=8192,
                )
                self.model = fallback_model
            except Exception as fallback_err:
                logger.error(f"Fallback 模型 [{fallback_model}] 也失败：{fallback_err}")
                return (
                    OCRResult(raw_text="", fields={}, items=[], error=f"OCR 模型调用失败：{fallback_err}"),
                    [],
                    processed_bytes,
                )

        elapsed = time.time() - t_start
        raw_content = response.choices[0].message.content
        logger.info(f"LLM OCR+检测 完成，耗时 {elapsed:.2f}s")

        # 4. 解析 JSON
        if not raw_content or not raw_content.strip():
            logger.error(f"LLM 返回内容为空")
            return (
                OCRResult(raw_text="", fields={}, items=[], error="LLM 返回为空，请检查 API 配置"),
                [],
                processed_bytes,
            )

        try:
            llm_result = json.loads(raw_content)
            llm_result = _ensure_dict(llm_result)
        except json.JSONDecodeError as e:
            logger.warning(f"JSON 解析失败：{e}")
            start_idx = raw_content.find("{")
            end_idx = raw_content.rfind("}") + 1
            if start_idx >= 0 and end_idx > start_idx:
                llm_result = json.loads(raw_content[start_idx:end_idx])
                llm_result = _ensure_dict(llm_result)
            else:
                return (
                    OCRResult(raw_text="", fields={}, items=[], error=f"JSON 解析失败：{e}"),
                    [],
                    processed_bytes,
                )

        llm_result = _merge_defaults(llm_result)

        # 5. 精化坐标（用 PaddleDetector 的精准坐标替换 LLM 的估算值，两者均已归一化到 orig 尺寸）
        logger.info(f"PaddleDetector 检测到 {len(detect_blocks)} 个文字区域")
        if detect_blocks:
            sample = detect_blocks[0]
            logger.info(f"  示例检测块: text={sample.get('text','')!r} bbox={sample.get('bbox','')}")
        llm_result = _refine_coords_with_detector(llm_result, detect_blocks)

        # 6. 构建 OCRResult（坐标归一化用 orig 尺寸，与前端显示的原图尺寸一致）
        # natural_width/height 用 processed_bytes 实际尺寸，与前端显示图片一致
        ocr_result = _map_llm_to_ocr_result(llm_result, processed_bytes, raw_content, proc_w, proc_h)
        return ocr_result, detect_blocks, processed_bytes

    async def recognize_continuation_with_detect(
        self, image_bytes: bytes
    ) -> tuple[OCRResult, list[dict], bytes]:
        """
        续页 OCR：用于 PDF 第2页+，只提取保养项目表格和金额。
        与主流程复用相同的 SYSTEM_PROMPT 和容错策略，确保提取质量一致。
        """
        import openai
        from PIL import Image
        from io import BytesIO

        t_start = time.time()

        processed_bytes, orig_w, orig_h, proc_w, proc_h = _resize_if_needed(image_bytes)
        b64_image = base64.b64encode(processed_bytes).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64_image}"

        # PaddleDetector
        from app.services.ocr.paddle_detector import get_detector
        detector = get_detector()
        detect_blocks = detector.detect(processed_bytes, known_size=(proc_w, proc_h))

        # 复用 SYSTEM_PROMPT，确保模型有完整的抽取规则上下文
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": build_continuation_prompt()},
                ],
            },
        ]

        client = openai.OpenAI(api_key=self.api_key, base_url=self.api_url)
        logger.info(f"续页 OCR 调用模型 [{self.model}]")

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=8192,
            )
        except Exception as api_err:
            fallback_model = "qwen3.6-flash"
            logger.warning(f"续页 模型 [{self.model}] 失败，降级到 [{fallback_model}]")
            try:
                response = client.chat.completions.create(
                    model=fallback_model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=8192,
                )
                self.model = fallback_model
            except Exception as fallback_err:
                logger.error(f"续页 Fallback 模型 [{fallback_model}] 也失败：{fallback_err}")
                return (
                    OCRResult(raw_text="", fields={}, items=[], error=f"续页 OCR 失败：{fallback_err}"),
                    [],
                    processed_bytes,
                )

        elapsed = time.time() - t_start
        raw_content = response.choices[0].message.content
        logger.info(f"续页 OCR 完成，耗时 {elapsed:.2f}s\n── 原始返回 ──\n{raw_content}")

        # 空响应重试一次（与主流程一致）
        if not raw_content or not raw_content.strip():
            logger.warning(f"续页 LLM 返回内容为空，2 秒后重试...")
            time.sleep(2)
            try:
                response = client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=8192,
                )
                raw_content = response.choices[0].message.content
            except Exception as retry_err:
                logger.error(f"续页重试失败：{retry_err}")
                return (OCRResult(raw_text="", fields={}, items=[], error=f"续页 OCR 失败：{retry_err}"), [], processed_bytes)

        if not raw_content or not raw_content.strip():
            logger.error(f"续页 LLM 返回内容为空（已重试）")
            return (OCRResult(raw_text="", fields={}, items=[], error="续页 LLM 返回为空"), [], processed_bytes)

        # JSON 解析（含 markdown 包裹兜底，与主流程一致）
        try:
            llm_result = json.loads(raw_content)
            llm_result = _ensure_dict(llm_result)
        except json.JSONDecodeError as e:
            logger.warning(f"续页 JSON 解析失败，尝试手动提取：{e}")
            start_idx = raw_content.find("{")
            end_idx = raw_content.rfind("}") + 1
            if start_idx >= 0 and end_idx > start_idx:
                llm_result = json.loads(raw_content[start_idx:end_idx])
                llm_result = _ensure_dict(llm_result)
            else:
                return (
                    OCRResult(raw_text="", fields={}, items=[], error=f"续页 JSON 解析失败：{e}"),
                    [],
                    processed_bytes,
                )

        # 构造兼容 OCRResult 的结构
        synthetic = _build_default_result()
        raw_items = llm_result.get("items")
        synthetic["items"] = [i for i in (raw_items if isinstance(raw_items, list) else []) if isinstance(i, dict)]
        raw_items_bbox = llm_result.get("_items_bbox")
        synthetic["_items_bbox"] = [b for b in (raw_items_bbox if isinstance(raw_items_bbox, list) else []) if isinstance(b, list)]
        cost = llm_result.get("cost")
        if isinstance(cost, dict):
            synthetic["cost"] = cost
            synthetic["_confidence"]["cost"] = 0.8
        synthetic["_confidence"]["items"] = 0.8

        synthetic = _merge_defaults(synthetic)

        # 用 PaddleDetector 精化坐标
        if detect_blocks:
            synthetic = _refine_coords_with_detector(synthetic, detect_blocks)

        ocr_result = _map_llm_to_ocr_result(synthetic, processed_bytes, raw_content, proc_w, proc_h)
        return ocr_result, detect_blocks, processed_bytes
