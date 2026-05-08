"""
admin_users.py
管理员用户管理路由
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.models import User
from app.routers.auth import get_current_admin
from pydantic import BaseModel, EmailStr, Field

router = APIRouter(prefix="/api/admin/users", tags=["admin"])


class UserCreate(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)
    nickname: str = Field(default="", max_length=100)
    role: str = Field(default="member")  # admin | member


class UserUpdate(BaseModel):
    nickname: str | None = None
    role: str | None = None  # admin | member | pending
    is_active: bool | None = None


class UserResponse(BaseModel):
    id: int
    email: str
    nickname: str
    role: str
    is_active: bool
    created_at: str


class UserListResponse(BaseModel):
    total: int
    users: list[UserResponse]


@router.get("", response_model=UserListResponse)
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """获取用户列表"""
    # 统计总数
    count_result = await db.execute(select(func.count(User.id)))
    total = count_result.scalar()

    # 获取用户列表
    result = await db.execute(
        select(User).order_by(User.created_at.desc())
    )
    users = result.scalars().all()

    return UserListResponse(
        total=total,
        users=[
            UserResponse(
                id=u.id,
                email=u.email,
                nickname=u.nickname,
                role=u.role,
                is_active=u.is_active,
                created_at=u.created_at.isoformat()
            )
            for u in users
        ]
    )


@router.post("", response_model=UserResponse)
async def create_user(
    req: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """创建用户"""
    from app.services.auth import hash_password
    import re

    # 检查邮箱格式
    if not re.match(r"^[\w\.-]+@[\w\.-]+\.\w+$", req.email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    # 检查邮箱是否已存在
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    # 检查 role
    if req.role not in ("admin", "member", "pending"):
        raise HTTPException(status_code=400, detail="无效的角色")

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        nickname=req.nickname or "",
        role=req.role
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat()
    )


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    req: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """更新用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 不能修改自己
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="不能修改自己的账号")

    # 检查 role
    if req.role is not None and req.role not in ("admin", "member", "pending"):
        raise HTTPException(status_code=400, detail="无效的角色")

    if req.nickname is not None:
        user.nickname = req.nickname
    if req.role is not None:
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active

    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat()
    )


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """删除用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 不能删除自己
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")

    # 不能删除唯一的 admin
    if user.role == "admin":
        admin_count = await db.execute(
            select(func.count(User.id)).where(User.role == "admin")
        )
        if admin_count.scalar() <= 1:
            raise HTTPException(status_code=400, detail="不能删除唯一的管理员")

    await db.delete(user)
    await db.commit()

    return {"message": "用户已删除"}
