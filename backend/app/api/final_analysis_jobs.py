from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.dpp_final_analysis_progress_service import (
    get_final_analysis_job,
    start_final_analysis_job,
)

router = APIRouter(prefix="/api")


@router.post("/dpp/dashboard/final/jobs", status_code=202)
async def start_final_dpp_analysis_job(file: UploadFile = File(...)) -> dict:
    try:
        content = await file.read()
        if not content:
            raise ValueError("O arquivo do DPP final está vazio.")
        return start_final_analysis_job(filename=file.filename, content=content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível iniciar a análise do DPP Final: {exc}",
        ) from exc


@router.get("/dpp/dashboard/final/jobs/{job_id}")
def final_dpp_analysis_job(job_id: str) -> dict:
    job = get_final_analysis_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Análise do DPP Final não encontrada ou expirada.")
    return job
