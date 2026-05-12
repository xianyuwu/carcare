import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import select, text
from pathlib import Path

logger = logging.getLogger(__name__)

# 环境变量切换数据库：不设默认为 SQLite，设为 PG 连接串则用 PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL", "")
if DATABASE_URL:
    # PostgreSQL: postgresql+asyncpg://user:pass@host:5432/dbname
    engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
    logger.info("数据库: PostgreSQL (%s)", DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL)
else:
    DATA_DIR = Path(__file__).resolve().parent.parent / "data"
    DATA_DIR.mkdir(exist_ok=True)
    DB_PATH = DATA_DIR / "carcare.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}", echo=False)
    logger.info("数据库: SQLite (%s)", DB_PATH)

async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


SEED_TEMPLATES = [
    {"name": "更换机油", "category": "常规"},
    {"name": "更换机油滤清器", "category": "常规"},
    {"name": "更换空气滤清器", "category": "常规"},
    {"name": "更换空调滤清器", "category": "常规"},
    {"name": "更换刹车油", "category": "制动"},
    {"name": "更换火花塞", "category": "点火"},
    {"name": "更换变速箱油", "category": "传动"},
    {"name": "更换冷却液", "category": "冷却"},
    {"name": "更换刹车片", "category": "制动"},
    {"name": "更换轮胎", "category": "轮胎"},
    {"name": "四轮定位", "category": "底盘"},
    {"name": "更换正时皮带/链条", "category": "发动机"},
]

# 默认管理员账号
DEFAULT_ADMIN_EMAIL = "admin@carcare.local"
DEFAULT_ADMIN_PASSWORD = "admin123"  # 首次登录后请修改


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # 创建默认管理员（如果不存在）
        from app.models.models import User
        from app.services.auth import hash_password

        result = await session.execute(select(User).where(User.email == DEFAULT_ADMIN_EMAIL))
        admin = result.scalar_one_or_none()
        if not admin:
            admin = User(
                email=DEFAULT_ADMIN_EMAIL,
                password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
                nickname="管理员",
                role="admin"
            )
            session.add(admin)
            await session.commit()
            print(f"默认管理员已创建: {DEFAULT_ADMIN_EMAIL} / {DEFAULT_ADMIN_PASSWORD}")

        # Seed item_templates if empty
        result = await session.execute(text("SELECT COUNT(*) FROM item_templates"))
        count = result.scalar()
        if count == 0:
            from app.models.models import ItemTemplate
            for t in SEED_TEMPLATES:
                session.add(ItemTemplate(**t))
            await session.commit()
