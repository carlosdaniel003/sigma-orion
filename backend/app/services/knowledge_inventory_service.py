from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR
from app.services.python_knowledge_inventory_service import scan_python_knowledge


DETERMINISTIC_DOCUMENTS = {"motor-deterministico.md", "regras-globais.md", "guardrails.md"}


@dataclass(frozen=True, slots=True)
class KnowledgeInventoryItem:
    id: str
    kind: str
    title: str
    query: str
    expected_source: str
    expected_terms: tuple[str, ...] = ()
    origin: str = "documentação"


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_-]+", " ", normalized).strip()


def _slug(text: str) -> str:
    normalized = _normalize(text).replace("_", "-")
    return re.sub(r"-+", "-", normalized.replace(" ", "-")).strip("-") or "item"


def _first_heading(content: str, fallback: str) -> str:
    for line in content.splitlines():
        match = re.match(r"^#{1,6}\s+(.+)$", line.strip())
        if match:
            return match.group(1).strip()
    return fallback


def _markdown_sections(content: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, str]] = []
    matches = list(re.finditer(r"^#{2,4}\s+(.+)$", content, flags=re.MULTILINE))
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        sections.append((match.group(1).strip(), content[start:end].strip()))
    return sections


def _document_items() -> list[KnowledgeInventoryItem]:
    items: list[KnowledgeInventoryItem] = []
    for path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
        relative = path.relative_to(KNOWLEDGE_DIR).as_posix()
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            continue
        title = _first_heading(content, path.stem.replace("-", " ").title())
        items.append(
            KnowledgeInventoryItem(
                id=f"document:{relative}",
                kind="documento",
                title=title,
                query=f"{path.stem.replace('-', ' ')} {title}",
                expected_source=relative,
                expected_terms=(title.split()[0],) if title.split() else (),
                origin="documentação",
            )
        )
    return items


def _concept_and_synonym_items() -> tuple[list[KnowledgeInventoryItem], list[KnowledgeInventoryItem]]:
    concepts: list[KnowledgeInventoryItem] = []
    synonyms: list[KnowledgeInventoryItem] = []
    path = KNOWLEDGE_DIR / "glossario.md"
    if path.exists():
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not (line.startswith("|") and line.endswith("|")):
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) < 2:
                continue
            term, meaning = cells[:2]
            if term.lower() == "termo" or set(term) <= {"-", ":"}:
                continue
            concepts.append(
                KnowledgeInventoryItem(
                    id=f"concept:{_slug(term)}",
                    kind="conceito",
                    title=term,
                    query=f"O que significa {term}?",
                    expected_source="glossario.md",
                    expected_terms=(term,),
                    origin="glossário",
                )
            )
            aliases = []
            aliases.extend(part.strip() for part in re.split(r"\s*/\s*", term) if part.strip())
            parenthetical = re.findall(r"\(([^)]+)\)", term)
            aliases.extend(alias.strip() for alias in parenthetical if alias.strip())
            canonical = aliases[0] if aliases else term
            for alias in aliases[1:]:
                if _normalize(alias) == _normalize(canonical):
                    continue
                synonyms.append(
                    KnowledgeInventoryItem(
                        id=f"synonym:{_slug(canonical)}:{_slug(alias)}",
                        kind="sinônimo",
                        title=f"{alias} → {canonical}",
                        query=f"O que significa {alias}?",
                        expected_source="glossario.md",
                        expected_terms=(canonical,),
                        origin="glossário",
                    )
                )

    synonym_path = KNOWLEDGE_DIR / "sinonimos.md"
    if synonym_path.exists():
        for raw_line in synonym_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not (line.startswith("|") and line.endswith("|")):
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) < 2:
                continue
            alias, canonical = cells[:2]
            if alias.lower().startswith("sin") or set(alias) <= {"-", ":"}:
                continue
            synonyms.append(
                KnowledgeInventoryItem(
                    id=f"synonym:{_slug(canonical)}:{_slug(alias)}",
                    kind="sinônimo",
                    title=f"{alias} → {canonical}",
                    query=f"{alias} {canonical}",
                    expected_source="sinonimos.md",
                    expected_terms=(alias, canonical),
                    origin="sinonimos.md",
                )
            )
    return concepts, synonyms


