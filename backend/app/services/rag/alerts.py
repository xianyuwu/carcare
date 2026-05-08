"""AI 保养预测服务：项目预测 + 费用预测 + 缓存"""
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


async def _get_llm_config() -> dict:
    from app.services.rag.chain import _get_llm_config as _chain_config
    return await _chain_config()


async def _get_history(vehicle_id: int) -> list[dict]:
    """获取车辆各保养项目的最后执行记录"""
    from app.database import async_session
    from sqlalchemy import select, func
    from app.models import MaintenanceRecord, MaintenanceItem

    async with async_session() as db:
        stmt = (
            select(
                MaintenanceItem.name,
                func.max(MaintenanceRecord.mileage).label("last_mileage"),
                func.max(MaintenanceRecord.date).label("last_date"),
            )
            .join(MaintenanceRecord, MaintenanceItem.record_id == MaintenanceRecord.id)
            .where(MaintenanceRecord.vehicle_id == vehicle_id)
            .group_by(MaintenanceItem.name)
        )
        result = await db.execute(stmt)
        return [
            {"name": row.name, "last_mileage": row.last_mileage, "last_date": row.last_date}
            for row in result
        ]


async def _get_item_costs(vehicle_id: int) -> list[dict]:
    """获取历史保养项目费用数据"""
    from app.database import async_session
    from sqlalchemy import select
    from app.models import MaintenanceRecord, MaintenanceItem

    async with async_session() as db:
        stmt = (
            select(MaintenanceItem.name, MaintenanceItem.parts_cost, MaintenanceItem.labor_cost, MaintenanceItem.subtotal)
            .join(MaintenanceRecord, MaintenanceItem.record_id == MaintenanceRecord.id)
            .where(MaintenanceRecord.vehicle_id == vehicle_id)
        )
        result = await db.execute(stmt)
        rows = result.all()
        # 按项目名聚合平均费用
        cost_map: dict[str, list[dict]] = {}
        for r in rows:
            cost_map.setdefault(r.name, []).append({
                "parts_cost": r.parts_cost,
                "labor_cost": r.labor_cost,
                "subtotal": r.subtotal,
            })
        items = []
        for name, records in cost_map.items():
            avg_parts = sum(r["parts_cost"] for r in records) / len(records)
            avg_labor = sum(r["labor_cost"] for r in records) / len(records)
            avg_total = sum(r["subtotal"] for r in records) / len(records)
            items.append({
                "name": name,
                "avg_parts_cost": round(avg_parts, 2),
                "avg_labor_cost": round(avg_labor, 2),
                "avg_total": round(avg_total, 2),
                "count": len(records),
            })
        return items


def _clean_json_response(text: str) -> str:
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


