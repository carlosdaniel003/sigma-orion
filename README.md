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

### Ajuda contextual dos módulos

Os botões `i` do Dashboard do DPP e dos Testes do DPP usam `knowledge/modulos-interface.md` como fonte única de **O que mostra / Origem / Finalidade**. O mesmo arquivo é indexado no SQLite/RAG e fica disponível ao Agente ORION. As regras determinísticas continuam sendo definidas pelo Python, `knowledge/motor-deterministico.md` e `knowledge/regras-globais.md`.

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

## Relatórios Excel das investigações

Após as consultas de **Divergência de Estoque** e **Análise de Qualidade** no Dashboard, cada botão **Baixar Excel** gera **cinco abas específicas, com os mesmos nomes e PNs dos cinco indicadores do próprio painel**:

- **Estoque:** `PNs Críticos`, `PNs Encontrados`, `Aguardando Almoxarifado`, `Sem Registros` e `Encaminhados à Qualidade`.
- **Qualidade:** `PNs Recebidos`, `Encontrados Q239`, `Encontrados Q273`, `Aguardando CQ` e `Sem Registros nesses depósitos`.

Cada aba contém uma linha por PN que pertence ao indicador, incluindo descrição, unidade, quantidades brutas por depósito, cobertura, parcelas comprovadas atribuídas ao déficit, saldos remanescentes, situação, ações, STK ORIGINAL (depósito, centro e linhas) e validações/histórico de revisões. Um PN pode aparecer em mais de uma aba porque os indicadores não são categorias mutuamente exclusivas. Os Q273 paralelos ao Q239 são evidências informativas, não entram no indicador `Encontrados Q273` nem na soma ativa. Os relatórios são derivados do Cenário ORION em construção, do mesmo STK e das decisões registradas no SQLite; não usam o DPP Final como fonte. A exportação não faz lançamentos SAP nem modifica o DPP.

### Gap recalculado do DPP em construção

Depois de registrar as confirmações de Divergência de Estoque e Análise de Qualidade, o ORION recompõe a projeção do déficit de **todos os materiais** da base mensal. Somente disponibilidade e liberação validadas como adicionais ao DPP reduzem a falta física; justificativas explicam a falta restante sem virarem estoque. O resultado aparece no Dashboard com botão Recalcular gap e também é atualizado quando as revisões humanas mudam.

Esta projeção **não substitui o SALDO original nem altera o Excel mensal exportado**. Não executa a etapa posterior de Scrap. O DPP Final anterior é usado apenas para comparar e validar, não como entrada dos cálculos.

### Confirmação e aplicação no DPP mensal

O botão **Conferir e aplicar ao DPP** abre uma revisão do efeito consolidado das duas investigações sobre o DPP em construção. Se houver qualquer validação pendente em Estoque ou CQ, a ação final é bloqueada. A conferência explicita PNs sem registros e faltas ainda sem explicação; o analista precisa reconhecer essas lacunas e confirmar antes da aplicação.

O backend valida novamente o mesmo cenário, STK e últimas decisões. A aplicação só ocorre se nada mudou desde a prévia. O ORION cria uma **nova versão auditável do DPP** (preservando e persistindo a anterior). O novo cenário e o Excel exportado refletem a recuperação comprovada em STK TTL, SALDO e Amount, sem alterar o SAP bruto: a origem dos acréscimos fica na aba oculta `ORION_CONFIRMACOES`. Apenas a disponibilidade confirmada e adicional ao DPP afeta saldo; causas justificadas não viram estoque. O DPP Final pronto permanece exclusivamente referência de validação.

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

### Visual operacional do Dashboard (web)

O Dashboard concentra a leitura inicial em quatro indicadores do Cenário ORION e seis indicadores do Resumo Operacional. Estoque e Qualidade apresentam exclusivamente cinco cards de indicadores cada, que abrem modais nativos com todos os PNs da categoria, dados completos, decisões humanas e formulários de validação. Registros pendentes usam marcador amarelo e decisões humanas já registradas usam azul, apenas nesses detalhes operacionais. PNs sem registros permanecem neutros. O Gap recalculado apresenta quatro indicadores clicáveis, deslocando detalhamentos de materiais e unidades para modais. Pacote do mês e comparação ORION × DPP Final não mudam; as cinco abas de cada Excel preservam suas próprias categorias.

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
- linguagem neutra para status passivos; cores semânticas ficam reservadas a telemetria, progresso e visualizações em que a cor seja necessária.

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
