from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.final_analysis_jobs import router as final_analysis_jobs_router
from app.api.knowledge_routes import router as knowledge_router
from app.api.routes import router
from app.core.config import APP_NAME, APP_VERSION, FRONTEND_ORIGIN
from app.db.database import init_db
from app.services.dpp_scenario_service import restore_persisted_monthly_scenario
from app.services.knowledge_catalog_service import sync_knowledge_index


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    restore_persisted_monthly_scenario()
    sync_knowledge_index()
    yield


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(final_analysis_jobs_router)
app.include_router(knowledge_router)


@app.get("/")
def root() -> dict:
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "docs": "/docs",
    }
