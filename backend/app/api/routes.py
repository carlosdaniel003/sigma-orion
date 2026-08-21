from fastapi import APIRouter, File, HTTPException, UploadFile

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
        "message": "A LLM será conectada em uma etapa posterior.",
    }


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
