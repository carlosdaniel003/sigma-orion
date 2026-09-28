from fastapi.testclient import TestClient

from app.main import app


def _ask(client: TestClient, question: str, session_id: str) -> dict:
    response = client.post(
        "/api/knowledge/chat",
        json={"question": question, "session_id": session_id},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_python_follow_up_prefers_code_directly_related_to_previous_concept() -> None:
    with TestClient(app) as client:
        definition = _ask(client, "O que significa WIU?", "wiu-python-refinement")
        follow_up = _ask(client, "O que o código Python faz nesta regra?", "wiu-python-refinement")

    assert definition["knowledge_sources"] == ["glossario.md"]
    assert "WIU" in follow_up["resolved_question"]
    assert follow_up["knowledge_sources"]
    assert any("dpp_consolidation_service.py#_parse_wiu" in source for source in follow_up["knowledge_sources"])
    assert "_resolved_question" not in follow_up["answer"]
    assert "_database_path" not in follow_up["answer"]


def test_topical_question_starts_from_subject_specific_evidence() -> None:
    with TestClient(app) as client:
        payload = _ask(client, "O que sabemos sobre OPC?", "opc-topical-refinement")

    assert "OPC" in payload["answer"]
    assert "Ela deve ser usada pelo chat" not in payload["answer"]
    assert "Planilhas representam os fatos atuais" not in payload["answer"]
    assert "README.md" not in payload["knowledge_sources"]
    assert any(source in {"motor-deterministico.md", "regras-globais.md", "glossario.md"} for source in payload["knowledge_sources"])
