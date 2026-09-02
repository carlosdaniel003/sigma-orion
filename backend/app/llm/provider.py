from __future__ import annotations

from abc import ABC, abstractmethod

import httpx

from app.core.config import (
    GROQ_API_KEY,
    GROQ_BASE_URL,
    GROQ_MODEL,
    LLM_PROVIDER,
    LLM_TIMEOUT_SECONDS,
    LOCAL_LLM_BASE_URL,
    LOCAL_LLM_HEALTH_TIMEOUT_SECONDS,
    LOCAL_LLM_HEALTH_URL,
    LOCAL_LLM_MAX_TOKENS,
    LOCAL_LLM_MODEL,
    LOCAL_LLM_TEMPERATURE,
)


class LLMProvider(ABC):
    name: str
    model: str

    @property
    @abstractmethod
    def configured(self) -> bool:
        raise NotImplementedError

    def is_available(self) -> bool:
        return self.configured

    @abstractmethod
    def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        raise NotImplementedError

    def status(self) -> dict:
        return {
            "provider": self.name,
            "model": self.model,
            "configured": self.configured,
            "available": self.is_available(),
        }


class MockProvider(LLMProvider):
    name = "mock"
    model = "mock-local"

    @property
    def configured(self) -> bool:
        return True

    def is_available(self) -> bool:
        return False

    def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        del system_prompt, max_tokens, temperature
        return (
            "O provider mock está ativo. A arquitetura de LLM, RAG e guardrails já foi "
            "executada, mas nenhuma chamada externa foi realizada. Pergunta recebida: "
            f"{user_prompt[:500]}"
        )


class LlamaCppProvider(LLMProvider):
    """Provider local para o llama-server do llama.cpp.

    O servidor expõe uma API compatível com OpenAI em localhost. Nenhuma chave
    é necessária e nenhuma evidência precisa sair da máquina.
    """

    name = "llama.cpp"
    model = LOCAL_LLM_MODEL

    @property
    def configured(self) -> bool:
        return bool(LOCAL_LLM_BASE_URL and self.model)

    def is_available(self) -> bool:
        if not self.configured:
            return False
        try:
            with httpx.Client(timeout=LOCAL_LLM_HEALTH_TIMEOUT_SECONDS) as client:
                response = client.get(LOCAL_LLM_HEALTH_URL)
            return response.status_code < 500
        except (httpx.HTTPError, OSError):
            return False

    def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        if not self.configured:
            raise RuntimeError("Provider llama.cpp local não configurado.")

        endpoint = f"{LOCAL_LLM_BASE_URL.rstrip('/')}/chat/completions"
        payload = {
            "model": self.model,
            "stream": False,
            "temperature": LOCAL_LLM_TEMPERATURE if temperature is None else temperature,
            "max_tokens": LOCAL_LLM_MAX_TOKENS if max_tokens is None else max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        try:
            with httpx.Client(timeout=LLM_TIMEOUT_SECONDS) as client:
                response = client.post(endpoint, json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"llama-server local indisponível em {LOCAL_LLM_BASE_URL}."
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Resposta inesperada do llama-server local.") from exc

        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("O llama-server local retornou uma resposta vazia.")
        return content.strip()

    def status(self) -> dict:
        status = super().status()
        status.update(
            {
                "local": True,
                "base_url": LOCAL_LLM_BASE_URL,
                "health_url": LOCAL_LLM_HEALTH_URL,
            }
        )
        return status


class GroqProvider(LLMProvider):
    name = "groq"
    model = GROQ_MODEL

    @property
    def configured(self) -> bool:
        return bool(GROQ_API_KEY)

    def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        if not GROQ_API_KEY:
            raise RuntimeError(
                "GROQ_API_KEY não configurada. Mantenha LLM_PROVIDER=mock, use llama-cpp ou defina a chave no .env."
            )

        endpoint = f"{GROQ_BASE_URL.rstrip('/')}/chat/completions"
        payload = {
            "model": self.model,
            "temperature": 0.1 if temperature is None else temperature,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
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

    if provider_name in {"llama-cpp", "llamacpp", "local", "local-llm"}:
        return LlamaCppProvider()
    if provider_name == "groq":
        return GroqProvider()
    if provider_name == "mock":
        return MockProvider()

    raise RuntimeError(
        f"LLM_PROVIDER '{LLM_PROVIDER}' não suportado. Use 'mock', 'llama-cpp' ou 'groq'."
    )
