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

As investigações contextuais podem ser encadeadas na mesma sessão: listar críticos (REGRA-004) → explicar a contagem (REGRA-001 a REGRA-004) → ordenar os maiores déficits do SALDO ORION → selecionar por PN ou posição do ranking → consultar Estoque/CQ do PN. O ranking é recalculado a partir das entidades atuais do cenário e a seleção é invalidada quando muda o fingerprint do workspace. As respostas distinguem fatos sincronizados, cálculo determinístico e interpretação sem confirmação; depósito bruto não implica liberação nem compra. Definições curtas de domínio são resolvidas pelo glossário versionado, consultas de data/hora usam o relógio local configurado no backend (`ORION_TIMEZONE`, padrão `America/Manaus`) e perguntas independentes de definição podem ser respondidas na mesma mensagem, preservando evidências e tabela. Termos sem significado operacional homologado são explicitamente apresentados como pendentes, sem expansão fictícia de siglas.

A consulta explícita de materiais segundo a REGRA-004 devolve a lista do Cenário ORION, não somente a descrição da regra. Uma referência singular a PN na Qualidade/Estoque é restrita ao PN selecionado, inclusive quando ele não consta da investigação da área: relatório sem registro do PN não equivale a CQ não sincronizado nem a inexistência física.

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

O Agente ORION sincroniza as investigações vigentes junto ao Cenário ORION e DPP Final, em entidades SQLite por PN e resumos. Consultas sobre os cinco grupos de cada investigação, sobre os indicadores do Resumo Operacional e sobre PNs em depósitos usam os mesmos relatórios do Dashboard. O Q273 paralelo permanece informativo e revisões humanas mudam o fingerprint do workspace, sem alterar os cálculos determinísticos.

### Gap recalculado do DPP em construção

Depois de registrar as confirmações de Divergência de Estoque e Análise de Qualidade, o ORION recompõe a projeção do déficit de **todos os materiais** da base mensal. Somente disponibilidade e liberação validadas como adicionais ao DPP reduzem a falta física; justificativas explicam a falta restante sem virarem estoque. O serviço permanece disponível no backend e continua fundamentando a projeção quando solicitado, mas o painel **Gap recalculado do DPP** foi retirado da interface do Dashboard por decisão de apresentação. O fluxo de validação nos modais de Estoque e Qualidade permanece ativo.

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

O Dashboard mostra quatro indicadores do Cenário Inicial, seis do Resumo Operacional e cinco cards clicáveis de investigação em cada módulo (Estoque e Qualidade). Os cards abrem modais com PNs e validações humanas, marcando candidatos pendentes em amarelo e confirmados em azul. O **Pacote do mês** conserva a identidade visual, mas distribui as fontes em uma grade compacta e responsiva. O **Plano consolidado por modelo ORION × DPP Final** permanece disponível.

Foram retirados da interface: **Ver indicadores complementares**, **Gap recalculado do DPP** e **Comparativo completo das colunas do DPP**. A retirada é apenas de apresentação: não apaga serviços, regras, resultados registrados ou as cinco abas de exportação Excel de cada investigação. O modal foi isolado da hierarquia visual via portal e não confunde o fechamento de limpeza do React com um fechamento solicitado pelo analista.

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


### Paleta invertida do tema escuro e sidebar

O tema **claro** mantém a sidebar preta com nome e ícones brancos. O tema **escuro** usa o azul ORION `#46D9FF` em superfícies antes azul-marinho e texto principal azul-marinho `#08111F`, com rótulos secundários azul-petróleo `#28546B`. O mesmo tom escuro do wordmark é usado nos textos da sidebar azul. O botão de expandir/recolher é o logotipo **SIGMA-S ★RION inteiro** quando expandido e apenas a estrela quando recolhido. A scrollbar da navegação lateral é ocultada visualmente sem bloquear a rolagem. O cabeçalho e **Fechar** dos modais de Estoque e Qualidade permanecem visíveis durante a rolagem.

