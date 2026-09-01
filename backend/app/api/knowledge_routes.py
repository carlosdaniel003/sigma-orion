from fastapi import APIRouter, HTTPException, Query

from app.schemas.agent import ChatRequest, ChatResponse
from app.services.agent_service import answer_agent_question
from app.services.knowledge_catalog_service import list_catalog_entries, sync_knowledge_index
from app.services.knowledge_inventory_service import build_knowledge_inventory
from app.services.rag_test_service import run_rag_battery


router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


@router.get("/catalog")
def knowledge_catalog(
    category: str = Query(default="operational", pattern="^(operational|deterministic)$"),
    q: str = Query(default="", max_length=300),
    limit: int = Query(default=2000, ge=1, le=2000),
) -> dict:
    return list_catalog_entries(category=category, query=q, limit=limit)


@router.get("/inventory")
def knowledge_inventory() -> dict:
    return build_knowledge_inventory()


@router.post("/index/sync")
def sync_knowledge_catalog() -> dict:
    return sync_knowledge_index(force=True)


@router.post("/chat", response_model=ChatResponse)
def database_rag_chat(payload: ChatRequest) -> ChatResponse:
    try:
        return answer_agent_question(payload.question, workspace=payload.workspace)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Não foi possível consultar o banco RAG sincronizado: {exc}",
        ) from exc


@router.post("/tests/run")
def execute_rag_tests() -> dict:
    return run_rag_battery()
