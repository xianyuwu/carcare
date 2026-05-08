"""
auth.py
认证服务：密码哈希 + JWT 生成/验证
"""

import os
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt

# JWT 配置
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 天
JWT_REFRESH_TOKEN_EXPIRE_DAYS = 30

# 简单的密码哈希（用于开发环境，生产环境建议用 bcrypt）
def hash_password(password: str) -> str:
    """哈希密码（使用 PBKDF2-SHA256）"""
    salt = secrets.token_hex(16)
    hash_obj = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}${hash_obj.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    try:
        salt, stored_hash = hashed_password.split('$')
        hash_obj = hashlib.pbkdf2_hmac('sha256', plain_password.encode(), salt.encode(), 100000)
        return hash_obj.hex() == stored_hash
    except Exception:
        return False


def create_access_token(user_id: int, email: str, role: str) -> str:
    """创建访问令牌"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "exp": expire,
        "type": "access"
    }
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    """创建刷新令牌"""
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {
        "sub": str(user_id),
        "exp": expire,
        "type": "refresh"
    }
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """解码并验证令牌"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def verify_access_token(token: str) -> Optional[dict]:
    """验证访问令牌"""
    payload = decode_token(token)
    if payload and payload.get("type") == "access":
        return payload
    return None


def verify_refresh_token(token: str) -> Optional[dict]:
    """验证刷新令牌"""
    payload = decode_token(token)
    if payload and payload.get("type") == "refresh":
        return payload
    return None
