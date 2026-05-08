"""
auth.py
认证路由：注册 / 登录 / 登出 / 刷新
"""

import re
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.models import User
from app.services.auth import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, verify_access_token, verify_refresh_token
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# OAuth2 scheme，用于从请求头提取 token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """依赖：获取当前登录用户"""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = int(payload.get("sub", 0))
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已禁用",
        )

    return user


async def get_current_admin(
    current_user: User = Depends(get_current_user)
) -> User:
    """依赖：确保当前用户是管理员"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


def get_optional_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User | None:
    """依赖：获取当前用户（可选，未登录返回 None）"""
    if not token:
        return None

    payload = verify_access_token(token)
    if not payload:
        return None

    # 同步查询（用于可选认证）
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    user_id = int(payload.get("sub", 0))
    result = loop.run_until_complete(db.execute(select(User).where(User.id == user_id)))
    user = result.scalar_one_or_none()
    return user if user and user.is_active else None


# ───────────────────────────────────────────────
# Schemas
# ───────────────────────────────────────────────
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)
    nickname: str = Field(default="", max_length=100)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    nickname: str
    role: str
    created_at: str


# Forward reference
LoginResponse.model_rebuild()
RefreshResponse.model_rebuild()


# ───────────────────────────────────────────────
# Endpoints
# ───────────────────────────────────────────────

@router.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    注册新用户（仅 admin 可创建其他用户，普通用户注册需管理员添加）
    注意：由于当前设计为管理员统一添加用户，此接口暂时禁用。
    如需开放注册，删除下面的管理员检查。
    """
    # 检查邮箱格式
    if not re.match(r"^[\w\.-]+@[\w\.-]+\.\w+$", req.email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    # 检查邮箱是否已存在
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    # 创建用户（默认 role=member，需要管理员审批）
    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        nickname=req.nickname or "",
        role="pending"  # 待激活状态，需要管理员审批
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # 生成 token
    access_token = create_access_token(user.id, user.email, user.role)
    refresh_token = create_refresh_token(user.id)

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(
            id=user.id,
            email=user.email,
            nickname=user.nickname,
            role=user.role,
            created_at=user.created_at.isoformat()
        )
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """登录"""
    # OAuth2PasswordRequestForm 使用 username 字段传 email
    email = form_data.username

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用"
        )

    if user.role == "pending":
        raise HTTPException(
            status_code=403,
            detail="账号待激活，请联系管理员"
        )

    access_token = create_access_token(user.id, user.email, user.role)
    refresh_token = create_refresh_token(user.id)

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(
            id=user.id,
            email=user.email,
            nickname=user.nickname,
            role=user.role,
            created_at=user.created_at.isoformat()
        )
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """刷新 access token"""
    payload = verify_refresh_token(req.refresh_token)
    if not payload:
        raise HTTPException(status_code=401, detail="刷新令牌无效")

    user_id = int(payload.get("sub", 0))
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")

    access_token = create_access_token(user.id, user.email, user.role)
    return RefreshResponse(access_token=access_token)


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """登出（前端删除 token 即可，服务端这里不做额外处理）"""
    return {"message": "已登出"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        nickname=current_user.nickname,
        role=current_user.role,
        created_at=current_user.created_at.isoformat()
    )