def _document_rule_items() -> list[KnowledgeInventoryItem]:
    items: list[KnowledgeInventoryItem] = []
    for source in sorted(DETERMINISTIC_DOCUMENTS):
        path = KNOWLEDGE_DIR / source
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        for heading, section in _markdown_sections(content):
            if len(section) < 30:
                continue
            items.append(
                KnowledgeInventoryItem(
                    id=f"rule-doc:{source}:{_slug(heading)}",
                    kind="regra",
                    title=heading,
                    query=f"{Path(source).stem.replace('-', ' ')} {heading}",
                    expected_source=source,
                    expected_terms=tuple(word for word in heading.split() if len(word) > 2)[:2],
                    origin="regra documentada",
                )
            )
    return items


def _formula_items() -> list[KnowledgeInventoryItem]:
    items: list[KnowledgeInventoryItem] = []
    seen: set[tuple[str, str]] = set()
    for source in sorted(DETERMINISTIC_DOCUMENTS):
        path = KNOWLEDGE_DIR / source
        if not path.exists():
            continue
        for heading, section in _markdown_sections(path.read_text(encoding="utf-8")):
            formulas = re.findall(r"`([^`\n]*=[^`\n]*)`", section)
            if not formulas:
                formulas = [
                    line.strip()
                    for line in section.splitlines()
                    if "=" in line and not line.strip().startswith(("|", "#")) and len(line.strip()) < 240
                ]
            for formula in formulas:
                cleaned = formula.strip().strip("` ")
                if not cleaned or cleaned.startswith(("http", "{")):
                    continue
                key = (source, cleaned)
                if key in seen:
                    continue
                seen.add(key)
                lhs = cleaned.split("=", 1)[0].strip()
                items.append(
                    KnowledgeInventoryItem(
                        id=f"formula:{source}:{_slug(heading)}:{_slug(lhs)}",
                        kind="fórmula",
                        title=f"{heading} · {cleaned}",
                        query=f"Qual a fórmula de {lhs}? {heading}",
                        expected_source=source,
                        expected_terms=tuple(term for term in (lhs, "=") if term),
                        origin="fórmula documentada",
                    )
                )
    return items


def _case_items() -> list[KnowledgeInventoryItem]:
    items: list[KnowledgeInventoryItem] = []
    case_dir = KNOWLEDGE_DIR / "casos-aprovados"
    if not case_dir.exists():
        return items
    for path in sorted(case_dir.rglob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        relative = path.relative_to(KNOWLEDGE_DIR).as_posix()
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            continue
        title = _first_heading(content, path.stem.replace("-", " ").title())
        items.append(
            KnowledgeInventoryItem(
                id=f"case:{relative}",
                kind="caso",
                title=title,
                query=f"caso aprovado {path.stem.replace('-', ' ')} {title}",
                expected_source=relative,
                expected_terms=(title.split()[0],) if title.split() else (),
                origin="caso aprovado",
            )
        )
    return items


def _python_rule_items() -> tuple[list[KnowledgeInventoryItem], list[dict]]:
    rules, errors = scan_python_knowledge()
    items = [
        KnowledgeInventoryItem(
            id=f"rule-code:{rule.id}",
            kind="regra",
            title=f"{rule.symbol} · {rule.file_path}",
            query=rule.query,
            expected_source=rule.source,
            expected_terms=(rule.symbol.split(".")[-1],),
            origin="código Python",
        )
        for rule in rules
    ]
    return items, errors


def build_knowledge_inventory() -> dict:
    documents = _document_items()
    concepts, synonyms = _concept_and_synonym_items()
    document_rules = _document_rule_items()
    formulas = _formula_items()
    cases = _case_items()
    python_rules, scan_errors = _python_rule_items()

    raw_items = [*documents, *concepts, *synonyms, *document_rules, *formulas, *cases, *python_rules]
    deduplicated: dict[str, KnowledgeInventoryItem] = {}
    for item in raw_items:
        deduplicated[item.id] = item
    items = list(deduplicated.values())

    kinds: dict[str, int] = {}
    for item in items:
        kinds[item.kind] = kinds.get(item.kind, 0) + 1

    return {
        "total": len(items),
        "by_kind": dict(sorted(kinds.items())),
        "scan_error_count": len(scan_errors),
        "scan_errors": scan_errors,
        "items": [
            {
                "id": item.id,
                "kind": item.kind,
                "title": item.title,
                "query": item.query,
                "expected_source": item.expected_source,
                "expected_terms": list(item.expected_terms),
                "origin": item.origin,
            }
            for item in items
        ],
    }
