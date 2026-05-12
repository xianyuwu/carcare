"""开发 SQLite → 生产 PostgreSQL 数据迁移脚本

用法：
  1. 确保本机能连到生产 PG（可通过 SSH 隧道转发）
     ssh -L 5433:localhost:5432 root@10.0.86.23

  2. 设置 DATABASE_URL 指向生产 PG
     DATABASE_URL=postgresql+asyncpg://carcare:carcare2024@localhost:5433/carcare python migrate_to_pg.py

  3. 同步上传文件到服务器
     rsync -avz data/files/ root@10.0.86.23:/opt/carcare/data/files/
     rsync -avz data/vehicle_photos/ root@10.0.86.23:/opt/carcare/data/files/vehicles/
"""
import asyncio
import os
import sys

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models.models import (
    User, Vehicle, VehicleShare, MaintenanceRecord, MaintenanceItem,
    Manual, ItemTemplate, AIPrediction, ChatFeedback, SearchUsage
)


async def migrate():
    # ── 源：本地 SQLite ──
    src_engine = create_async_engine("sqlite+aiosqlite:///data/carcare.db")
    src_session = async_sessionmaker(src_engine, expire_on_commit=False)

    # ── 目标：PostgreSQL（DATABASE_URL 环境变量） ──
    dst_url = os.getenv("DATABASE_URL")
    if not dst_url:
        print("请设置 DATABASE_URL 指向生产 PG")
        sys.exit(1)
    dst_engine = create_async_engine(dst_url, pool_size=1)
    dst_session = async_sessionmaker(dst_engine, expire_on_commit=False)

    # 确保目标表已创建
    from app.database import Base
    async with dst_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 迁移顺序：先父表后子表
    tables: list[tuple[type, str]] = [
        (User, "users"),
        (Vehicle, "vehicles"),
        (VehicleShare, "vehicle_shares"),
        (MaintenanceRecord, "maintenance_records"),
        (MaintenanceItem, "maintenance_items"),
        (Manual, "manuals"),
        (ItemTemplate, "item_templates"),
        (AIPrediction, "ai_predictions"),
        (ChatFeedback, "chat_feedback"),
        (SearchUsage, "search_usage"),
    ]

    async with src_session() as src, dst_session() as dst:
        for model, name in tables:
            # 清空目标表（幂等迁移）
            await dst.execute(text(f"TRUNCATE {name} CASCADE"))
            await dst.commit()

            result = await src.execute(select(model))
            rows = result.scalars().all()
            if not rows:
                print(f"  {name}: 0 条（跳过）")
                continue

            for obj in rows:
                # 直接复制所有列（含 id），保持 FK 关系不断
                dst.add(model(**{
                    c.name: getattr(obj, c.name)
                    for c in model.__table__.columns
                }))

            await dst.commit()
            print(f"  {name}: {len(rows)} 条 ✓")

    # 重置 PG 序列，避免后续插入主键冲突
    async with dst_session() as dst:
        for _, name in tables:
            await dst.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), coalesce(max(id), 1)) FROM {name}"
            ))
        await dst.commit()
    print("序列已校准")

    await src_engine.dispose()
    await dst_engine.dispose()
    print("\n迁移完成！")


if __name__ == "__main__":
    asyncio.run(migrate())
