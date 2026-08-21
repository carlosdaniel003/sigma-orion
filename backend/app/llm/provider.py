from abc import ABC, abstractmethod

import httpx

from app.core.config import (
    GROQ_API_KEY,
    GROQ_BASE_URL,
    GROQ_MODEL,
    LLM_PROVIDER,
    LLM_TIMEOUT_SECONDS,
)


class LLMProvider(ABC):
    name: str
    model: str

    @property
    @abstractmethod
    def configured(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def complete(self, system_prompt: str, user_prompt: str) -> str:
        raise NotImplementedError

    def status(self) -> dict:
        return {
            "provider": self.name,
            "model": self.model,
            "configured": self.configured,
        }


class MockProvider(LLMProvider):
    name = "mock"
    model = "mock-local"

    @property
    def configured(self) -> bool:
        return True

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        del system_prompt
        return (
            "O provider mock está ativo. A arquitetura de LLM, RAG e guardrails já foi "
            "executada, mas nenhuma chamada externa foi realizada. Pergunta recebida: "
            f"{user_prompt[:500]}"
        )


class GroqProvider(LLMProvider):
    name = "groq"
    model = GROQ_MODEL

    @property
    def configured(self) -> bool:
        return bool(GROQ_API_KEY)

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        if not GROQ_API_KEY:
            raise RuntimeError(
                "GROQ_API_KEY não configurada. Mantenha LLM_PROVIDER=mock ou defina a chave no .env."
            )

        endpoint = f"{GROQ_BASE_URL.rstrip('/')}/chat/completions"
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=LLM_TIMEOUT_SECONDS) as client:
            response = client.post(endpoint, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Resposta inesperada da API da Groq.") from exc


def get_llm_provider() -> LLMProvider:
    provider_name = LLM_PROVIDER.strip().lower()

    if provider_name == "groq":
        return GroqProvider()
    if provider_name == "mock":
        return MockProvider()

    raise RuntimeError(
        f"LLM_PROVIDER '{LLM_PROVIDER}' não suportado. Use 'mock' ou 'groq'."
    )
