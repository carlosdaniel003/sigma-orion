# SIGMA-S ORION

SIGMA-S ORION é um sistema industrial para construção, análise, comparação e futura investigação assistida do DPP.

O projeto separa responsabilidades para manter precisão e rastreabilidade:

```text
Python calcula
RAG fornece conhecimento
LLM interpreta
Humano valida e decide
n8n orquestra futuramente
```

## Documentos obrigatórios

Antes de alterar o projeto, usar estes arquivos como fontes de verdade:

- **[`PROJECT_STATUS.md`](./PROJECT_STATUS.md)** — estado funcional e arquitetural atual.
- **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — regras normativas de interface, identidade e anti-“vibe code”.

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
- Markdown versionado para conhecimento
- RAG lexical local
- provider LLM desacoplado (`mock` por padrão; Groq/Qwen opcional)

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

## Executar localmente

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

## Segurança

Este repositório é público.

Não versionar:

- planilhas corporativas reais;
- `.env`;
- tokens e chaves;
- bancos locais;
- uploads;
- dados sensíveis.

Para detalhes de limitações, funcionalidades e próximos passos, consultar **`PROJECT_STATUS.md`**.
