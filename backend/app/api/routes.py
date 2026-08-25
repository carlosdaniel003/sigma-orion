from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

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
from app.services.dpp_consolidation_service import consolidate_dpp_sources
from app.services.dpp_dashboard_service import summarize_final_dpp
from app.services.dpp_monthly_service import generate_monthly_dpp
from app.services.dpp_scenario_service import get_latest_monthly_scenario, recalculate_monthly_scenario
from app.services.dpp_service import analyze_dpp_file
from app.services.dpp_test_service import test_monthly_dpp_reconstruction
from app.services.excel_service import inspect_uploaded_file
from app.services.history_service import get_analysis_history, list_analysis_history
from app.services.knowledge_service import knowledge_status

router = APIRouter(prefix="/api")


class DppMonthlyRecalculateRequest(BaseModel):
    scenario_id: str
    real_by_model: dict[str, float]


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


@router.post("/dpp/consolidate")
async def consolidate_dpp(
    wiu: UploadFile = File(...),
    explosion: UploadFile = File(...),
    stock: UploadFile = File(...),
    open_orders: UploadFile | None = File(default=None),
) -> dict:
    try:
        return await consolidate_dpp_sources(
            wiu=wiu,
            explosion=explosion,
            stock=stock,
            open_orders=open_orders,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível consolidar as fontes mensais do DPP: {exc}",
        ) from exc


@router.post("/dpp/monthly/generate")
async def generate_monthly_dpp_route(
    base_dpp: UploadFile = File(...),
    wiu: UploadFile = File(...),
    explosion: UploadFile = File(...),
    stock: UploadFile = File(...),
    pgd: UploadFile = File(...),
    reference_month: str = Form(...),
    open_orders: UploadFile | None = File(default=None),
) -> dict:
    try:
        return await generate_monthly_dpp(
            base_dpp=base_dpp,
            wiu=wiu,
            explosion=explosion,
            stock=stock,
            pgd=pgd,
            reference_month=reference_month,
            open_orders=open_orders,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível gerar o novo DPP mensal: {exc}",
        ) from exc


@router.get("/dpp/monthly/latest")
def latest_monthly_dpp_route() -> dict:
    scenario = get_latest_monthly_scenario()
    return {
        "available": scenario is not None,
        "scenario": scenario,
    }


@router.post("/dpp/dashboard/final")
async def final_dpp_dashboard_route(file: UploadFile = File(...)) -> dict:
    try:
        return await summarize_final_dpp(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível resumir o DPP final '{file.filename}': {exc}",
        ) from exc


@router.post("/dpp/monthly/recalculate")
def recalculate_monthly_dpp(payload: DppMonthlyRecalculateRequest) -> dict:
    try:
        return recalculate_monthly_scenario(
            scenario_id=payload.scenario_id,
            real_by_model=payload.real_by_model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dpp/monthly/test")
async def test_monthly_dpp_route(
    base_dpp: UploadFile = File(...),
    expected_dpp: UploadFile = File(...),
    wiu: UploadFile = File(...),
    explosion: UploadFile = File(...),
    stock: UploadFile = File(...),
    pgd: UploadFile = File(...),
    reference_month: str = Form(...),
    open_orders: UploadFile | None = File(default=None),
) -> dict:
    try:
        return await test_monthly_dpp_reconstruction(
            base_dpp=base_dpp,
            expected_dpp=expected_dpp,
            wiu=wiu,
            explosion=explosion,
            stock=stock,
            pgd=pgd,
            reference_month=reference_month,
            open_orders=open_orders,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível executar o teste de reconstrução do DPP: {exc}",
        ) from exc


@router.post("/dpp/analyze")
async def analyze_dpp(
    file: UploadFile = File(...),
    divergence_limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    try:
        return await analyze_dpp_file(file, divergence_limit=divergence_limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível analisar o DPP '{file.filename}': {exc}",
        ) from exc
