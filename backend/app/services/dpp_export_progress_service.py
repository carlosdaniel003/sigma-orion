from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import monotonic
from uuid import uuid4

from app.services.dpp_canonical_export_service import export_monthly_scenario_excel
from app.services.dpp_export_postprocess_service import enforce_final_dpp_header_and_gap
from app.services.dpp_scenario_service import get_monthly_scenario

MAX_JOBS = 6
_JOBS: OrderedDict[str, dict] = OrderedDict()
_LOCK = Lock()
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="orion-export")


def _now() -> float:
    return monotonic()


def _trim_jobs() -> None:
    while len(_JOBS) > MAX_JOBS:
        _JOBS.popitem(last=False)


def _snapshot(job: dict) -> dict:
    created_at = float(job.get("created_at") or _now())
    finished_at = job.get("finished_at")
    end = float(finished_at) if finished_at is not None else _now()
    return {
        "job_id": job["job_id"],
        "kind": job["kind"],
        "status": job["status"],
        "progress": job["progress"],
        "activity": job["activity"],
        "elapsed_seconds": max(end - created_at, 0.0),
        "error": job.get("error"),
        "result": job.get("result") if job["status"] == "completed" else None,
    }


def _create_job() -> str:
    job_id = uuid4().hex
    with _LOCK:
        _JOBS[job_id] = {
            "job_id": job_id,
            "kind": "monthly_dpp_export",
            "status": "queued",
            "progress": 0,
            "activity": "Aguardando geração do Excel",
            "created_at": _now(),
            "finished_at": None,
            "error": None,
            "result": None,
            "content": None,
            "filename": None,
            "media_type": None,
        }
        _JOBS.move_to_end(job_id)
        _trim_jobs()
    return job_id


def _update_job(job_id: str, progress: int, activity: str) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None or job["status"] in {"completed", "failed"}:
            return
        job["status"] = "running"
        job["progress"] = max(int(job.get("progress", 0)), min(max(int(progress), 0), 99))
        job["activity"] = activity
        _JOBS.move_to_end(job_id)


def _complete_job(job_id: str, content: bytes, filename: str, media_type: str) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job["status"] = "completed"
        job["progress"] = 100
        job["activity"] = "Excel pronto para download"
        job["content"] = content
        job["filename"] = filename
        job["media_type"] = media_type
        job["result"] = {
            "filename": filename,
            "media_type": media_type,
            "size_bytes": len(content),
        }
        job["error"] = None
        job["finished_at"] = _now()
        _JOBS.move_to_end(job_id)


def _fail_job(job_id: str, error: Exception) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job["status"] = "failed"
        job["activity"] = "Geração do Excel interrompida"
        job["error"] = str(error) or error.__class__.__name__
        job["finished_at"] = _now()
        _JOBS.move_to_end(job_id)


def _run_export_job(job_id: str, payload: dict) -> None:
    def progress(value: int, activity: str) -> None:
        _update_job(job_id, value, activity)

    try:
        content, filename, media_type = export_monthly_scenario_excel(
            scenario_id=payload["scenario_id"],
            template_content=payload["base_dpp"][1],
            template_filename=payload["base_dpp"][0] or "dpp.xlsx",
            progress=progress,
        )

        # A decisão final sobre a fórmula REAL − KIT deve usar o próprio XLSX já
        # serializado. Isso evita depender de metadados intermediários do cenário e
        # garante a mesma estrutura do DPP Final: linha abaixo de REAL = REAL - KIT.
        scenario = get_monthly_scenario(payload["scenario_id"])
        if scenario is None:
            raise ValueError("Cenário ORION não encontrado durante a validação final do Excel.")
        progress(99, "Validando cabeçalho e diferença REAL × KIT")
        content = enforce_final_dpp_header_and_gap(
            content,
            scenario.get("reference_month") or "",
        )

        _complete_job(job_id, content, filename, media_type)
    except Exception as exc:
        _fail_job(job_id, exc)


def start_export_job(*, scenario_id: str, base_filename: str | None, base_content: bytes) -> dict:
    job_id = _create_job()
    _EXECUTOR.submit(
        _run_export_job,
        job_id,
        {
            "scenario_id": scenario_id,
            "base_dpp": (base_filename, base_content),
        },
    )
    return get_export_job(job_id) or {"job_id": job_id, "status": "queued", "progress": 0}


def get_export_job(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return None
        return _snapshot(job)


def get_export_download(job_id: str) -> tuple[bytes, str, str] | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None or job["status"] != "completed" or job.get("content") is None:
            return None
        return job["content"], job["filename"], job["media_type"]
