from fastapi import APIRouter, File, HTTPException, UploadFile

from app.db.database import SessionLocal
from app.models.feedback import Feedback
from app.schemas.agent import (
    AgentAnalysis,
    ChatRequest,
    ChatResponse,
    FeedbackCreate,
    FeedbackResponse,
)
from app.services.agent_service import answer_demo_question, build_demo_analysis
from app.services.excel_service import inspect_uploaded_file

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/agent/status")
def agent_status() -> dict:
    return {
        "provider": "mock",
        "configured": False,
        "mode": "demo",
        "message": "A interface do agente está pronta; a LLM real será conectada posteriormente.",
    }


@router.get("/agent/demo", response_model=AgentAnalysis)
def agent_demo() -> AgentAnalysis:
    return build_demo_analysis()


@router.post("/agent/chat-demo", response_model=ChatResponse)
def agent_chat_demo(payload: ChatRequest) -> ChatResponse:
    return answer_demo_question(payload.question)


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
