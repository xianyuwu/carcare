"""
paddle_detector.py
PaddleOCR 文字检测模块（本地推理，CPU）

职责：
1. 接收图片字节，返回文字区域精准坐标
2. 与 LLM OCR 解耦——坐标由本模块提供，LLM 只负责语义理解
"""

import logging
from io import BytesIO
from typing import Optional

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

MAX_LONG_EDGE = 1800  # 检测模型输入上限，太大影响速度


def _resize_image(image_bytes: bytes) -> tuple[bytes, float]:
    """
    缩放图片到合适尺寸，返回 (处理后字节, 缩放因子)
    缩放因子用于将检测坐标映射回原图尺寸
    """
    img = Image.open(BytesIO(image_bytes))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    w, h = img.size
    long_edge = max(w, h)

    if long_edge <= MAX_LONG_EDGE:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=95)
        return buf.getvalue(), w / w  # scale = 1

    scale = MAX_LONG_EDGE / long_edge
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=95)
    logger.info(f"PaddleOCR 图片缩放：{w}x{h} → {new_w}x{new_h}")
    return buf.getvalue(), scale


class PaddleDetector:
    """PaddleOCR 文字检测器（单例复用，节省模型加载时间）"""

    def __init__(self, use_angle_cls: bool = False, lang: str = "ch"):
        self.use_angle_cls = use_angle_cls
        self.lang = lang
        self._engine: Optional[object] = None

    @property
    def engine(self):
        """延迟加载引擎，首次调用时初始化"""
        if self._engine is None:
            from paddleocr import PaddleOCR
            logger.info("初始化 PaddleOCR 检测引擎（首次加载，约 10~30s）...")
            self._engine = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                lang=self.lang,
                text_det_limit_side_len=960,
                text_det_limit_type="max",
            )
            logger.info("PaddleOCR 检测引擎初始化完成")
        return self._engine

    def detect(self, image_bytes: bytes, known_size: tuple[int, int] | None = None) -> list[dict]:
        """
        检测图片中所有文字区域，返回结构化坐标信息。

        Args:
            image_bytes: 图片字节
            known_size: 可选，已知图片尺寸 (w, h)，用于归一化。
                       如果不传则从 image_bytes 自己读取。

        Returns:
            List[dict]，每个元素：
            {
                "text": str,       # 识别出的文字（供 LLM 参考）
                "bbox": [x1, y1, x2, y2],  # 归一化坐标 (0~1)
                "center": [cx, cy],         # 归一化中心点
            }
        """
        import time
        from PIL import Image
        from io import BytesIO

        if known_size:
            w, h = known_size
        else:
            img = Image.open(BytesIO(image_bytes))
            w, h = img.size

        t0 = time.time()
        # 新版 PaddleOCR 3.x API：需要传 numpy array 或文件路径，不接受原始 bytes
        import numpy as np
        import cv2
        np_img = np.frombuffer(image_bytes, dtype=np.uint8)
        np_img = cv2.imdecode(np_img, cv2.IMREAD_COLOR)
        raw = self.engine.ocr(np_img)
        elapsed = time.time() - t0

        blocks = []
        if raw is None or (isinstance(raw, (list, tuple)) and len(raw) == 0):
            logger.info(f"PaddleOCR 检测完成，耗时 {elapsed:.2f}s，未检测到文字区域")
            return blocks

        # 取第一页（与 LLM OCR 一致）
        page_data = raw[0] if isinstance(raw, list) else raw
        dt_polys = page_data.get("dt_polys") or []
        rec_texts = page_data.get("rec_texts") or []
        rec_scores = page_data.get("rec_scores") or []

        logger.info(f"PaddleOCR 检测完成，耗时 {elapsed:.2f}s，检测到 {len(dt_polys)} 个文字区域")

        for i, poly_pts in enumerate(dt_polys):
            # dt_polys 可能是 numpy array，强制转 list
            try:
                pts = poly_pts.tolist() if hasattr(poly_pts, 'tolist') else list(poly_pts)
            except Exception:
                continue
            if len(pts) < 4:
                continue

            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            x1, y1 = min(xs), min(ys)
            x2, y2 = max(xs), max(ys)

            # 归一化
            norm_bbox = [x1 / w, y1 / h, x2 / w, y2 / h]
            norm_center = [(x1 + x2) / 2 / w, (y1 + y2) / 2 / h]

            # rec_texts / rec_scores 可能是 numpy array
            def safe_get(arr, idx, default=""):
                try:
                    v = arr[idx]
                    return v.tolist() if hasattr(v, 'tolist') else v
                except Exception:
                    return default

            text = safe_get(rec_texts, i, "")
            conf = safe_get(rec_scores, i, 1.0)

            blocks.append({
                "text": text,
                "conf": float(conf),
                "bbox": norm_bbox,
                "center": norm_center,
                "polygon": [{"X": p[0] / w, "Y": p[1] / h} for p in pts],
            })

        return blocks


# 全局单例，进程内复用
_detector: Optional[PaddleDetector] = None


def get_detector() -> PaddleDetector:
    global _detector
    if _detector is None:
        _detector = PaddleDetector()
    return _detector