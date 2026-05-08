from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Vehicle, VehicleShare, User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


async def check_vehicle_access(db: AsyncSession, vehicle_id: int, user_id: int) -> Vehicle:
    """检查用户是否有权访问车辆"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")

    if vehicle.owner_id == user_id:
        return vehicle

    result = await db.execute(
        select(VehicleShare).where(
            VehicleShare.vehicle_id == vehicle_id,
            VehicleShare.user_id == user_id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "无权访问该车辆")

    return vehicle


@router.get("/prediction")
async def get_prediction(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取缓存的 AI 预测结果"""
    await check_vehicle_access(db, vehicle_id, current_user.id)

    from app.services.rag.alerts import get_cached_prediction
    result = await get_cached_prediction(vehicle_id)
    return result or {"predicted_items": [], "reasoning": "", "estimated_cost": 0, "cost_reasoning": "", "generated_at": None}


@router.post("/prediction/generate")
async def generate_prediction(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """重新生成 AI 预测"""
    await check_vehicle_access(db, vehicle_id, current_user.id)

    from app.services.rag.alerts import generate_and_cache_prediction
    return await generate_and_cache_prediction(vehicle_id)
