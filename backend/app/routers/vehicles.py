from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pathlib import Path
import shutil
import uuid

from app.database import get_db
from app.models import Vehicle
from app.schemas import VehicleCreate, VehicleUpdate, VehicleOut

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])

PHOTO_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "vehicle_photos"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)


def _with_photo_url(vehicle: Vehicle) -> dict:
    data = {c.name: getattr(vehicle, c.name) for c in vehicle.__table__.columns}
    data["photo_url"] = f"/api/vehicle-photos/{vehicle.photo_path}" if vehicle.photo_path else None
    return data


@router.get("", response_model=list[VehicleOut])
async def list_vehicles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Vehicle))
    return [_with_photo_url(v) for v in result.scalars().all()]


@router.get("/{vehicle_id}", response_model=VehicleOut)
async def get_vehicle(vehicle_id: int, db: AsyncSession = Depends(get_db)):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    return _with_photo_url(vehicle)


@router.post("", response_model=VehicleOut)
async def create_vehicle(data: VehicleCreate, db: AsyncSession = Depends(get_db)):
    vehicle = Vehicle(**data.model_dump())
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return _with_photo_url(vehicle)


@router.put("/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(vehicle_id: int, data: VehicleUpdate, db: AsyncSession = Depends(get_db)):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(vehicle, k, v)
    await db.commit()
    await db.refresh(vehicle)
    return _with_photo_url(vehicle)


@router.delete("/{vehicle_id}")
async def delete_vehicle(vehicle_id: int, db: AsyncSession = Depends(get_db)):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")
    if vehicle.photo_path:
        old = PHOTO_DIR / vehicle.photo_path
        if old.exists():
            old.unlink()
    await db.delete(vehicle)
    await db.commit()
    return {"ok": True}


@router.post("/{vehicle_id}/photo", response_model=VehicleOut)
async def upload_vehicle_photo(vehicle_id: int, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "车辆不存在")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "仅支持图片文件")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"

    dest = PHOTO_DIR / filename
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # 删除旧照片
    if vehicle.photo_path:
        old = PHOTO_DIR / vehicle.photo_path
        if old.exists():
            old.unlink()

    vehicle.photo_path = filename
    await db.commit()
    await db.refresh(vehicle)
    return _with_photo_url(vehicle)
