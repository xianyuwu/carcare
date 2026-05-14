from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pathlib import Path
import uuid

from app.database import get_db
from app.models import Vehicle, VehicleShare, User, MaintenanceRecord, Manual
from app.schemas import VehicleCreate, VehicleUpdate, VehicleOut, VehicleShareCreate, VehicleShareOut
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])



def _with_photo_url(vehicle: Vehicle) -> dict:
    data = {c.name: getattr(vehicle, c.name) for c in vehicle.__table__.columns}
    data["photo_url"] = f"/api/vehicle-photos/{vehicle.id}/{vehicle.photo_path}" if vehicle.photo_path else None
    return data


async def get_user_vehicle_ids(db: AsyncSession, user_id: int) -> list[int]:
    """获取用户有权访问的车辆 ID 列表（自己的 + 被分享的）"""
    # 自己拥有的车辆
    result = await db.execute(
        select(Vehicle.id).where(Vehicle.owner_id == user_id)
    )
    owned = set(row[0] for row in result.all())

    # 被分享的车辆（read 或 write 权限）
    result = await db.execute(
        select(VehicleShare.vehicle_id).where(VehicleShare.user_id == user_id)
    )
    shared = set(row[0] for row in result.all())

    return list(owned | shared)


async def check_vehicle_access(
    vehicle_id: int,
    db: AsyncSession,
    user_id: int,
    require_write: bool = False
) -> Vehicle | None:
    """检查用户对车辆的访问权限"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        return None

    # 车主总有权限
    if vehicle.owner_id == user_id:
        return vehicle

    # 检查分享权限
    result = await db.execute(
        select(VehicleShare).where(
            VehicleShare.vehicle_id == vehicle_id,
            VehicleShare.user_id == user_id
        )
    )
    share = result.scalar_one_or_none()

    if not share:
        return None

    if require_write and share.permission != "write":
        raise HTTPException(403, "需要写入权限")

    return vehicle


@router.get("", response_model=list[VehicleOut])
async def list_vehicles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前用户的车辆列表（自己的 + 被分享的）"""
    vehicle_ids = await get_user_vehicle_ids(db, current_user.id)
    if not vehicle_ids:
        return []

    result = await db.execute(
        select(Vehicle).where(Vehicle.id.in_(vehicle_ids))
    )
    return [_with_photo_url(v) for v in result.scalars().all()]


@router.get("/owned", response_model=list[VehicleOut])
async def list_owned_vehicles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前用户拥有的车辆列表"""
    result = await db.execute(
        select(Vehicle).where(Vehicle.owner_id == current_user.id)
    )
    return [_with_photo_url(v) for v in result.scalars().all()]


@router.get("/shared", response_model=list[VehicleOut])
async def list_shared_vehicles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取被分享给当前用户的车辆列表"""
    vehicle_ids = await get_user_vehicle_ids(db, current_user.id)
    if not vehicle_ids:
        return []

    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id.in_(vehicle_ids),
            Vehicle.owner_id != current_user.id
        )
    )
    return [_with_photo_url(v) for v in result.scalars().all()]


