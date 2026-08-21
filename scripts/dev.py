from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
VITE_JS = FRONTEND_DIR / "node_modules" / "vite" / "bin" / "vite.js"


def main() -> int:
    python_exe = Path(sys.executable)
    node_exe = shutil.which("node")

    if node_exe is None:
        print("[ERRO] Node.js nao encontrado no PATH desta sessao.")
        print("Execute o launcher PowerShell: .\\scripts\\start-dev.ps1")
        return 1

    if not VITE_JS.exists():
        print("[ERRO] Dependencias do frontend nao encontradas.")
        print("Execute uma vez: . .\\scripts\\dev-env.ps1; cd frontend; npm install")
        return 1

    print("=" * 64)
    print("GEMEO DIGITAL - AMBIENTE DE DESENVOLVIMENTO")
    print("=" * 64)
    print(f"Python : {python_exe}")
    print(f"Node   : {node_exe}")
    print("Backend: http://localhost:8000")
    print("Docs   : http://localhost:8000/docs")
    print("Frontend: http://localhost:5173")
    print("Pressione Ctrl+C para encerrar tudo.")
    print("=" * 64)

    backend = subprocess.Popen(
        [
            str(python_exe),
            "-m",
            "uvicorn",
            "app.main:app",
            "--reload",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        cwd=BACKEND_DIR,
    )

    frontend = subprocess.Popen(
        [node_exe, str(VITE_JS)],
        cwd=FRONTEND_DIR,
    )

    processes = [backend, frontend]

    try:
        while True:
            for process in processes:
                return_code = process.poll()
                if return_code is not None:
                    print(f"\n[AVISO] Um dos processos encerrou com codigo {return_code}.")
                    return return_code
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nEncerrando frontend e backend...")
        return 0
    finally:
        for process in processes:
            _stop_process_tree(process)


def _stop_process_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return

    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return

    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
