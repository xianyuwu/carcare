"""存储后端抽象层：本地文件 / S3 兼容对象存储，部署时通过环境变量切换"""
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ── 后端接口 ────────────────────────────────────────────
class StorageBackend(ABC):
    """文件存储后端接口。所有路径操作用 key（如 'manuals/1/honda.pdf'）"""

    @abstractmethod
    def save(self, key: str, data: bytes, content_type: str = "") -> str:
        """保存二进制数据，返回 key 或 URL"""
        ...

    @abstractmethod
    def save_text(self, key: str, text: str) -> str:
        """保存文本数据"""
        ...

    @abstractmethod
    def read(self, key: str) -> Optional[bytes]:
        """读取二进制数据，不存在返回 None"""
        ...

    @abstractmethod
    def exists(self, key: str) -> bool:
        """检查 key 是否存在"""
        ...

    @abstractmethod
    def delete(self, key: str) -> None:
        """删除文件"""
        ...

    @abstractmethod
    def url(self, key: str) -> str:
        """返回可访问的 URL 或本地路径"""
        ...


# ── 本地文件实现 ─────────────────────────────────────────
class LocalStorage(StorageBackend):
    def __init__(self, base_dir: str | Path):
        self.base = Path(base_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # 防止路径遍历攻击
        safe = key.lstrip("/").replace("\\", "/")
        return self.base / safe

    def save(self, key: str, data: bytes, content_type: str = "") -> str:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        logger.debug("LocalStorage saved: %s (%d bytes)", key, len(data))
        return key

    def save_text(self, key: str, text: str) -> str:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        return key

    def read(self, key: str) -> Optional[bytes]:
        dest = self._path(key)
        if dest.exists():
            return dest.read_bytes()
        return None

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        dest = self._path(key)
        if dest.exists():
            dest.unlink()

    def url(self, key: str) -> str:
        return str(self._path(key))


# ── S3 兼容实现（MinIO / AWS S3 / 阿里云 OSS 等）──────────
class S3Storage(StorageBackend):
    def __init__(self, endpoint: str, access_key: str, secret_key: str,
                 bucket: str, region: str = "us-east-1", public_base: str = ""):
        import boto3
        self.bucket = bucket
        self.public_base = public_base.rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )
        # 确保 bucket 存在
        try:
            self._client.head_bucket(Bucket=bucket)
        except Exception:
            self._client.create_bucket(Bucket=bucket)

    def save(self, key: str, data: bytes, content_type: str = "") -> str:
        args = {"Bucket": self.bucket, "Key": key, "Body": data}
        if content_type:
            args["ContentType"] = content_type
        self._client.put_object(**args)
        return key

    def save_text(self, key: str, text: str) -> str:
        return self.save(key, text.encode("utf-8"), "text/plain; charset=utf-8")

    def read(self, key: str) -> Optional[bytes]:
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=key)
            return resp["Body"].read()
        except self._client.exceptions.NoSuchKey:
            return None
        except Exception as e:
            logger.warning("S3 read failed: %s", e)
            return None

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as e:
            logger.warning("S3 delete failed: %s", e)

    def url(self, key: str) -> str:
        if self.public_base:
            return f"{self.public_base}/{key}"
        return key


# ── 工厂函数 ─────────────────────────────────────────────
_storage: Optional[StorageBackend] = None


def get_storage() -> StorageBackend:
    """根据环境变量返回存储后端实例（单例）"""
    global _storage
    if _storage is not None:
        return _storage

    backend = os.getenv("STORAGE_BACKEND", "local")
    if backend == "s3":
        endpoint = os.getenv("S3_ENDPOINT", "")
        access_key = os.getenv("S3_ACCESS_KEY", "")
        secret_key = os.getenv("S3_SECRET_KEY", "")
        bucket = os.getenv("S3_BUCKET", "carcare")
        region = os.getenv("S3_REGION", "us-east-1")
        public_base = os.getenv("S3_PUBLIC_BASE", "")
        if not endpoint or not access_key or not secret_key:
            raise RuntimeError("STORAGE_BACKEND=s3 需设置 S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY")
        _storage = S3Storage(endpoint, access_key, secret_key, bucket, region, public_base)
        logger.info("存储后端: S3 (bucket=%s, endpoint=%s)", bucket, endpoint)
    else:
        base = os.getenv("STORAGE_DIR", str(Path(__file__).parent.parent / "data" / "files"))
        _storage = LocalStorage(base)
        logger.info("存储后端: 本地文件 (%s)", base)

    return _storage