@router.get("/{vehicle_id}", response_model=VehicleOut)
async def get_vehicle(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    vehicle = await check_vehicle_access(vehicle_id, db, current_user.id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在或无权访问")
    return _with_photo_url(vehicle)


@router.post("", response_model=VehicleOut)
async def create_vehicle(
    data: VehicleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    vehicle = Vehicle(**data.model_dump(), owner_id=current_user.id)
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return _with_photo_url(vehicle)


@router.put("/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(
    vehicle_id: int,
    data: VehicleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    vehicle = await check_vehicle_access(vehicle_id, db, current_user.id, require_write=True)
    if not vehicle:
        raise HTTPException(404, "车辆不存在或无权访问")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(vehicle, k, v)
    await db.commit()
    await db.refresh(vehicle)
    return _with_photo_url(vehicle)


@router.get("/{vehicle_id}/delete-check")
async def delete_check(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除前检查关联数据数量"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    if vehicle.owner_id != current_user.id:
        raise HTTPException(403, "只有车主可以删除车辆")

    record_count = (await db.execute(
        select(MaintenanceRecord).where(MaintenanceRecord.vehicle_id == vehicle_id)
    )).scalars().all()
    manual_count = (await db.execute(
        select(Manual).where(Manual.vehicle_id == vehicle_id)
    )).scalars().all()

    return {
        "record_count": len(record_count),
        "manual_count": len(manual_count),
    }


@router.delete("/{vehicle_id}")
async def delete_vehicle(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """只有车主可以删除车辆"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    if vehicle.owner_id != current_user.id:
        raise HTTPException(403, "只有车主可以删除车辆")
    if vehicle.photo_path:
        from app.storage import get_storage
        get_storage().delete(f"vehicles/{vehicle.id}/{vehicle.photo_path}")
    await db.delete(vehicle)
    await db.commit()
    return {"ok": True}


@router.post("/{vehicle_id}/photo", response_model=VehicleOut)
async def upload_vehicle_photo(
    vehicle_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    vehicle = await check_vehicle_access(vehicle_id, db, current_user.id, require_write=True)
    if not vehicle:
        raise HTTPException(404, "车辆不存在或无权访问")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "仅支持图片文件")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"

    from app.storage import get_storage
    storage = get_storage()
    content = await file.read()
    storage.save(f"vehicles/{vehicle_id}/{filename}", content, file.content_type or "image/jpeg")

    # 删除旧照片
    if vehicle.photo_path:
        storage.delete(f"vehicles/{vehicle_id}/{vehicle.photo_path}")

    vehicle.photo_path = filename
    await db.commit()
    await db.refresh(vehicle)
    return _with_photo_url(vehicle)


# ───────────────────────────────────────────────
# 车辆分享 API
# ───────────────────────────────────────────────
from app.schemas import VehicleShareCreate, VehicleShareOut
from app.models import VehicleShare
from app.schemas.schemas import UserResponse


@router.post("/{vehicle_id}/share", response_model=VehicleShareOut)
async def share_vehicle(
    vehicle_id: int,
    req: VehicleShareCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """分享车辆给其他用户（仅车主）"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    if vehicle.owner_id != current_user.id:
        raise HTTPException(403, "只有车主可以分享车辆")

    # 查找被分享的用户
    result = await db.execute(select(User).where(User.email == req.email))
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(404, "用户不存在")

    if target_user.id == current_user.id:
        raise HTTPException(400, "不能分享给自己")

    # 检查是否已分享
    result = await db.execute(
        select(VehicleShare).where(
            VehicleShare.vehicle_id == vehicle_id,
            VehicleShare.user_id == target_user.id
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        # 更新权限
        existing.permission = req.permission
        await db.commit()
        share = existing
    else:
        share = VehicleShare(
            vehicle_id=vehicle_id,
            user_id=target_user.id,
            permission=req.permission
        )
        db.add(share)
        await db.commit()
        await db.refresh(share)

    return VehicleShareOut(
        id=share.id,
        vehicle_id=share.vehicle_id,
        user_id=share.user_id,
        permission=share.permission,
        created_at=share.created_at.isoformat(),
        user=UserResponse(
            id=target_user.id,
            email=target_user.email,
            nickname=target_user.nickname,
            role=target_user.role
        )
    )


@router.get("/{vehicle_id}/shares")
async def list_vehicle_shares(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取车辆分享列表（仅车主）"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    if vehicle.owner_id != current_user.id:
        raise HTTPException(403, "只有车主可以查看分享列表")

    result = await db.execute(
        select(VehicleShare, User).join(User, VehicleShare.user_id == User.id)
        .where(VehicleShare.vehicle_id == vehicle_id)
    )
    shares = []
    for share, user in result.all():
        shares.append(VehicleShareOut(
            id=share.id,
            vehicle_id=share.vehicle_id,
            user_id=share.user_id,
            permission=share.permission,
            created_at=share.created_at.isoformat(),
            user=UserResponse(
                id=user.id,
                email=user.email,
                nickname=user.nickname,
                role=user.role
            )
        ))
    return shares


@router.delete("/{vehicle_id}/share/{share_id}")
async def delete_vehicle_share(
    vehicle_id: int,
    share_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """取消车辆分享（仅车主）"""
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    if vehicle.owner_id != current_user.id:
        raise HTTPException(403, "只有车主可以取消分享")

    share = await db.get(VehicleShare, share_id)
    if not share or share.vehicle_id != vehicle_id:
        raise HTTPException(404, "分享记录不存在")

    await db.delete(share)
    await db.commit()
    return {"ok": True}
