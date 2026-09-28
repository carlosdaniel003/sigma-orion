from __future__ import annotations

import re

from app.core.config import BASE_DIR
from app.services.dpp_rule_registry import known_rule_codes
from app.services.knowledge_catalog_service import _connect, sync_knowledge_index
from app.services.module_info_service import (
    MODULE_INFO_SOURCE,
    REQUIRED_MODULE_KEYS,
    load_module_info,
    module_info_diagnostics,
)


def test_required_dashboard_and_test_modules_have_complete_help() -> None:
    modules = load_module_info()
    diagnostics = module_info_diagnostics(modules)

    assert diagnostics["valid"] is True
    assert set(modules) >= REQUIRED_MODULE_KEYS

    for key in REQUIRED_MODULE_KEYS:
        item = modules[key]
        assert item.title.strip()
        assert item.what.strip()
        assert item.source.strip()
        assert item.purpose.strip()


def test_module_help_references_only_known_deterministic_rules() -> None:
    modules = load_module_info()
    known = set(known_rule_codes())
    referenced: set[str] = set()

    for item in modules.values():
        text = " ".join([item.what, item.source, item.purpose])
        referenced.update(re.findall(r"REGRA-\d{3}", text, flags=re.IGNORECASE))

    assert referenced
    assert {code.upper() for code in referenced} <= known


def test_module_help_is_indexed_for_agent_orion() -> None:
    sync_knowledge_index(force=True)

    with _connect() as connection:
        row = connection.execute(
            "SELECT source, category, content FROM knowledge_documents WHERE source = ? LIMIT 1",
            (MODULE_INFO_SOURCE,),
        ).fetchone()

    assert row is not None
    assert str(row["category"]) == "operational"
    assert "O que mostra" in str(row["content"])
    assert "Agente ORION" in str(row["content"])


def test_required_module_help_is_referenced_by_frontend() -> None:
    frontend_dir = BASE_DIR / "frontend" / "src"
    references: set[str] = set()

    for path in frontend_dir.rglob("*.jsx"):
        content = path.read_text(encoding="utf-8")
        references.update(re.findall(r'(?:moduleKey|infoKey)="([^"]+)"', content))

    assert REQUIRED_MODULE_KEYS <= references
