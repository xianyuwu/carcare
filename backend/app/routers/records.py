from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import MaintenanceRecord, MaintenanceItem, Vehicle, VehicleShare, User
from app.schemas import MaintenanceRecordCreate, MaintenanceRecordOut
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/records", tags=["records"])


async def get_user_vehicle_ids(db: AsyncSession, user_id: int) -> list[int]:
    """获取用户有权访问的车辆 ID 列表"""
    result = await db.execute(select(Vehicle.id).where(Vehicle.owner_id == user_id))
    owned = set(row[0] for row in result.all())

    result = await db.execute(
        select(VehicleShare.vehicle_id).where(VehicleShare.user_id == user_id)
    )
    shared = set(row[0] for row in result.all())

    return list(owned | shared)


@router.get("")
async def list_records(
    vehicle_id: int | None = None,
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前用户的保养记录，支持按日期正反排序和分页"""
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    order = MaintenanceRecord.date.desc() if sort_order == "desc" else MaintenanceRecord.date.asc()

    if vehicle_id:
        if vehicle_id not in accessible_vehicles:
            raise HTTPException(403, "无权访问该车辆")
        where_clause = MaintenanceRecord.vehicle_id == vehicle_id
    else:
        if not accessible_vehicles:
            return {"items": [], "total": 0, "page": page, "page_size": page_size}
        where_clause = MaintenanceRecord.vehicle_id.in_(accessible_vehicles)

    # 查总数
    count_stmt = select(func.count(MaintenanceRecord.id)).where(where_clause)
    total = (await db.execute(count_stmt)).scalar() or 0

    # 分页查数据
    offset = (page - 1) * page_size
    stmt = select(MaintenanceRecord).options(
        selectinload(MaintenanceRecord.items)
    ).where(where_clause).order_by(order).offset(offset).limit(page_size)

    result = await db.execute(stmt)
    return {
        "items": result.scalars().all(),
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/check-duplicate")
async def check_duplicate(
    vehicle_id: int,
    date: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """检查同一车辆同日期是否已有保养记录"""
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权访问该车辆")

    stmt = select(MaintenanceRecord).where(
        MaintenanceRecord.vehicle_id == vehicle_id,
        MaintenanceRecord.date == date
    )
    result = await db.execute(stmt)
    existing = result.scalars().all()
    return {
        "exists": len(existing) > 0,
        "count": len(existing),
        "hint": f"该车辆在 {date} 已有 {len(existing)} 条记录" if existing else "",
    }


@router.get("/{record_id}", response_model=MaintenanceRecordOut)
async def get_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取单条保养记录"""
    stmt = select(MaintenanceRecord).options(
        selectinload(MaintenanceRecord.items)
    ).where(MaintenanceRecord.id == record_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(404, "记录不存在")

    # 检查是否有权限访问该车辆
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if record.vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权访问该记录")

    return record


@router.post("", response_model=MaintenanceRecordOut)
async def create_record(
    data: MaintenanceRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建保养记录"""
    # 检查是否有权限访问该车辆
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if data.vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权在该车辆下创建记录")

    items_data = data.items or []
    record = MaintenanceRecord(
        vehicle_id=data.vehicle_id,
        user_id=current_user.id,  # 记录创建者
        date=data.date,
        mileage=data.mileage,
        next_mileage=data.next_mileage,
        next_date=data.next_date,
        type=data.type,
        total_amount=data.total_amount,
        discount=data.discount,
        paid_amount=data.paid_amount,
        station=data.station,
        notes=data.notes,
        ocr_raw=data.ocr_raw,
    )
    db.add(record)
    await db.flush()

    for item in items_data:
        db.add(MaintenanceItem(
            record_id=record.id,
            name=item.name,
            parts_number=item.parts_number or "",
            operation_type=item.operation_type or "",
            quantity=item.quantity,
            unit_price=item.unit_price,
            parts_cost=item.parts_cost or 0,
            labor_cost=item.labor_cost or 0,
            other_cost=item.other_cost or 0,
            subtotal=item.subtotal,
        ))
    await db.commit()

    stmt = select(MaintenanceRecord).options(selectinload(MaintenanceRecord.items)).where(MaintenanceRecord.id == record.id)
    result = await db.execute(stmt)
    return result.scalar_one()


@router.put("/{record_id}", response_model=MaintenanceRecordOut)
async def update_record(
    record_id: int,
    data: MaintenanceRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新保养记录"""
    record = await db.get(MaintenanceRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")

    # 检查是否有权限访问该车辆
    accessible_vehicles = await get_user_vehicle_ids(db, current_user.id)
    if record.vehicle_id not in accessible_vehicles:
        raise HTTPException(403, "无权修改该记录")

    # 检查写入权限（车辆分享的 write 权限）
    vehicle = await db.get(Vehicle, record.vehicle_id)
    if vehicle.owner_id != current_user.id:
        result = await db.execute(
            select(VehicleShare).where(
                VehicleShare.vehicle_id == record.vehicle_id,
                VehicleShare.user_id == current_user.id
            )
        )
        share = result.scalar_one_or_none()
        if not share or share.permission != "write":
            raise HTTPException(403, "需要写入权限")

    record.vehicle_id = data.vehicle_id
    record.date = data.date
    record.mileage = data.mileage
    record.next_mileage = data.next_mileage
    record.next_date = data.next_date
    record.type = data.type
    record.total_amount = data.total_amount or 0
    record.discount = data.discount or 0
    record.paid_amount = data.paid_amount or 0
    record.station = data.station
    record.notes = data.notes
    if data.ocr_raw:
        record.ocr_raw = data.ocr_raw

    # 删除旧的 items，重新写入
    old_items = await db.execute(
        select(MaintenanceItem).where(MaintenanceItem.record_id == record_id)
    )
    for old in old_items.scalars().all():
        await db.delete(old)

    for item in data.items or []:
        db.add(MaintenanceItem(
            record_id=record.id,
            name=item.name,
            parts_number=item.parts_number or "",
            operation_type=item.operation_type or "",
            quantity=item.quantity,
            unit_price=item.unit_price,
            parts_cost=item.parts_cost or 0,
            labor_cost=item.labor_cost or 0,
            other_cost=item.other_cost or 0,
            subtotal=item.subtotal,
        ))

    await db.commit()
    stmt = select(MaintenanceRecord).options(selectinload(MaintenanceRecord.items)).where(MaintenanceRecord.id == record.id)
    result = await db.execute(stmt)
    return result.scalar_one()


@router.delete("/{record_id}")
async def delete_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除保养记录（仅车主或有 write 权限的用户）"""
    record = await db.get(MaintenanceRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")

    # 检查写入权限
    vehicle = await db.get(Vehicle, record.vehicle_id)
    if vehicle.owner_id != current_user.id:
        result = await db.execute(
            select(VehicleShare).where(
                VehicleShare.vehicle_id == record.vehicle_id,
                VehicleShare.user_id == current_user.id
            )
        )
        share = result.scalar_one_or_none()
        if not share or share.permission != "write":
            raise HTTPException(403, "需要写入权限")

    await db.delete(record)
    await db.commit()
    return {"ok": True}
