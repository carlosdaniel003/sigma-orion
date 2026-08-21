# ORION

ORION é o projeto para automatizar a consolidação e a análise do DPP, separando responsabilidades para priorizar **precisão, baixo custo e rastreabilidade**.

## Princípio da arquitetura

**Orquestração → processamento determinístico → conhecimento → interpretação → decisão humana**

- **Python**: leitura, consolidação, cálculos e regras determinísticas.
- **RAG**: conhecimento controlado do processo.
- **LLM**: interpretação, insights e sugestões de ação.
- **Humano**: validação e decisão final.
- **n8n**: será integrado posteriormente como camada mínima de orquestração do sistema maior.

Nesta etapa o desenvolvimento é local e não depende de n8n, PostgreSQL, Docker ou uma LLM instalada no notebook.

## Stack do MVP local

- Frontend: React + Vite
- Backend: Python + FastAPI
- Planilhas: Pandas + OpenPyXL
- Banco: SQLite + SQLAlchemy
- Conhecimento: Markdown versionado em `knowledge/`
- RAG atual: recuperação lexical local, sem serviço externo
- Provider padrão: `mock`, sem chamada externa
- Provider real opcional: Groq API
- Modelo configurável: Qwen via Groq

## Estado atual

1. Seleção e inspeção de múltiplos `.xlsx` e `.csv`.
2. Leitura de abas, linhas e colunas com Pandas/OpenPyXL.
3. Interface administrativa com Visão geral, Arquivos, Agente e Histórico.
4. Provider de LLM desacoplado da aplicação.
5. `MockProvider` para desenvolvimento sem custo e sem envio de dados.
6. `GroqProvider` preparado para uso via `.env`.
7. Base inicial de RAG carregando os arquivos Markdown de `knowledge/`.
8. Guardrails versionados injetados no prompt do agente.
9. Contrato estruturado para resumo, riscos, evidências e recomendações.
10. Métricas continuam sendo fornecidas pelo Python; a LLM não deve recalculá-las.
11. Aprovação/rejeição das recomendações com feedback salvo em SQLite.
12. Histórico completo das análises estruturadas salvo em SQLite.
13. Um único launcher inicia backend e frontend no mesmo terminal.
14. Primeiro parser específico do DPP real implementado no backend.
15. Recalculo determinístico de NEC, STK TTL, SALDO e Amount em Python.
16. Comparação automática entre os resultados Python e os valores já consolidados no DPP.
17. Saldos negativos classificados inicialmente como `INVESTIGAR`, sem recomendar compra automática.

## Escopo atual do DPP

Nesta fase, o ORION trabalha **somente com um DPP já preenchido**.

As informações de WIU, EXPLOSÃO, PGD, BOM e outras fontes externas podem chegar ao DPP por fórmulas, mas ainda não são reconstruídas a partir das planilhas de origem. Primeiro será reproduzido e validado o comportamento matemático do DPP existente.

Regras determinísticas já mapeadas:

```text
NEC     = Σ(REAL do modelo × consumo do material no modelo)
STK TTL = STK base + EXPLOSÃO + STK OP
SALDO   = STK TTL - NEC
Amount  = Preço × SALDO
```

`OPC` representa um código de material opcional. Um `SALDO` negativo significa apenas que o item precisa ser investigado com os dados atualmente consolidados; não significa automaticamente que a quantidade deve ser comprada.

## Estrutura principal

```text
orion/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── llm/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   │   └── dpp_service.py
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
│   ├── dev-env.ps1
│   ├── dev.py
│   └── start-dev.ps1
└── data/                # gerada localmente e ignorada pelo Git
```

## Instalação inicial

Na raiz do repositório, crie a `.venv` apenas uma vez e instale as dependências:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

No notebook corporativo, carregue o Node portátil e instale o frontend uma vez:

```powershell
. .\scripts\dev-env.ps1
cd frontend
npm install
cd ..
```

