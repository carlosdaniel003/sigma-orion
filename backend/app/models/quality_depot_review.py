"""Append-only confirmation history for Quality investigation Q239/Q273."""
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class QualityDepotReview(Base):
    __tablename__ = "quality_depot_reviews"
    __table_args__ = (
        Index("ix_quality_review_candidate", "scenario_id", "stock_sha256", "candidate_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    stock_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    candidate_id: Mapped[str] = mapped_column(String(64), nullable=False)
    material: Mapped[str] = mapped_column(String(100), nullable=False)
    depot: Mapped[str] = mapped_column(String(12), nullable=False)
    center: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    accounting: Mapped[str] = mapped_column(String(24), nullable=False)
    confirmed_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    justification: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
