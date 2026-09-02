# SIGMA-S ORION

SIGMA-S ORION é um sistema industrial para construção, análise, comparação e futura investigação assistida do DPP.

O projeto separa responsabilidades para manter precisão e rastreabilidade:

```text
Python calcula
SQLite armazena os fatos atuais
RAG fornece conhecimento
LLM interpreta
Humano valida e decide
n8n orquestra futuramente
```

## Documentos obrigatórios

Antes de alterar o projeto, usar estes arquivos como fontes de verdade:

- **[`PROJECT_STATUS.md`](./PROJECT_STATUS.md)** — estado funcional e arquitetural atual.
- **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — regras normativas de interface, identidade e anti-“vibe code”.
- **[`docs/LOCAL_LLM.md`](./docs/LOCAL_LLM.md)** — instalação portátil e execução da LLM local sem privilégio administrativo.

### Regra para alterações de frontend

Toda mudança visual deve:

1. consultar `DESIGN_SYSTEM.md` antes da implementação;
2. reutilizar os tokens existentes;
3. evitar cards, radius, sombras, cores e espaçamentos novos sem necessidade;
4. preservar os temas claro e escuro;
5. atualizar `DESIGN_SYSTEM.md` no mesmo trabalho quando uma nova regra visual for aprovada.

## Stack atual

- React + Vite
- Python + FastAPI
- OpenPyXL + Pandas
- SQLite + SQLAlchemy
- SQLite FTS5 + BM25 para retrieval
- inventário automático de conhecimento Markdown + regras Python via AST
- provider LLM desacoplado
- `llama.cpp` + Qwen3-4B GGUF como LLM local recomendada
- Groq mantido apenas como provider externo opcional

## Agente ORION

O chat é DB-first. O frontend não possui respostas operacionais pré-definidas.

```text
Pergunta
   ↓
contexto da sessão no SQLite
   ↓
SQL / Python / FTS5 + BM25
   ↓
evidências fundamentadas
   ↓
LLM local quando a pergunta pede interpretação
   ↓
resposta auditada no SQLite
```

Consultas factuais simples podem responder diretamente por SQL/Python para reduzir latência. Perguntas explicativas, causais ou contextuais podem usar o Qwen local depois que os fatos já foram recuperados. Se a LLM estiver desligada, o fluxo retorna automaticamente ao modo SQL + RAG.

## Fluxo mensal atual

```text
DPP do mês anterior
        ↓
base histórica acumulativa
Materiais + OPCs
        │
        ├── WIU
        ├── Explosão de Placas
        ├── STK SAP
        └── PGD
               ↓
        KIT DISPONÍVEL
               ↓
        REAL inicial = KIT PGD
               ↓
      NEC = Σ REAL × Uso BOM
               ↓
STK TTL = STK SAP + Explosão + STK OP
               ↓
       SALDO = STK TTL - NEC
               ↓
       OK / INVESTIGAR
```

OPEN é usado como evidência auxiliar e não altera estoque.

## Dashboard

O Dashboard diferencia explicitamente:

- **Cenário ORION** — cenário inicial calculado pelo motor Python antes dos ajustes humanos;
- **DPP Final** — cenário consolidado depois da investigação e decisões do analista.

A interface atual inclui:

- pacote compartilhado do mês;
- Estado do DPP;
- Evolução ORION → DPP Final;
- indicadores comparados;
- situação dos modelos;
- gargalos por material;
- modelos com maior risco;
- estado da construção da base;
- plano consolidado por modelo do DPP Final.

## Progresso real

A geração mensal utiliza jobs no backend:

```text
POST /api/dpp/monthly/generate/jobs
GET  /api/dpp/monthly/generate/jobs/{job_id}
```

O frontend consulta checkpoints reais e exibe percentual, atividade, contador de segundos e constelação operacional do ORION.

## Design

A identidade possui:

- tema escuro ORION;
- tema claro Apple preto/branco;
- alternância Sol/Lua;
- logo própria SIGMA-S ORION;
- favicon próprio;
- cores semânticas para OK, atenção e crítico.

O frontend deve parecer software industrial deliberadamente projetado, não landing page SaaS ou template gerado por IA. A especificação completa está em `DESIGN_SYSTEM.md`.

## Executar localmente sem LLM

Na raiz do repositório:

```powershell
.\scripts\start-dev.ps1
```

Serviços padrão:

```text
FastAPI  → http://localhost:8000
Docs     → http://localhost:8000/docs
React    → http://localhost:5173
```

## Executar com Qwen local

Depois de colocar `llama-server.exe` e `Qwen3-4B-Q4_K_M.gguf` nas pastas descritas em `docs/LOCAL_LLM.md`:

```powershell
.\scripts\start-orion-local-llm.ps1
```

O launcher usa apenas caminhos do usuário, sobe a API local em `127.0.0.1:8080`, injeta as variáveis necessárias no processo do backend e encerra a LLM que ele próprio iniciou quando o ambiente de desenvolvimento é finalizado.

Também é possível subir apenas a LLM:

```powershell
.\scripts\start-llm.ps1
```

## Segurança

Este repositório é público.

Não versionar:

- planilhas corporativas reais;
- `.env`;
- tokens e chaves;
- bancos locais;
- uploads;
- dados sensíveis;
- arquivos `.gguf`;
- binários locais do llama.cpp.

Para detalhes de limitações, funcionalidades e próximos passos, consultar **`PROJECT_STATUS.md`**.
