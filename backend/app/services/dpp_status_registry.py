from __future__ import annotations

from app.services.dpp_projection_service import CRITICAL_BALANCE_TOLERANCE


def _tolerance_text() -> str:
    return f"{CRITICAL_BALANCE_TOLERANCE:.4f}".replace(".", ",")


STATUS_REGISTRY: dict[str, dict[str, str]] = {
    "INVESTIGAR": {
        "label": "Material crítico",
        "meaning": "O material está dentro do escopo da regra de criticidade e atende às condições para investigação.",
        "condition": f"UM = UN e SALDO < -{_tolerance_text()}.",
        "implication": "O material é classificado como crítico no Cenário ORION.",
        "rule": "REGRA-004",
    },
    "OK": {
        "label": "Material dentro do escopo sem criticidade",
        "meaning": "O material está dentro do escopo da regra de criticidade porque sua UM é UN, mas o SALDO não ultrapassa o limite negativo de investigação.",
        "condition": f"UM = UN e SALDO >= -{_tolerance_text()}.",
        "implication": "O material não é classificado como crítico no Cenário ORION.",
        "rule": "REGRA-004",
    },
    "FORA_ESCOPO_UM": {
        "label": "Fora do escopo por unidade de medida",
        "meaning": "O material está fora do escopo da regra de criticidade porque sua unidade de medida é diferente de UN.",
        "condition": "UM != UN.",
        "implication": "O material não é classificado como crítico por essa regra, mesmo que tenha SALDO negativo.",
        "rule": "REGRA-004",
    },
}


def known_status_codes() -> tuple[str, ...]:
    return tuple(STATUS_REGISTRY)


def get_status_definition(code: object) -> dict[str, str] | None:
    normalized = str(code or "").strip().upper()
    item = STATUS_REGISTRY.get(normalized)
    if item is None:
        return None
    return {"code": normalized, **item}


def status_evidence_text(code: object) -> str:
    item = get_status_definition(code)
    if item is None:
        return ""
    return (
        f"Status: {item['code']}\n"
        f"Significado: {item['meaning']}\n"
        f"Condição determinística: {item['condition']}\n"
        f"Implicação: {item['implication']}\n"
        f"Regra associada: {item['rule']}"
    )
