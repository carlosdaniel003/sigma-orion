from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.config import KNOWLEDGE_DIR


MODULE_INFO_SOURCE = "modulos-interface.md"
MODULE_PATTERN = re.compile(r"^##\s+([a-z0-9._-]+)\s+—\s+(.+?)\s*$", re.IGNORECASE)
FIELD_PATTERN = re.compile(r"^\*\*(O que mostra|Origem|Finalidade):\*\*\s*(.*)$", re.IGNORECASE)

FIELD_KEYS = {
    "o que mostra": "what",
    "origem": "source",
    "finalidade": "purpose",
}

REQUIRED_MODULE_KEYS = {
    "dashboard.overview",
    "dashboard.package",
    "dashboard.export",
    "dashboard.evolution",
    "dashboard.agent_bridge",
    "dashboard.scenario_comparison",
    "dashboard.planning",
    "dashboard.quality",
    "dashboard.guide",
    "dashboard.final_model_plan",
    "dashboard.column_comparison",
    "tests.overview",
    "tests.preparation",
    "tests.month",
    "tests.shared_package",
    "tests.package",
    "tests.execution",
    "tests.verdict",
    "tests.controlled_real",
    "tests.validation_summary",
    "tests.field_comparison",
    "tests.orion_differences",
    "tests.human_interventions",
    "tests.legacy_corrections",
}


@dataclass(slots=True)
class ModuleInfo:
    key: str
    title: str
    what: str
    source: str
    purpose: str

    def as_dict(self) -> dict[str, str]:
        return {
            "key": self.key,
            "title": self.title,
            "what": self.what,
            "source": self.source,
            "purpose": self.purpose,
        }


def _normalized_label(value: str) -> str:
    return str(value or "").strip().lower()


def load_module_info() -> dict[str, ModuleInfo]:
    path = KNOWLEDGE_DIR / MODULE_INFO_SOURCE
    if not path.exists():
        return {}

    modules: dict[str, ModuleInfo] = {}
    current_key = ""
    current_title = ""
    current_field = ""
    fields: dict[str, list[str]] = {"what": [], "source": [], "purpose": []}

    def flush() -> None:
        nonlocal fields
        if not current_key:
            return
        values = {
            name: " ".join(part.strip() for part in parts if part.strip()).strip()
            for name, parts in fields.items()
        }
        modules[current_key] = ModuleInfo(
            key=current_key,
            title=current_title,
            what=values["what"],
            source=values["source"],
            purpose=values["purpose"],
        )
        fields = {"what": [], "source": [], "purpose": []}

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        module_match = MODULE_PATTERN.match(line)
        if module_match:
            flush()
            current_key = module_match.group(1).strip()
            current_title = module_match.group(2).strip()
            current_field = ""
            continue

        if not current_key:
            continue

        field_match = FIELD_PATTERN.match(line)
        if field_match:
            label = _normalized_label(field_match.group(1))
            current_field = FIELD_KEYS.get(label, "")
            if current_field:
                fields[current_field].append(field_match.group(2).strip())
            continue

        if current_field and line and not line.startswith("#"):
            fields[current_field].append(line)

    flush()
    return modules


def module_info_diagnostics(modules: dict[str, ModuleInfo] | None = None) -> dict:
    items = modules if modules is not None else load_module_info()
    missing = sorted(REQUIRED_MODULE_KEYS - set(items))
    incomplete = sorted(
        key
        for key, item in items.items()
        if not item.title or not item.what or not item.source or not item.purpose
    )
    return {
        "valid": not missing and not incomplete,
        "required_count": len(REQUIRED_MODULE_KEYS),
        "missing": missing,
        "incomplete": incomplete,
    }


def module_info_payload() -> dict:
    modules = load_module_info()
    return {
        "source": MODULE_INFO_SOURCE,
        "count": len(modules),
        "diagnostics": module_info_diagnostics(modules),
        "items": {key: item.as_dict() for key, item in modules.items()},
    }


def get_module_info(module_key: str) -> ModuleInfo | None:
    return load_module_info().get(str(module_key or "").strip())
