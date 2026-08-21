# Gêmeo Digital

Projeto para automatizar a consolidação e a análise do DPP, separando responsabilidades para priorizar **precisão, baixo custo e rastreabilidade**.

## Princípio da arquitetura

**Orquestração → processamento determinístico → conhecimento → interpretação → decisão humana**

- **Python**: leitura, consolidação, cálculos e regras determinísticas.
- **RAG**: conhecimento controlado do processo.
- **LLM**: interpretação, insights e sugestões de ação.
- **Humano**: validação e decisão final.
- **n8n**: será integrado posteriormente como camada de orquestração do sistema maior.

Nesta primeira etapa, o desenvolvimento será totalmente local e não dependerá de n8n, PostgreSQL, Docker ou uma LLM instalada na máquina.

## Stack do MVP local

- Frontend: React + Vite
- Backend: Python + FastAPI
- Planilhas: Pandas + OpenPyXL
- Banco: SQLite + SQLAlchemy
- Conhecimento: arquivos Markdown versionados em `knowledge/`
- LLM: desacoplada nesta etapa; será conectada depois por um provider externo ou corporativo

## O que já funciona

O primeiro incremento permite:

1. selecionar múltiplos arquivos `.xlsx` ou `.csv` pela interface;
2. enviá-los para o backend FastAPI;
3. ler as planilhas com Pandas/OpenPyXL;
4. identificar abas, quantidade de linhas e colunas;
5. devolver a estrutura detectada para o frontend;
6. inicializar um banco SQLite local para o histórico futuro do sistema.

Ainda **não há regras do DPP implementadas** porque os arquivos reais e o procedimento do analista ainda serão levantados. Isso é intencional: nenhuma regra de negócio será presumida.

## Estrutura

```text
gemeo-digital/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   ├── services/
│   │   └── main.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   └── package.json
├── knowledge/
│   ├── casos-aprovados/
│   ├── glossario.md
│   ├── guardrails.md
│   └── regras-globais.md
└── data/                # gerada localmente e ignorada pelo Git
```

## Executar o backend no Windows sem instalação global

A partir da raiz do repositório:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Backend:

```text
http://localhost:8000
```

Documentação automática da API:

```text
http://localhost:8000/docs
```

O ambiente virtual e as bibliotecas ficam dentro da pasta do projeto, sem instalação global do Python package.

## Executar o frontend

Em outro terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

## Primeiro fluxo

```text
Usuário seleciona planilhas
        ↓
React
        ↓
FastAPI
        ↓
Pandas / OpenPyXL
        ↓
Inspeção da estrutura dos arquivos
        ↓
JSON estruturado
        ↓
React exibe o resultado
```

Quando os arquivos reais forem recebidos, a próxima etapa será mapear:

- nome e finalidade de cada arquivo;
- chave usada para relacionar as planilhas;
- equivalentes aos PROC-V atuais;
- tabelas dinâmicas e agrupamentos;
- regras determinísticas;
- exceções;
- conclusão esperada do analista em casos reais.

## Evolução planejada

```text
Arquivos
   ↓
Python / FastAPI
   ↓
DPP consolidado
   ↓
Regras determinísticas
   ↓
RAG + LLM
   ↓
Insights e ações sugeridas
   ↓
Validação humana
```

Depois, o módulo será integrado ao sistema maior por meio do n8n.

## Segurança dos dados

Este repositório é público. **Não versionar planilhas corporativas reais, segredos, tokens, chaves de API ou dados sensíveis.** Arquivos de entrada devem permanecer fora do Git; a pasta local de uploads está ignorada por `.gitignore`.
