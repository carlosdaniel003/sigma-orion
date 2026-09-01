from fastapi import APIRouter, Query

from app.services.knowledge_catalog_service import list_catalog_entries, sync_knowledge_index
from app.services.rag_test_service import run_rag_battery


router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


@router.get("/catalog")
def knowledge_catalog(
    category: str = Query(default="operational", pattern="^(operational|deterministic)$"),
    q: str = Query(default="", max_length=300),
    limit: int = Query(default=250, ge=1, le=500),
) -> dict:
    return list_catalog_entries(category=category, query=q, limit=limit)


@router.post("/index/sync")
def sync_knowledge_catalog() -> dict:
    return sync_knowledge_index(force=True)


@router.post("/tests/run")
def execute_rag_tests() -> dict:
    return run_rag_battery()
