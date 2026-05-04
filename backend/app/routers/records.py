from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import MaintenanceRecord, MaintenanceItem
from app.schemas import MaintenanceRecordCreate, MaintenanceRecordOut

router = APIRouter(prefix="/api/records", tags=["records"])


@router.get("", response_model=list[MaintenanceRecordOut])
async def list_records(vehicle_id: int | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(MaintenanceRecord).options(selectinload(MaintenanceRecord.items)).order_by(MaintenanceRecord.date.desc())
    if vehicle_id:
        stmt = stmt.where(MaintenanceRecord.vehicle_id == vehicle_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{record_id}", response_model=MaintenanceRecordOut)
async def get_record(record_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(MaintenanceRecord).options(selectinload(MaintenanceRecord.items)).where(MaintenanceRecord.id == record_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "记录不存在")
    return record


@router.post("", response_model=MaintenanceRecordOut)
async def create_record(data: MaintenanceRecordCreate, db: AsyncSession = Depends(get_db)):
    items_data = data.items or []
    record = MaintenanceRecord(
        vehicle_id=data.vehicle_id,
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
async def update_record(record_id: int, data: MaintenanceRecordCreate, db: AsyncSession = Depends(get_db)):
    record = await db.get(MaintenanceRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")

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
async def delete_record(record_id: int, db: AsyncSession = Depends(get_db)):
    record = await db.get(MaintenanceRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")
    await db.delete(record)
    await db.commit()
    return {"ok": True}
