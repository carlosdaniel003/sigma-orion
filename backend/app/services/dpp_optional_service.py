from __future__ import annotations

import re

from app.services.dpp_consolidation_service import _material_code, _material_key

# Separa apenas barras usadas como delimitador visual (com espaço em pelo menos um lado),
# além de ponto e vírgula e quebras de linha. Assim evitamos quebrar códigos que possam conter
# '/' internamente.
_OPTIONAL_SEPARATOR = re.compile(r"(?:\s+/\s*|\s*/\s+|[;\r\n]+)")


def split_optional_materials(value: object) -> list[str]:
    if value in (None, ""):
        return []

    text = str(value).strip()
    if not text:
        return []

    parts = [part.strip() for part in _OPTIONAL_SEPARATOR.split(text) if part.strip()]
    if not parts:
        parts = [text]

    result: list[str] = []
    seen: set[str] = set()
    for part in parts:
        code = _material_code(part)
        key = _material_key(code)
        if not code or not key or key in seen:
            continue
        seen.add(key)
        result.append(code)
    return result


def optional_material_keyset(value: object) -> tuple[str, ...]:
    keys = {_material_key(code) for code in split_optional_materials(value)}
    return tuple(sorted(key for key in keys if key))


def canonical_optional_material(value: object) -> str | None:
    codes = split_optional_materials(value)
    return " / ".join(codes) if codes else None
