from __future__ import annotations

import re

from app.core.config import KNOWLEDGE_DIR


RULE_SOURCE = "regras-globais.md"
RULE_PATTERN = re.compile(r"^##\s+(REGRA-\d{3})\s+—\s+(.+?)\s*$", re.IGNORECASE)


def _load_rules() -> dict[str, dict[str, str]]:
    path = KNOWLEDGE_DIR / RULE_SOURCE
    if not path.exists():
        return {}

    rules: dict[str, dict[str, str]] = {}
    current_code = ""
    current_title = ""
    lines: list[str] = []

    def flush() -> None:
        nonlocal lines
        if not current_code:
            return
        content = "\n".join(lines).strip()
        rules[current_code] = {
            "code": current_code,
            "title": current_title,
            "content": content,
            "source": RULE_SOURCE,
        }
        lines = []

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        match = RULE_PATTERN.match(raw_line.strip())
        if match:
            flush()
            current_code = match.group(1).upper()
            current_title = match.group(2).strip()
            continue
        if current_code:
            lines.append(raw_line)
    flush()
    return rules


def known_rule_codes() -> list[str]:
    return sorted(_load_rules())


def get_rule_definition(code: str) -> dict[str, str] | None:
    normalized = str(code or "").upper().replace("_", "-").strip()
    return _load_rules().get(normalized)


def rule_evidence_text(code: str) -> str:
    item = get_rule_definition(code)
    if item is None:
        return ""
    return f"{item['code']} — {item['title']}\n{item['content']}".strip()
