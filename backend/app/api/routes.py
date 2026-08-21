from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.db.database import SessionLocal
from app.models.feedback import Feedback
from app.schemas.agent import (
    AgentAnalysis,
    AgentAnalysisRequest,
    AnalysisHistoryDetail,
    AnalysisHistoryItem,
    ChatRequest,
    ChatResponse,
    FeedbackCreate,
    FeedbackResponse,
)
from app.services.agent_service import (
    analyze_structured,
    answer_agent_question,
    answer_demo_question,
    build_demo_analysis,
    provider_status,
)
from app.services.excel_service import inspect_uploaded_file
from app.services.history_service import get_analysis_history, list_analysis_history
from app.services.knowledge_service import knowledge_status

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/agent/status")
def agent_status() -> dict:
    try:
        return provider_status()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/knowledge/status")
def rag_status() -> dict:
    return knowledge_status()


@router.get("/agent/demo", response_model=AgentAnalysis)
def agent_demo() -> AgentAnalysis:
    return build_demo_analysis()


@router.post("/agent/chat-demo", response_model=ChatResponse)
def agent_chat_demo(payload: ChatRequest) -> ChatResponse:
    return answer_demo_question(payload.question)


@router.post("/agent/chat", response_model=ChatResponse)
def agent_chat(payload: ChatRequest) -> ChatResponse:
    try:
        return answer_agent_question(payload.question)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Não foi possível consultar o provider de LLM: {exc}",
        ) from exc


@router.post("/agent/analyze", response_model=AgentAnalysis)
def agent_analyze(payload: AgentAnalysisRequest) -> AgentAnalysis:
    try:
        return analyze_structured(payload)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Não foi possível concluir a análise estruturada: {exc}",
        ) from exc


@router.get("/analyses/history", response_model=list[AnalysisHistoryItem])
def analyses_history(limit: int = Query(default=50, ge=1, le=200)) -> list[AnalysisHistoryItem]:
    return list_analysis_history(limit=limit)


@router.get("/analyses/{analysis_id}", response_model=AnalysisHistoryDetail)
def analysis_history_detail(analysis_id: str) -> AnalysisHistoryDetail:
    record = get_analysis_history(analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")
    return record


@router.post("/feedback", response_model=FeedbackResponse)
def save_feedback(payload: FeedbackCreate) -> FeedbackResponse:
    with SessionLocal() as session:
        feedback = Feedback(
            analysis_id=payload.analysis_id,
            recommendation_id=payload.recommendation_id,
            decision=payload.decision,
            comment=payload.comment,
        )
        session.add(feedback)
        session.commit()
        session.refresh(feedback)
        return FeedbackResponse(id=feedback.id)


@router.post("/files/inspect")
async def inspect_files(files: list[UploadFile] = File(...)) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Envie pelo menos um arquivo.")

    results = []
    for file in files:
        try:
            results.append(await inspect_uploaded_file(file))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Não foi possível ler o arquivo '{file.filename}'.",
            ) from exc

    return {
        "files_received": len(results),
        "files": results,
    }
