from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Evidence(BaseModel):
    label: str
    value: str
    source: str


class RiskItem(BaseModel):
    id: str
    material: str
    severity: Literal["high", "medium", "low"]
    title: str
    explanation: str
    evidence: list[Evidence]


class Recommendation(BaseModel):
    id: str
    title: str
    reason: str
    requires_human_validation: bool = True


class AgentMetrics(BaseModel):
    total_materials: int
    critical: int
    attention: int
    ok: int


class AgentAnalysis(BaseModel):
    analysis_id: str
    provider: str
    model: str | None = None
    is_demo: bool
    demo_notice: str
    summary: str
    metrics: AgentMetrics
    risks: list[RiskItem]
    recommendations: list[Recommendation]
    knowledge_sources: list[str] = Field(default_factory=list)


class AgentAnalysisRequest(BaseModel):
    metrics: AgentMetrics
    facts: dict[str, Any]
    objective: str = Field(
        default="Identificar riscos, explicar evidências e sugerir ações para validação humana.",
        min_length=5,
        max_length=2000,
    )


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


class ChatResponse(BaseModel):
    provider: str
    model: str | None = None
    is_demo: bool
    answer: str
    knowledge_sources: list[str] = Field(default_factory=list)


class FeedbackCreate(BaseModel):
    analysis_id: str
    recommendation_id: str
    decision: Literal["approved", "rejected"]
    comment: str | None = Field(default=None, max_length=4000)


class FeedbackResponse(BaseModel):
    id: int
    saved: bool = True


class AnalysisHistoryItem(BaseModel):
    id: int
    analysis_id: str
    provider: str
    model: str | None
    is_demo: bool
    summary: str
    created_at: datetime


class AnalysisHistoryDetail(AnalysisHistoryItem):
    payload: AgentAnalysis
