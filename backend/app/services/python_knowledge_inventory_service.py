from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
import re

from app.core.config import BASE_DIR


PYTHON_APP_DIR = BASE_DIR / "backend" / "app"


@dataclass(frozen=True, slots=True)
class PythonKnowledgeRule:
    id: str
    source: str
    file_path: str
    symbol: str
    kind: str
    line_start: int
    line_end: int
    heading: str
    content: str
    query: str


def _humanize_identifier(value: str) -> str:
    text = re.sub(r"_+", " ", value).strip()
    return text or value


def _source_id(relative_path: str, symbol: str, line_start: int, line_end: int) -> str:
    return f"python://{relative_path}#{symbol}@L{line_start}-L{line_end}"


def _safe_unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def _function_signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    args = _safe_unparse(node.args)
    returns = f" -> {_safe_unparse(node.returns)}" if node.returns is not None else ""
    return f"{prefix} {node.name}({args}){returns}"


def _rule_content(
    *,
    relative_path: str,
    symbol: str,
    kind: str,
    line_start: int,
    line_end: int,
    signature: str,
    docstring: str,
    source_code: str,
) -> str:
    parts = [
        "Regra extraída automaticamente do código Python do ORION.",
        f"Tipo: {kind}.",
        f"Símbolo: {symbol}.",
        f"Arquivo: {relative_path}.",
        f"Linhas: {line_start}-{line_end}.",
    ]
    if signature:
        parts.append(f"Assinatura: {signature}.")
    if docstring:
        parts.append(f"Documentação do código: {docstring.strip()}")
    parts.append("Implementação Python:")
    parts.append(source_code.strip())
    return "\n".join(parts).strip()


class _RuleVisitor(ast.NodeVisitor):
    def __init__(self, *, relative_path: str, source: str) -> None:
        self.relative_path = relative_path
        self.source = source
        self.lines = source.splitlines()
        self.scope: list[str] = []
        self.rules: list[PythonKnowledgeRule] = []

    def _source_segment(self, node: ast.AST) -> str:
        start = max(1, int(getattr(node, "lineno", 1)))
        end = max(start, int(getattr(node, "end_lineno", start)))
        return "\n".join(self.lines[start - 1:end])

    def _append_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        if node.name.startswith("__") and node.name.endswith("__"):
            return
        qualified = ".".join([*self.scope, node.name]) if self.scope else node.name
        line_start = int(node.lineno)
        line_end = int(node.end_lineno or node.lineno)
        kind = "método" if self.scope and self.scope[-1][:1].isupper() else "função"
        signature = _function_signature(node)
        docstring = ast.get_docstring(node, clean=True) or ""
        source_code = self._source_segment(node)
        source_id = _source_id(self.relative_path, qualified, line_start, line_end)
        file_stem = Path(self.relative_path).stem
        query = f"{file_stem} {qualified} {_humanize_identifier(node.name)}"
        self.rules.append(
            PythonKnowledgeRule(
                id=f"python:{self.relative_path}:{qualified}:{line_start}",
                source=source_id,
                file_path=self.relative_path,
                symbol=qualified,
                kind=kind,
                line_start=line_start,
                line_end=line_end,
                heading=f"{qualified} · {_humanize_identifier(node.name)}",
                content=_rule_content(
                    relative_path=self.relative_path,
                    symbol=qualified,
                    kind=kind,
                    line_start=line_start,
                    line_end=line_end,
                    signature=signature,
                    docstring=docstring,
                    source_code=source_code,
                ),
                query=query,
            )
        )

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.scope.append(node.name)
        for child in node.body:
            self.visit(child)
        self.scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._append_function(node)
        self.scope.append(node.name)
        for child in node.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.visit(child)
        self.scope.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._append_function(node)
        self.scope.append(node.name)
        for child in node.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.visit(child)
        self.scope.pop()


def _module_constants(tree: ast.Module, relative_path: str, source: str) -> list[PythonKnowledgeRule]:
    lines = source.splitlines()
    rules: list[PythonKnowledgeRule] = []
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets: list[ast.expr]
        value: ast.AST | None
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
            value = node.value
        else:
            targets = [node.target]
            value = node.value
        names = [target.id for target in targets if isinstance(target, ast.Name) and target.id.isupper()]
        if not names or value is None:
            continue
        line_start = int(node.lineno)
        line_end = int(node.end_lineno or node.lineno)
        source_code = "\n".join(lines[line_start - 1:line_end])
        for name in names:
            source_id = _source_id(relative_path, name, line_start, line_end)
            file_stem = Path(relative_path).stem
            expression = _safe_unparse(value)
            rules.append(
                PythonKnowledgeRule(
                    id=f"python:{relative_path}:{name}:{line_start}",
                    source=source_id,
                    file_path=relative_path,
                    symbol=name,
                    kind="constante",
                    line_start=line_start,
                    line_end=line_end,
                    heading=f"{name} · constante Python",
                    content=_rule_content(
                        relative_path=relative_path,
                        symbol=name,
                        kind="constante",
                        line_start=line_start,
                        line_end=line_end,
                        signature=f"{name} = {expression}",
                        docstring="",
                        source_code=source_code,
                    ),
                    query=f"{file_stem} {name} {_humanize_identifier(name)}",
                )
            )
    return rules


def scan_python_knowledge() -> tuple[list[PythonKnowledgeRule], list[dict]]:
    rules: list[PythonKnowledgeRule] = []
    errors: list[dict] = []
    if not PYTHON_APP_DIR.exists():
        return rules, [{"file": str(PYTHON_APP_DIR), "error": "Diretório Python não encontrado."}]

    for path in sorted(PYTHON_APP_DIR.rglob("*.py")):
        if path.name == "__init__.py" and path.stat().st_size == 0:
            continue
        relative_path = path.relative_to(BASE_DIR).as_posix()
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=relative_path)
        except (OSError, UnicodeError, SyntaxError) as exc:
            errors.append({"file": relative_path, "error": str(exc)})
            continue

        visitor = _RuleVisitor(relative_path=relative_path, source=source)
        visitor.visit(tree)
        rules.extend(_module_constants(tree, relative_path, source))
        rules.extend(visitor.rules)

    rules.sort(key=lambda item: (item.file_path, item.line_start, item.symbol))
    return rules, errors


def python_knowledge_status() -> dict:
    rules, errors = scan_python_knowledge()
    files = sorted({rule.file_path for rule in rules})
    return {
        "python_file_count": len(files),
        "python_rule_count": len(rules),
        "scan_error_count": len(errors),
        "scan_errors": errors,
    }
