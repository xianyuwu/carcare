from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import ItemTemplate, MaintenanceItem
from app.schemas import ItemTemplateCreate, ItemTemplateUpdate, ItemTemplateOut, ItemTemplateMatchRequest

router = APIRouter(prefix="/api/item-templates", tags=["item-templates"])


@router.get("", response_model=list[ItemTemplateOut])
async def list_templates(
    category: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ItemTemplate).order_by(ItemTemplate.category, ItemTemplate.name)
    if category:
        stmt = stmt.where(ItemTemplate.category == category)
    if search:
        stmt = stmt.where(ItemTemplate.name.contains(search))
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{template_id}", response_model=ItemTemplateOut)
async def get_template(template_id: int, db: AsyncSession = Depends(get_db)):
    template = await db.get(ItemTemplate, template_id)
    if not template:
        raise HTTPException(404, "模板不存在")
    return template


@router.post("", response_model=ItemTemplateOut)
async def create_template(data: ItemTemplateCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(ItemTemplate).where(ItemTemplate.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"项目「{data.name}」已存在")
    template = ItemTemplate(**data.model_dump())
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.put("/{template_id}", response_model=ItemTemplateOut)
async def update_template(
    template_id: int,
    data: ItemTemplateUpdate,
    db: AsyncSession = Depends(get_db),
):
    template = await db.get(ItemTemplate, template_id)
    if not template:
        raise HTTPException(404, "模板不存在")
    if data.name and data.name != template.name:
        existing = await db.execute(select(ItemTemplate).where(ItemTemplate.name == data.name))
        if existing.scalar_one_or_none():
            raise HTTPException(400, f"项目「{data.name}」已存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(template, k, v)
    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/{template_id}")
async def delete_template(template_id: int, db: AsyncSession = Depends(get_db)):
    template = await db.get(ItemTemplate, template_id)
    if not template:
        raise HTTPException(404, "模板不存在")
    await db.delete(template)
    await db.commit()
    return {"ok": True}


@router.post("/import-from-records")
async def import_from_records(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func

    # 每个名称取最新一条记录的完整字段
    subq = (
        select(
            MaintenanceItem.name,
            MaintenanceItem.parts_number,
            MaintenanceItem.operation_type,
            MaintenanceItem.unit_price,
            MaintenanceItem.parts_cost,
            MaintenanceItem.labor_cost,
            func.row_number().over(
                partition_by=MaintenanceItem.name,
                order_by=MaintenanceItem.id.desc(),
            ).label("rn"),
        )
        .where(MaintenanceItem.name != "", MaintenanceItem.name.isnot(None))
        .subquery()
    )

    result = await db.execute(
        select(
            subq.c.name,
            subq.c.parts_number,
            subq.c.operation_type,
            subq.c.unit_price,
            subq.c.parts_cost,
            subq.c.labor_cost,
        )
        .where(subq.c.rn == 1)
        .order_by(subq.c.name)
    )
    latest_items = result.all()

    # 获取字典中已有项目（name -> template）
    existing_result = await db.execute(select(ItemTemplate))
    existing_map: dict[str, ItemTemplate] = {t.name: t for t in existing_result.scalars().all()}

    imported = []
    updated = []
    for row in latest_items:
        name = row.name.strip()
        if name in existing_map:
            # 已存在：补充空字段
            tmpl = existing_map[name]
            changed = False
            if not tmpl.parts_number and row.parts_number:
                tmpl.parts_number = row.parts_number
                changed = True
            if not tmpl.operation_type and row.operation_type:
                tmpl.operation_type = row.operation_type
                changed = True
            if not tmpl.reference_unit_price and row.unit_price:
                tmpl.reference_unit_price = row.unit_price
                changed = True
            if not tmpl.reference_parts_cost and row.parts_cost:
                tmpl.reference_parts_cost = row.parts_cost
                changed = True
            if not tmpl.reference_labor_cost and row.labor_cost:
                tmpl.reference_labor_cost = row.labor_cost
                changed = True
            if changed:
                updated.append(name)
            continue
        tmpl = ItemTemplate(
            name=name,
            parts_number=row.parts_number or "",
            operation_type=row.operation_type or "",
            reference_unit_price=row.unit_price or 0,
            reference_parts_cost=row.parts_cost or 0,
            reference_labor_cost=row.labor_cost or 0,
            category="其他",
        )
        db.add(tmpl)
        imported.append(name)

    await db.commit()

    return {
        "imported": len(imported),
        "updated": len(updated),
        "skipped": len(latest_items) - len(imported) - len(updated),
        "names": imported,
        "updated_names": updated,
    }


@router.post("/match", response_model=dict[str, list[ItemTemplateOut]])
async def match_templates(
    data: ItemTemplateMatchRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ItemTemplate))
    all_templates = result.scalars().all()
    matched: dict[str, list[ItemTemplateOut]] = {}
    for text in data.texts:
        t = text.strip()
        if not t:
            continue
        hits = [tmpl for tmpl in all_templates if tmpl.name in t or t in tmpl.name]
        if hits:
            matched[text] = hits
    return matched
