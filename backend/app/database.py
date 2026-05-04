from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import select, text
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "carcare.db"

engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}", echo=False)
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


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed item_templates if empty
    async with async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM item_templates"))
        count = result.scalar()
        if count == 0:
            from app.models.models import ItemTemplate
            for t in SEED_TEMPLATES:
                session.add(ItemTemplate(**t))
            await session.commit()
