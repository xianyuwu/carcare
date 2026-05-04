from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Setting
from app.config import get_secret
from app.services.ocr.base import BaseOCR
from app.services.ocr.aliyun import AliyunOCR
from app.services.ocr.tencent_doc import TencentDocOCR
from app.services.ocr.baidu import BaiduOCR


async def _get_db_setting(db: AsyncSession, key: str) -> str:
    """从数据库读取非敏感配置"""
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else ""


async def get_ocr_service(db: AsyncSession) -> BaseOCR:
    provider = await _get_db_setting(db, "ocr_provider")

    if provider == "tencent":
        return TencentDocOCR(
            secret_id=get_secret("ocr_tencent_secret_id"),
            secret_key=get_secret("ocr_tencent_secret_key"),
        )
    elif provider == "baidu":
        return BaiduOCR(
            app_id=get_secret("ocr_baidu_app_id"),
            api_key=get_secret("ocr_baidu_api_key"),
            secret_key=get_secret("ocr_baidu_secret_key"),
        )
    else:  # default: aliyun
        return AliyunOCR(
            access_key_id=get_secret("ocr_aliyun_access_key_id"),
            access_key_secret=get_secret("ocr_aliyun_access_key_secret"),
            endpoint=await _get_db_setting(db, "ocr_aliyun_endpoint"),
        )
