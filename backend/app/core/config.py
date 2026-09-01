from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[3]
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
KNOWLEDGE_DIR = BASE_DIR / "knowledge"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

APP_NAME = "ORION API"
APP_VERSION = "0.3.0"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(DATA_DIR / 'orion.db').as_posix()}",
)

# LLM_PROVIDER continua em mock por padrão para o ORION permanecer funcional
# mesmo quando o servidor local não estiver iniciado. Para usar o Qwen local,
# configure LLM_PROVIDER=llama-cpp no .env ou na sessão que inicia o backend.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mock")
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "180"))

LOCAL_LLM_BASE_URL = os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:8080/v1")
LOCAL_LLM_HEALTH_URL = os.getenv("LOCAL_LLM_HEALTH_URL", "http://127.0.0.1:8080/health")
LOCAL_LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "orion-qwen")
LOCAL_LLM_MAX_TOKENS = max(64, int(os.getenv("LOCAL_LLM_MAX_TOKENS", "800")))
LOCAL_LLM_TEMPERATURE = float(os.getenv("LOCAL_LLM_TEMPERATURE", "0.1"))
LOCAL_LLM_HEALTH_TIMEOUT_SECONDS = float(os.getenv("LOCAL_LLM_HEALTH_TIMEOUT_SECONDS", "1.0"))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b")

RAG_TOP_K = max(1, int(os.getenv("RAG_TOP_K", "5")))
