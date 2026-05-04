"""知识索引进度追踪模块

用内存字典记录每个 manual 的索引进度，供 SSE 端点读取并推送给前端。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class IndexProgress:
    stage: str = "pending"  # pending / extracting / chunking / embedding / done / error
    message: str = ""
    current: int = 0
    total: int = 0

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "message": self.message,
            "current": self.current,
            "total": self.total,
        }


# manual_id -> IndexProgress
_progress_store: dict[int, IndexProgress] = {}


def update_progress(
    manual_id: int,
    stage: str,
    message: str = "",
    current: int = 0,
    total: int = 0,
) -> None:
    _progress_store[manual_id] = IndexProgress(
        stage=stage, message=message, current=current, total=total,
    )


def get_progress(manual_id: int) -> Optional[IndexProgress]:
    return _progress_store.get(manual_id)


def remove_progress(manual_id: int) -> None:
    _progress_store.pop(manual_id, None)
