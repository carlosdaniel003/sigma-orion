from __future__ import annotations

import asyncio
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Lock
from time import monotonic
from uuid import uuid4

from starlette.datastructures import UploadFile

from app.services.dpp_monthly_service import generate_monthly_dpp

MAX_JOBS = 16
_JOBS: OrderedDict[str, dict] = OrderedDict()
_LOCK = Lock()
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="orion-dpp")


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


def _create_job(kind: str) -> str:
    job_id = uuid4().hex
    with _LOCK:
        _JOBS[job_id] = {
            "job_id": job_id,
            "kind": kind,
            "status": "queued",
            "progress": 0,
            "activity": "Aguardando processamento",
            "created_at": _now(),
            "finished_at": None,
            "error": None,
            "result": None,
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


def _complete_job(job_id: str, result: dict) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job["status"] = "completed"
        job["progress"] = 100
        job["activity"] = "Concluído"
        job["result"] = result
        job["error"] = None
        job["finished_at"] = _now()
        _JOBS.move_to_end(job_id)


def _fail_job(job_id: str, error: Exception) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job["status"] = "failed"
        job["activity"] = "Processamento interrompido"
        job["error"] = str(error) or error.__class__.__name__
        job["finished_at"] = _now()
        _JOBS.move_to_end(job_id)


def _upload(filename: str | None, content: bytes) -> UploadFile:
    return UploadFile(file=BytesIO(content), filename=filename or "arquivo.xlsx")


def _run_monthly_generation_job(job_id: str, payload: dict) -> None:
    def progress(value: int, activity: str) -> None:
        _update_job(job_id, value, activity)

    progress(3, "Preparando os arquivos para leitura")
    try:
        result = asyncio.run(
            generate_monthly_dpp(
                base_dpp=_upload(payload["base_dpp"][0], payload["base_dpp"][1]),
                wiu=_upload(payload["wiu"][0], payload["wiu"][1]),
                explosion=_upload(payload["explosion"][0], payload["explosion"][1]),
                stock=_upload(payload["stock"][0], payload["stock"][1]),
                pgd=_upload(payload["pgd"][0], payload["pgd"][1]),
                reference_month=payload["reference_month"],
                open_orders=(
                    _upload(payload["open_orders"][0], payload["open_orders"][1])
                    if payload.get("open_orders") is not None
                    else None
                ),
                progress=progress,
            )
        )
        _complete_job(job_id, result)
    except Exception as exc:  # erro é devolvido ao frontend pelo status do job
        _fail_job(job_id, exc)


def start_monthly_generation_job(*, payload: dict) -> dict:
    job_id = _create_job("monthly_dpp_generation")
    _EXECUTOR.submit(_run_monthly_generation_job, job_id, payload)
    return get_monthly_generation_job(job_id) or {"job_id": job_id, "status": "queued", "progress": 0}


def get_monthly_generation_job(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return None
        return _snapshot(job)