A imagem Mondial é opcional e deve ser enviada manualmente para `frontend/public/assets/mondial-sidebar.jpg`; o repositório não inclui fotos não autorizadas.


### Ajuste do tema escuro após validação visual

O tema claro e a sidebar com a foto da Mondial permanecem como estavam. Após a inspeção das capturas do usuário, o fundo ciano uniforme do tema escuro foi descartado: a página usa azul-marinho `#0D1826`, painéis `#142235`, superfícies elevadas `#1B2D43`, títulos/números claros e informações secundárias `#91A4B8`. A sidebar escura permanece azul ORION `#46D9FF`; ciano nas demais áreas fica reservado a ações/foco. Tokens centralizados em `frontend/src/orion-dark-refinement.css`, em vez de sobrescrever os módulos individualmente.


### Paleta Mondial vigente para o modo escuro

A identidade **preto, grafite e branco** substitui as experiências anteriores de azul-ciano e azul-marinho espalhados pelos painéis. No tema escuro, a sidebar com a fotografia Mondial usa quase preto `#090A0C`, texto branco e estrela ORION azul `#46D9FF`. A área de conteúdo fica em grafite `#191A1D`, com painéis `#242529`, elevado `#2E3035` e texto claro `#F5F5F6`. Os botões principais são brancos com texto escuro; o ciano permanece apenas em poucos realces funcionais. A implementação está centralizada em `frontend/src/orion-dark-refinement.css` e `frontend/src/sidebar-theme.css`. O **tema claro permanece inalterado**.


### Dashboard após retomada de sessão

O Dashboard apresenta primeiro o **Resumo Operacional** (seis métricas), depois o Pacote do mês, as investigações Estoque/Qualidade e o Plano Consolidado por Modelo ORION × DPP Final. O cenário inicial segue sendo calculado pelo motor, mas não ocupa painel separado. O pacote válido inicia automaticamente geração, investigação dos depósitos M221/P277 e, para os PNs encaminhados, consulta Q239/Q273; não há botões de reconsulta.

Os cenários ativos são persistidos pelo servidor; após suspender a aba, o sistema verifica se o ID do cenário salvo no navegador ainda existe. Se não existir, os indicadores antigos ficam ocultos e o usuário pode tentar recuperar o servidor ou **reprocessar o pacote salvo localmente**, sem anexar novamente os arquivos. Decisões humanas não são assumidas como válidas para uma nova identidade de cenário. Os cinco grupos Excel de Estoque e Qualidade não mudaram.


### Painel de Pendências de validação (Etapa 3)

Com cenário ativo, Estoque e Qualidade aparecem empilhados à esquerda e a fila Pendências de validação à direita. Cada PN pendente abre o modal original da área já filtrado; "Ver todos" abre a categoria completa. As contagens são de PNs distintos por área e somente dos relatórios atuais; não são novas consultas nem validações automáticas. A tabela ORION × DPP Final continua em largura total.


### Perguntas sobre o funcionamento e os resultados do DPP

O Agente ORION responde perguntas **o que / por que / como / de onde vem / para que serve** sobre módulos do Dashboard, fluxo mensal, Estoque, Qualidade, comparativos, Testes do DPP e indicadores. As descrições vêm da mesma fonte do botão de ajuda dos módulos (`knowledge/modulos-interface.md`), e métricas disponíveis são lidas dos resumos sincronizados do Cenário ORION e DPP Final sem trocar escopos ou tratar ausência como zero.

Perguntas sobre **por que o SALDO/NEC de um PN difere** usam decomposição matemática (REGRA-003, REGRA-004) e dados do próprio PN; evidência de Estoque/CQ aparece separadamente. A diferença calculada não é automaticamente causa operacional, liberação física ou recomendação de compra. Respostas sem evidência suficiente devem informar a lacuna. A LLM é auxiliar e não substitui os cálculos do motor Python.
