from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from app.database import Base


class User(Base):
    """用户表"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    nickname = Column(String(100), default="")
    role = Column(String(20), default="member")  # admin | member
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # 关联
    vehicles = relationship("Vehicle", back_populates="owner")
    vehicle_shares_received = relationship("VehicleShare", back_populates="user", cascade="all, delete-orphan")


class VehicleShare(Base):
    """车辆分享表 - 允许非车主用户访问车辆"""
    __tablename__ = "vehicle_shares"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    permission = Column(String(20), default="read")  # read | write
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    vehicle = relationship("Vehicle", back_populates="shares")
    user = relationship("User", back_populates="vehicle_shares_received")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    brand = Column(String(100), nullable=False)
    model = Column(String(100), nullable=False)
    year = Column(Integer)
    vin = Column(String(50), unique=True)
    license_plate = Column(String(20))
    purchase_date = Column(String(20))
    current_mileage = Column(Integer, default=0)
    photo_path = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="vehicles")
    records = relationship("MaintenanceRecord", back_populates="vehicle", cascade="all, delete-orphan")
    manuals = relationship("Manual", back_populates="vehicle", cascade="all, delete-orphan")
    shares = relationship("VehicleShare", back_populates="vehicle", cascade="all, delete-orphan")


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 记录创建者
    date = Column(String(20), nullable=False)
    mileage = Column(Integer)
    next_mileage = Column(Integer)
    next_date = Column(String(20))
    type = Column(String(100))
    total_amount = Column(Float, default=0)
    discount = Column(Float, default=0)
    paid_amount = Column(Float, default=0)
    station = Column(String(200))
    notes = Column(Text)
    ocr_raw = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    vehicle = relationship("Vehicle", back_populates="records")
    items = relationship("MaintenanceItem", back_populates="record", cascade="all, delete-orphan")


class MaintenanceItem(Base):
    __tablename__ = "maintenance_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    record_id = Column(Integer, ForeignKey("maintenance_records.id"), nullable=False)
    name = Column(String(200), nullable=False)
    parts_number = Column(String(200), default="")
    operation_type = Column(String(100), default="")
    quantity = Column(Float, default=1)
    unit_price = Column(Float, default=0)
    parts_cost = Column(Float, default=0)
    labor_cost = Column(Float, default=0)
    other_cost = Column(Float, default=0)
    subtotal = Column(Float, default=0)

    record = relationship("MaintenanceRecord", back_populates="items")


class ItemTemplate(Base):
    __tablename__ = "item_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True)
    parts_number = Column(String(200), default="")
    operation_type = Column(String(100), default="")
    reference_unit_price = Column(Float, default=0)
    reference_parts_cost = Column(Float, default=0)
    reference_labor_cost = Column(Float, default=0)
    category = Column(String(100), default="其他")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, default="")


class Manual(Base):
    __tablename__ = "manuals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 上传者
    filename = Column(String(500), nullable=False)
    file_path = Column(String(500), nullable=False)
    upload_date = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    page_count = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    status = Column(String(20), default="pending")
    source_type = Column(String(20), default="pdf")  # pdf / web
    source_url = Column(String(2000), default="")     # web 来源地址
    chunk_size = Column(Integer, default=500)
    chunk_overlap = Column(Integer, default=100)
    separators = Column(String(500), default="\\n\\n,\\n")  # 逗号分隔的分段标识符
    error_message = Column(Text, default="")  # 索引失败时的错误详情

    vehicle = relationship("Vehicle", back_populates="manuals")


class AIPrediction(Base):
    __tablename__ = "ai_predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    predicted_items = Column(JSON, default=list)
    reasoning = Column(Text, default="")
    reasoning_points = Column(JSON, default=list)
    estimated_cost = Column(Float, default=0)
    cost_reasoning = Column(Text, default="")
    cost_breakdown = Column(JSON, default=list)
    generated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ChatFeedback(Base):
    __tablename__ = "chat_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 反馈提交者
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    feedback = Column(String(10), nullable=False)  # like / dislike
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SearchUsage(Base):
    __tablename__ = "search_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    query = Column(Text, nullable=False)
    credits = Column(Integer, default=1)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