## Executar tudo em um único terminal

Depois da instalação inicial, execute a partir da raiz do repositório:

```powershell
.\scripts\start-dev.ps1
```

O launcher inicia e mantém no mesmo terminal:

```text
FastAPI  → http://localhost:8000
Docs     → http://localhost:8000/docs
React    → http://localhost:5173
```

Use `Ctrl+C` para encerrar frontend e backend juntos.

O caminho padrão do Node portátil é:

```text
C:\nodejs\node-v20.19.6-win-x64
```

Outro caminho pode ser informado assim:

```powershell
.\scripts\start-dev.ps1 -NodeHome "C:\outro\caminho\node"
```

## Provider da LLM

Por padrão o ORION funciona sem API externa:

```text
LLM_PROVIDER=mock
```

Para testar Groq/Qwen, copie `.env.example` para `.env` e altere localmente:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=sua_chave_local
GROQ_MODEL=qwen/qwen3.6-27b
```

Nunca envie a chave para o Git. O arquivo `.env` está ignorado.

O restante da aplicação não conhece detalhes da Groq. O backend depende somente do contrato `LLMProvider`, permitindo trocar o provider futuramente por Ollama ou uma infraestrutura corporativa.

## RAG atual

A primeira versão do RAG não instala modelo de embeddings no notebook. Ela usa recuperação lexical local sobre os Markdown em `knowledge/`.

```text
Pergunta / fatos
      ↓
knowledge_service
      ↓
trechos relevantes
      +
guardrails.md
      ↓
LLMProvider
```

Essa etapa valida estrutura, fontes e guardrails com custo zero. Depois, o retriever poderá ser substituído por embeddings sem mudar o contrato do agente.

## Regra de precisão

```text
Cálculo objetivo / regra determinística → Python
Conhecimento do processo              → RAG
Interpretação / insight               → LLM
Decisão                               → Humano
```

A LLM recebe as métricas já calculadas e é instruída a não substituí-las nem inventar fatos ausentes.

## Endpoints atuais

```text
GET  /api/health
GET  /api/agent/status
GET  /api/knowledge/status
GET  /api/agent/demo
POST /api/agent/chat-demo
POST /api/agent/chat
POST /api/agent/analyze
GET  /api/analyses/history
GET  /api/analyses/{analysis_id}
POST /api/feedback
POST /api/files/inspect
POST /api/dpp/analyze
```

### `POST /api/dpp/analyze`

Recebe um arquivo `.xlsx` ou `.xlsm` com aba `DPP` e:

- localiza automaticamente o cabeçalho;
- identifica o bloco de modelos entre `Grupo Origem` e `Check`;
- identifica linha `REAL`, linha de `KIT Disponível PGD` e códigos dos modelos;
- recalcula NEC por material;
- recalcula STK TTL;
- recalcula SALDO;
- recalcula Amount quando houver preço;
- compara cada cálculo com os valores existentes no DPP;
- lista os materiais com saldo negativo como `INVESTIGAR`;
- preserva OPC, STK OP, Check, WIU e comentários como evidências do DPP.

O endpoint ainda não chama a LLM.

## Próximas etapas do DPP

Depois que o cálculo determinístico estiver validado contra diferentes DPPs reais:

- normalizar os materiais e modelos para estruturas internas do ORION;
- criar uma tela específica para análise do DPP;
- permitir simulação controlada de valores REAL sem alterar a planilha original;
- calcular limites de produção por modelo;
- incorporar regras de investigação validadas pela analista;
- somente então passar os fatos consolidados para RAG/LLM.

## Segurança dos dados

Este repositório é público. **Não versionar planilhas corporativas reais, segredos, tokens, chaves de API ou dados sensíveis.** Arquivos `.xlsx`, `.xls`, `.xlsm`, `.csv`, bancos locais e `.env` estão ignorados pelo Git.
