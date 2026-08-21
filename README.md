# Gêmeo Digital

Projeto para automatizar a consolidação e a análise do DPP, separando responsabilidades para priorizar **precisão, baixo custo e rastreabilidade**.

## Princípio da arquitetura

**Orquestração → processamento determinístico → conhecimento → interpretação → decisão humana**

- **Python**: leitura, consolidação, cálculos e regras determinísticas.
- **RAG**: conhecimento controlado do processo.
- **LLM**: interpretação, insights e sugestões de ação.
- **Humano**: validação e decisão final.
- **n8n**: será integrado posteriormente como camada de orquestração do sistema maior.

Nesta primeira etapa, o desenvolvimento é local e não depende de n8n, PostgreSQL, Docker ou LLM instalada na máquina.

## Stack do MVP local

- Frontend: React + Vite
- Backend: Python + FastAPI
- Planilhas: Pandas + OpenPyXL
- Banco: SQLite + SQLAlchemy
- Conhecimento: arquivos Markdown versionados em `knowledge/`
- Agente atual: provider `mock`
- LLM futura: provider externo/corporativo desacoplado da interface

## O que já funciona

1. Seleção de múltiplos arquivos `.xlsx` ou `.csv`.
2. Envio das planilhas para o FastAPI.
3. Leitura com Pandas/OpenPyXL.
4. Identificação de abas, linhas e colunas.
5. Banco SQLite inicializado automaticamente.
6. Interface administrativa com visão geral, arquivos e agente.
7. Contrato estruturado para análise do agente: resumo, métricas, riscos, evidências e recomendações.
8. Chat demonstrativo preparado para troca futura por LLM real.
9. Aprovação/rejeição de recomendações com feedback salvo no SQLite.
10. Dados de demonstração claramente marcados como fictícios.

Ainda **não há regras reais do DPP implementadas**. Nenhuma regra de negócio será presumida antes do levantamento das planilhas e do processo do analista.

## Estrutura

```text
gemeo-digital/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   └── package.json
├── knowledge/
│   ├── casos-aprovados/
│   ├── glossario.md
│   ├── guardrails.md
│   └── regras-globais.md
├── scripts/
│   └── dev-env.ps1
└── data/                # gerada localmente e ignorada pelo Git
```

## Executar o backend

A partir da raiz do repositório, usando a `.venv` criada na raiz:

```powershell
cd C:\gemeo-digital\backend
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Backend:

```text
http://localhost:8000
```

Documentação automática:

```text
http://localhost:8000/docs
```

## Executar o frontend no notebook corporativo

A política de grupo bloqueia `npm.cmd` e alguns executáveis `.cmd`. O projeto inclui um script que usa diretamente o Node portátil e o `npm-cli.js`.

Em outro PowerShell, a partir da raiz:

```powershell
. .\scripts\dev-env.ps1
cd frontend
npm run dev
```

Na primeira execução ou após mudança de dependências:

```powershell
npm install
```

O ponto antes do caminho é obrigatório para manter as funções temporárias `npm` e `npx` na sessão atual.

Caminho Node padrão:

```text
C:\nodejs\node-v20.19.6-win-x64
```

Frontend:

```text
http://localhost:5173
```

## Endpoints atuais

```text
GET  /api/health
GET  /api/agent/status
GET  /api/agent/demo
POST /api/agent/chat-demo
POST /api/feedback
POST /api/files/inspect
```

## Fluxo atual

```text
Planilhas
   ↓
React
   ↓
FastAPI
   ↓
Pandas / OpenPyXL
   ↓
Inspeção dos arquivos
```

Paralelamente, a interface do agente já valida o desenho futuro:

```text
Dados estruturados
   ↓
Regras + RAG
   ↓
LLM
   ↓
Resumo / riscos / evidências / ações
   ↓
Aprovar / rejeitar / corrigir
   ↓
SQLite
```

Hoje essa segunda parte usa somente dados fictícios e `MockProvider`.

## Quando os arquivos reais chegarem

Mapear:

- nome e finalidade de cada arquivo;
- abas relevantes;
- significado das colunas;
- chave utilizada para relacionar planilhas;
- equivalentes aos PROC-V atuais;
- tabelas dinâmicas e agrupamentos;
- cálculos determinísticos;
- regras do processo;
- exceções;
- fontes de evidência;
- conclusão esperada do analista em casos reais.

## Segurança dos dados

Este repositório é público. **Não versionar planilhas corporativas reais, segredos, tokens, chaves de API ou dados sensíveis.** Arquivos `.xlsx`, `.xls`, `.xlsm`, `.csv`, bancos locais e `.env` estão ignorados pelo Git.
