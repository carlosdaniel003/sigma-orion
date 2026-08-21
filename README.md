# Gêmeo Digital

Projeto para automatizar a consolidação e a análise do DPP, separando responsabilidades para priorizar precisão, baixo custo e rastreabilidade.

## Princípio da arquitetura

**Orquestração → processamento determinístico → conhecimento → interpretação → decisão humana**

- **Python**: leitura, consolidação, cálculos e regras determinísticas.
- **RAG**: conhecimento controlado do processo.
- **LLM**: interpretação, insights e sugestões de ação.
- **Humano**: validação e decisão final.
- **n8n**: será integrado posteriormente como camada de orquestração do sistema maior.

O desenvolvimento inicial será totalmente local e não dependerá de n8n, PostgreSQL, Docker ou uma LLM instalada na máquina.
