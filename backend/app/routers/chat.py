from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas import ChatRequest, ChatFeedbackRequest

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("")
async def chat(req: ChatRequest):
    from app.services.rag.chain import chat_stream
    return StreamingResponse(
        chat_stream(req.vehicle_id, req.question, [m.model_dump() for m in req.history], req.search),
        media_type="text/event-stream",
    )


@router.post("/feedback")
async def submit_feedback(req: ChatFeedbackRequest):
    from app.database import async_session
    from app.models.models import ChatFeedback

    async with async_session() as db:
        fb = ChatFeedback(
            vehicle_id=req.vehicle_id,
            question=req.question,
            answer=req.answer,
            feedback=req.feedback,
        )
        db.add(fb)
        await db.commit()
    return {"ok": True}
