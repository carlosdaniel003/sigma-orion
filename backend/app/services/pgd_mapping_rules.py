from __future__ import annotations

import unicodedata


def _normalize(value: object) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value).strip().lower())
    return "".join(char for char in text if not unicodedata.combining(char))


# Regras explícitas aprendidas/validadas por mês. Elas existem porque alguns itens do PGD
# representam famílias agregadas e não carregam, sozinhos, informação suficiente para escolher
# a variante do DPP. Manter a regra versionada é preferível a adivinhar pela atividade histórica.
PGD_VARIANT_OVERRIDES: dict[str, dict[str, str]] = {
    "2026-07": {
        "tv 32": "TV 32 BOE",
        "tv 50": "TV 50 CSOT",
    },
}


# Exceções em que o valor aparece no PGD, mas não deve alimentar a linha KIT PGD do DPP.
# MBX-01 em julho/2026 é o primeiro caso observado e validado no DPP consolidado de referência.
PGD_KIT_OVERRIDES: dict[str, dict[str, float]] = {
    "2026-07": {
        "mbx-01": 0.0,
    },
}


def get_variant_override(reference_month: str, pgd_model: object) -> str | None:
    rules = PGD_VARIANT_OVERRIDES.get(reference_month, {})
    return rules.get(_normalize(pgd_model))


def get_kit_override(reference_month: str, pgd_model: object) -> tuple[bool, float | None]:
    rules = PGD_KIT_OVERRIDES.get(reference_month, {})
    key = _normalize(pgd_model)
    if key not in rules:
        return False, None
    return True, float(rules[key])
