from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Vehicle, VehicleShare, ChatFeedback, User
from app.schemas import ChatRequest, ChatFeedbackRequest
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


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


@router.post("")
async def chat(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """智能问答"""
    await check_vehicle_access(db, req.vehicle_id, current_user.id)

    from app.services.rag.chain import chat_stream
    return StreamingResponse(
        chat_stream(req.vehicle_id, req.question, [m.model_dump() for m in req.history], req.search),
        media_type="text/event-stream",
    )


@router.post("/feedback")
async def submit_feedback(
    req: ChatFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """提交聊天反馈"""
    await check_vehicle_access(db, req.vehicle_id, current_user.id)

    fb = ChatFeedback(
        vehicle_id=req.vehicle_id,
        user_id=current_user.id,
        question=req.question,
        answer=req.answer,
        feedback=req.feedback,
    )
    db.add(fb)
    await db.commit()
    return {"ok": True}