async def _call_llm(config: dict, system_prompt: str, user_prompt: str) -> str:
    import httpx
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{config['api_url']}/chat/completions",
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
            },
            json={
                "model": config["model"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
        )
        return resp.json()["choices"][0]["message"]["content"].strip()


async def _retrieve_manual_context(vehicle_id: int, question: str, config: dict) -> str:
    from app.services.rag.chain import _retrieve_context
    return await _retrieve_context(vehicle_id, question, config)


async def _get_latest_mileage(vehicle_id: int) -> int | None:
    """从最近保养记录获取当前里程，fallback 到车辆表的 current_mileage"""
    from app.database import async_session
    from sqlalchemy import select
    from app.models import Vehicle, MaintenanceRecord

    async with async_session() as db:
        stmt = (
            select(MaintenanceRecord.mileage)
            .where(MaintenanceRecord.vehicle_id == vehicle_id, MaintenanceRecord.mileage != None)
            .order_by(MaintenanceRecord.date.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
        if row:
            return row
        vehicle = await db.get(Vehicle, vehicle_id)
        return vehicle.current_mileage if vehicle else None


async def predict_items(vehicle_id: int) -> dict:
    """预测下次保养项目和分析理由"""
    try:
        config = await _get_llm_config()
        if not config.get("api_key") or not config.get("api_url"):
            return {"predicted_items": [], "reasoning": "未配置 LLM"}

        history = await _get_history(vehicle_id)
        if not history:
            return {"predicted_items": [], "reasoning": "暂无保养记录"}

        current_mileage = await _get_latest_mileage(vehicle_id)

        history_text = "\n".join(
            f"- {h['name']}：上次 {h['last_mileage']}km，{h['last_date']}" for h in history
        )

        manual_ctx = await _retrieve_manual_context(vehicle_id, "保养周期 下次保养项目", config)

        question = (
            f"车辆保养历史：\n{history_text}\n\n"
            f"车辆当前里程：{current_mileage} km\n\n"
            f"保养手册参考：\n{manual_ctx}\n\n"
            "请根据保养手册的周期要求和车辆保养历史，预测下一次保养需要做的项目。"
            "以 JSON 格式返回："
            '{"predicted_items": ["项目1", "项目2"], "reasoning_points": [{"title": "要点标题", "detail": "具体说明"}]}'
            "reasoning_points 每个要点要有简短标题和具体说明，分3-5个要点。只返回 JSON。"
        )

        text = _clean_json_response(await _call_llm(config, "你是专业汽车保养顾问。严格返回 JSON。", question))
        data = json.loads(text)
        return {
            "predicted_items": data.get("predicted_items", []),
            "reasoning": data.get("reasoning", ""),
            "reasoning_points": data.get("reasoning_points", []),
        }
    except Exception as e:
        logger.warning(f"预测保养项目失败: {type(e).__name__}: {e}")
        return {"predicted_items": [], "reasoning": f"预测失败: {type(e).__name__}: {e}"}


async def predict_cost(vehicle_id: int, predicted_items: list[str]) -> dict:
    """根据预测项目和历史费用估算保养花费"""
    try:
        config = await _get_llm_config()
        if not config.get("api_key") or not config.get("api_url"):
            return {"estimated_cost": 0, "cost_reasoning": "未配置 LLM"}

        if not predicted_items:
            return {"estimated_cost": 0, "cost_reasoning": "无预测项目"}

        item_costs = await _get_item_costs(vehicle_id)

        # 有历史数据的项目
        known_items = [i for i in item_costs if i["name"] in predicted_items]
        known_text = "\n".join(
            f"- {i['name']}：历史均价 {i['avg_total']}元（配件 {i['avg_parts_cost']}元 + 工时 {i['avg_labor_cost']}元，共 {i['count']} 次记录）"
            for i in known_items
        )
        unknown = [p for p in predicted_items if not any(i["name"] == p for i in known_items)]

        question = (
            f"下次预计保养项目：{', '.join(predicted_items)}\n\n"
        )
        if known_text:
            question += f"部分项目历史费用：\n{known_text}\n\n"
        if unknown:
            question += f"无历史数据的项目：{', '.join(unknown)}\n\n"

        question += (
            "请根据以上信息预估下次保养的总费用。"
            "对有历史数据的项目直接用历史均价，无历史数据的根据市场行情估算。"
            "以 JSON 格式返回："
            '{"estimated_cost": 数字, "cost_breakdown": [{"item": "项目名", "cost": 数字, "source": "历史均价/市场估算", "note": "简短备注"}]}'
            "cost_breakdown 是每个项目的费用明细。只返回 JSON。"
        )

        text = _clean_json_response(
            await _call_llm(config, "你是专业汽车保养费用估算师。严格返回 JSON。", question)
        )
        data = json.loads(text)
        return {
            "estimated_cost": data.get("estimated_cost", 0),
            "cost_reasoning": data.get("cost_reasoning", ""),
            "cost_breakdown": data.get("cost_breakdown", []),
        }
    except Exception as e:
        logger.warning(f"预测保养费用失败: {type(e).__name__}: {e}")
        return {"estimated_cost": 0, "cost_reasoning": f"预测失败: {type(e).__name__}: {e}"}


async def get_cached_prediction(vehicle_id: int) -> dict | None:
    """从数据库读取缓存的预测结果"""
    from app.database import async_session
    from sqlalchemy import select
    from app.models import AIPrediction

    async with async_session() as db:
        stmt = (
            select(AIPrediction)
            .where(AIPrediction.vehicle_id == vehicle_id)
            .order_by(AIPrediction.generated_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        pred = result.scalar_one_or_none()
        if not pred:
            return None
        return {
            "predicted_items": pred.predicted_items or [],
            "reasoning": pred.reasoning or "",
            "reasoning_points": pred.reasoning_points or [],
            "estimated_cost": pred.estimated_cost or 0,
            "cost_reasoning": pred.cost_reasoning or "",
            "cost_breakdown": pred.cost_breakdown or [],
            "generated_at": pred.generated_at.isoformat() if pred.generated_at else None,
        }


async def generate_and_cache_prediction(vehicle_id: int) -> dict:
    """生成预测并缓存到数据库"""
    items_result = await predict_items(vehicle_id)
    cost_result = await predict_cost(vehicle_id, items_result.get("predicted_items", []))

    # 保存到数据库
    from app.database import async_session
    from app.models import AIPrediction

    prediction = AIPrediction(
        vehicle_id=vehicle_id,
        predicted_items=items_result.get("predicted_items", []),
        reasoning=items_result.get("reasoning", ""),
        reasoning_points=items_result.get("reasoning_points", []),
        estimated_cost=cost_result.get("estimated_cost", 0),
        cost_reasoning=cost_result.get("cost_reasoning", ""),
        cost_breakdown=cost_result.get("cost_breakdown", []),
    )
    async with async_session() as db:
        db.add(prediction)
        await db.commit()
        await db.refresh(prediction)

    return {
        "predicted_items": prediction.predicted_items or [],
        "reasoning": prediction.reasoning or "",
        "reasoning_points": prediction.reasoning_points or [],
        "estimated_cost": prediction.estimated_cost or 0,
        "cost_reasoning": prediction.cost_reasoning or "",
        "cost_breakdown": prediction.cost_breakdown or [],
        "generated_at": prediction.generated_at.isoformat() if prediction.generated_at else None,
    }
