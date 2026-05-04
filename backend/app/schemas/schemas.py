from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# --- Vehicle ---
class VehicleCreate(BaseModel):
    brand: str
    model: str
    year: Optional[int] = None
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    purchase_date: Optional[str] = None
    current_mileage: Optional[int] = 0


class VehicleUpdate(BaseModel):
    brand: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    purchase_date: Optional[str] = None
    current_mileage: Optional[int] = None


class VehicleOut(BaseModel):
    id: int
    brand: str
    model: str
    year: Optional[int]
    vin: Optional[str]
    license_plate: Optional[str]
    purchase_date: Optional[str]
    current_mileage: Optional[int]
    photo_path: Optional[str] = None
    photo_url: Optional[str] = None
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


# --- MaintenanceItem ---
class MaintenanceItemCreate(BaseModel):
    name: str
    parts_number: Optional[str] = ""
    operation_type: Optional[str] = ""
    quantity: Optional[float] = 1
    unit_price: Optional[float] = 0
    parts_cost: Optional[float] = 0
    labor_cost: Optional[float] = 0
    other_cost: Optional[float] = 0
    subtotal: Optional[float] = 0


class MaintenanceItemOut(BaseModel):
    id: int
    name: str
    parts_number: str
    operation_type: str
    quantity: float
    unit_price: float
    parts_cost: float
    labor_cost: float
    other_cost: float
    subtotal: float

    model_config = {"from_attributes": True}


# --- MaintenanceRecord ---
class MaintenanceRecordCreate(BaseModel):
    vehicle_id: int
    date: str
    mileage: Optional[int] = None
    next_mileage: Optional[int] = None
    next_date: Optional[str] = None
    type: Optional[str] = None
    total_amount: Optional[float] = 0
    discount: Optional[float] = 0
    paid_amount: Optional[float] = 0
    station: Optional[str] = None
    notes: Optional[str] = None
    ocr_raw: Optional[str] = None
    items: Optional[list[MaintenanceItemCreate]] = []


class MaintenanceRecordOut(BaseModel):
    id: int
    vehicle_id: int
    date: str
    mileage: Optional[int]
    next_mileage: Optional[int]
    next_date: Optional[str]
    type: Optional[str]
    total_amount: float
    discount: float
    paid_amount: float
    station: Optional[str]
    notes: Optional[str]
    created_at: Optional[datetime]
    items: list[MaintenanceItemOut] = []

    model_config = {"from_attributes": True}


# --- Settings ---
class SettingItem(BaseModel):
    key: str
    value: str


class SettingsUpdate(BaseModel):
    settings: list[SettingItem]


# --- OCR ---
class OCRBlock(BaseModel):
    """OCR 识别的文本块（含坐标）"""
    text: str
    polygon: list[dict[str, float]]  # [{X, Y}, {X, Y}, {X, Y}, {X, Y}] 四角坐标


class OCRResult(BaseModel):
    raw_text: str
    fields: dict[str, str]
    items: list[str]
    blocks: list[OCRBlock] = []          # 全文识别块（含坐标）
    field_coords: dict[str, list[dict[str, float]]] = {}  # 字段名 → 四角坐标
    image_base64: str = ""               # 原始图片 base64（用于前端标注）
    error: str = ""


# --- Manual ---
class ManualOut(BaseModel):
    id: int
    vehicle_id: int
    filename: str
    upload_date: Optional[datetime]
    page_count: int
    chunk_count: int
    status: str
    source_type: str = "pdf"
    source_url: str = ""
    chunk_size: int = 500
    chunk_overlap: int = 100
    separators: str = "\\n\\n,\\n"
    error_message: str = ""

    model_config = {"from_attributes": True}


class ManualUpdate(BaseModel):
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    separators: Optional[str] = None
    reindex: bool = False  # 更新后是否自动重新索引


class ChunkPreview(BaseModel):
    """单个分块的预览结果"""
    index: int
    text: str
    char_count: int
    has_table: bool


class ChunkPreviewResult(BaseModel):
    """分块预览 API 的返回结果"""
    total_chunks: int
    chunks: list[ChunkPreview]


# --- Chat ---
class ChatMessage(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str

class ChatRequest(BaseModel):
    vehicle_id: int
    question: str
    history: list[ChatMessage] = []
    search: bool | None = None


class ChatFeedbackRequest(BaseModel):
    vehicle_id: int
    question: str
    answer: str
    feedback: str  # "like" or "dislike"


# --- ItemTemplate ---
class ItemTemplateCreate(BaseModel):
    name: str
    parts_number: Optional[str] = ""
    operation_type: Optional[str] = ""
    reference_unit_price: Optional[float] = 0
    reference_parts_cost: Optional[float] = 0
    reference_labor_cost: Optional[float] = 0
    category: Optional[str] = "其他"
    notes: Optional[str] = ""


class ItemTemplateUpdate(BaseModel):
    name: Optional[str] = None
    parts_number: Optional[str] = None
    operation_type: Optional[str] = None
    reference_unit_price: Optional[float] = None
    reference_parts_cost: Optional[float] = None
    reference_labor_cost: Optional[float] = None
    category: Optional[str] = None
    notes: Optional[str] = None


class ItemTemplateOut(BaseModel):
    id: int
    name: str
    parts_number: str
    operation_type: str
    reference_unit_price: float
    reference_parts_cost: float
    reference_labor_cost: float
    category: str
    notes: str
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ItemTemplateMatchRequest(BaseModel):
    texts: list[str]
