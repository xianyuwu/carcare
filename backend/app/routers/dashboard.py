from fastapi import APIRouter

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/prediction")
async def get_prediction(vehicle_id: int = 1):
    """获取缓存的 AI 预测结果"""
    from app.services.rag.alerts import get_cached_prediction
    result = await get_cached_prediction(vehicle_id)
    return result or {"predicted_items": [], "reasoning": "", "estimated_cost": 0, "cost_reasoning": "", "generated_at": None}


@router.post("/prediction/generate")
async def generate_prediction(vehicle_id: int = 1):
    """重新生成 AI 预测"""
    from app.services.rag.alerts import generate_and_cache_prediction
    return await generate_and_cache_prediction(vehicle_id)
