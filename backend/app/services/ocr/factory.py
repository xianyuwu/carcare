from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Setting
from app.config import get_secret, get_all_secrets
from app.services.ocr.llm_ocr import LLMOCR


async def _get_db_setting(db: AsyncSession, key: str) -> str:
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else ""


async def get_ocr_service(db: AsyncSession) -> LLMOCR:
    """
    创建 LLM 多模态 OCR 服务实例。
    使用独立的 OCR 多模态模型配置。
    """
    api_url = await _get_db_setting(db, "ocr_llm_api_url")
    api_key = get_secret("ocr_llm_api_key")
    model = await _get_db_setting(db, "ocr_llm_model")

    return LLMOCR(
        api_url=api_url,
        api_key=api_key,
        model=model,
    )
