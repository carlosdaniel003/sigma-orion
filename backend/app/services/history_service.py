import json

from sqlalchemy import desc, select

from app.db.database import SessionLocal
from app.models.analysis_history import AnalysisHistory
from app.schemas.agent import AgentAnalysis, AnalysisHistoryDetail, AnalysisHistoryItem


def save_analysis_history(analysis: AgentAnalysis) -> AnalysisHistoryItem:
    with SessionLocal() as session:
        record = AnalysisHistory(
            analysis_id=analysis.analysis_id,
            provider=analysis.provider,
            model=analysis.model,
            is_demo=analysis.is_demo,
            summary=analysis.summary,
            payload_json=analysis.model_dump_json(),
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return _to_item(record)


def list_analysis_history(limit: int = 50) -> list[AnalysisHistoryItem]:
    safe_limit = min(max(limit, 1), 200)
    with SessionLocal() as session:
        records = session.scalars(
            select(AnalysisHistory)
            .order_by(desc(AnalysisHistory.created_at), desc(AnalysisHistory.id))
            .limit(safe_limit)
        ).all()
        return [_to_item(record) for record in records]


def get_analysis_history(analysis_id: str) -> AnalysisHistoryDetail | None:
    with SessionLocal() as session:
        record = session.scalar(
            select(AnalysisHistory).where(AnalysisHistory.analysis_id == analysis_id)
        )
        if record is None:
            return None

        payload = AgentAnalysis.model_validate(json.loads(record.payload_json))
        return AnalysisHistoryDetail(
            **_to_item(record).model_dump(),
            payload=payload,
        )


def _to_item(record: AnalysisHistory) -> AnalysisHistoryItem:
    return AnalysisHistoryItem(
        id=record.id,
        analysis_id=record.analysis_id,
        provider=record.provider,
        model=record.model,
        is_demo=record.is_demo,
        summary=record.summary,
        created_at=record.created_at,
    )
