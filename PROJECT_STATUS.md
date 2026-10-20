# SIGMA-S ORION — Estado atual do projeto

Atualizado em: **2026-09-28**

Este arquivo registra o estado funcional atual do projeto. Deve ser atualizado quando houver mudança relevante de arquitetura, fluxo do DPP, frontend ou capacidade operacional.

Para qualquer alteração visual, consultar também **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** antes de editar o frontend.

## Objetivo

O SIGMA-S ORION automatiza a construção, análise e comparação do DPP, mantendo a separação:

```text
Python calcula
RAG fornece conhecimento
LLM interpreta
Humano valida e decide
n8n orquestra futuramente
```

A prioridade atual é manter os cálculos objetivos fora da LLM e construir um fluxo rastreável para o DPP mensal.

## Público e estratégia de adoção

O ORION é voltado principalmente a analistas e usuários que hoje trabalham diretamente com Excel e consomem indicadores em formatos próximos ao Power BI.

A estratégia de produto é conduzir esse público de forma gradual de:

```text
planilha manual
→ sistema com tabelas e comparações familiares
→ automação determinística
→ investigação assistida pelo Agente ORION
```

O frontend deve preservar familiaridade com tabelas, colunas, filtros, totais, diferenças e drill-down, enquanto elimina trabalho repetitivo. A experiência deve priorizar **industrialidade, fluidez e clareza visual**.

O Agente ORION é uma camada de assistência sobre dados rastreáveis. Ele não substitui a evidência: respostas, análises e recomendações devem permitir retorno aos materiais, modelos, regras e fontes que sustentam o resultado.

## Stack atual

- Frontend: React + Vite
- Backend: Python + FastAPI
- Planilhas: OpenPyXL + Pandas
- Persistência local: SQLite + SQLAlchemy
- Persistência do pacote no navegador: IndexedDB
- Conhecimento: Markdown versionado
- RAG atual: SQLite + FTS5/BM25, consultas estruturadas sobre entidades runtime e síntese opcional pela LLM local
- LLM padrão: mock
- Provider opcional: Groq/Qwen
- Execução local: scripts PowerShell/Python

## Estratégia atual de resposta do Agente ORION

O chat operacional usa `POST /api/knowledge/chat` e segue esta prioridade:

```text
pergunta
  ↓
roteador determinístico
  ↓
consulta estruturada em entidades SQLite, quando aplicável
  ↓
RAG FTS5/BM25 para conhecimento documental complementar
  ↓
Qwen/LLM local somente para organizar e explicar evidências já recuperadas
  ↓
resposta + tabela + fontes + auditoria
```

Princípios:

- perguntas sobre materiais/modelos/dados atuais devem preferir as entidades estruturadas do workspace;
- consultas como "itens críticos" usam diretamente os materiais calculados pelo Cenário ORION;
- buscas por categoria/descrição, como "itens de adesivo", consultam os materiais sincronizados antes do BM25 genérico;
- perguntas de fórmula, como a criticidade, retornam a cadeia determinística correspondente;
- perguntas livres sobre conhecimento indexado podem ser sintetizadas pela LLM local, sempre restritas às evidências recuperadas;
- o chat não deve devolver JSON bruto ou trechos internos desconectados quando houver evidência suficiente para uma resposta legível;
- perguntas fora do conhecimento/fatos disponíveis continuam sendo respondidas com abstinência explícita.

### Roteamento composto e registro de cálculos

O Agente ORION preserva múltiplos objetivos presentes na mesma pergunta. Uma consulta pode pedir simultaneamente fórmula, explicação e comparação sem perder uma dessas partes.

O plano de consulta registra explicitamente:

- `calculation_requested`;
- `comparison_requested`;
- conceitos reconhecidos;
- regras/status explícitos;
- contexto conversacional aplicável.

Identificadores de modelo são resolvidos tolerando separadores equivalentes, por exemplo `CM-200-N`, `CM 200 N` e `CM_200_N`.

Cálculos conhecidos usam registro determinístico antes do BM25:

- NEC → REGRA-001;
- STK TTL → REGRA-002;
- SALDO → REGRA-003;
- criticidade → REGRA-001/002/003/004;
- OPC/STK OP → REGRA-005;
- Amount → REGRA-006;
- CHECK → REGRA-007.

Perguntas compostas de divergência continuam usando dados estruturados do workspace e acrescentam as regras necessárias para explicar a propagação do cálculo.

### Persistência da conversa

A conversa ativa do Agente ORION possui retenção de **24 horas corridas a partir da criação da sessão**.

Comportamento atual:

- o frontend persiste a sessão e as mensagens em IndexedDB, com fallback para `localStorage`;
- o mesmo `session_id` é reutilizado ao navegar entre páginas, atualizar a aplicação ou fechar/reabrir o navegador dentro das 24 horas;
- tabelas, evidências, fontes e metadados visíveis da conversa são restaurados junto com as mensagens;
- ao completar 24 horas, a conversa visível é reiniciada automaticamente com uma nova sessão;
- o backend só reutiliza contexto conversacional de registros com até 24 horas;
- os registros antigos de auditoria podem permanecer no SQLite para rastreabilidade, mas não participam mais do contexto ativo após a expiração.


## Fluxo mensal do DPP

```text
DPP do mês anterior
        ↓
base histórica acumulativa
Materiais + OPCs
        │
        ├── WIU do novo mês
        ├── Explosão do novo mês
        ├── STK SAP do dia 1º
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

OPEN é evidência auxiliar e não altera estoque.

## Pacote compartilhado do mês

O frontend aceita uma única seleção de arquivos e reutiliza o mesmo pacote:

- DPP do mês anterior;
- DPP final/consolidado do mês;
- STK SAP;
- Explosão de Placas;
- OPEN opcional;
- PGD;
- WIU.

Os `File` objects não ficam mais apenas no estado React. O pacote e o mês de referência são persistidos em **IndexedDB** e restaurados antes de o Dashboard decidir se precisa carregar ou reconstruir um cenário. As assinaturas de geração/teste são mantidas em `localStorage` para evitar recomputações desnecessárias do mesmo pacote.

O navegador também solicita armazenamento persistente quando a API `navigator.storage.persist()` está disponível. Assim, troca de tela, tempo prolongado de uso e atualização da página não devem fazer o sistema voltar ao estado de “nenhuma planilha carregada”. Se o cache de cenários do backend tiver expirado ou o backend tiver reiniciado, os arquivos locais continuam disponíveis para reconstruir o cenário automaticamente.

O botão **Limpar pacote** continua sendo a ação explícita que remove o conjunto atual do workspace.

## Geração mensal

A geração principal usa job assíncrono no backend:

```text
POST /api/dpp/monthly/generate/jobs
GET  /api/dpp/monthly/generate/jobs/{job_id}
```

O backend mantém checkpoints reais do processamento. O frontend consulta o progresso e a tela ORION exibe:

- etapa real;
- percentual real por checkpoint;
- contador de segundos;
- constelação de Órion vinculada ao progresso;
- conclusão visual antes de fechar o loader.

A geometria final da animação representa de forma simplificada a constelação real de Órion: cabeça, ombros, Três Marias e pés principais. No `100%`, todas as conexões são concluídas antes do fechamento da tela.

O percentual representa checkpoints ponderados do pipeline, não percentual exato de CPU/linhas processadas.

## Dashboard DPP

O Dashboard diferencia explicitamente:

### Cenário ORION

Cenário inicial gerado deterministicamente pelo Python antes dos ajustes do analista.

### DPP Final

Arquivo consolidado após investigação, ajustes e decisões humanas.

Componentes atuais incluem:

- pacote compartilhado do mês;
- contexto do cenário atual;
- exportação do Cenário ORION para Excel usando o **DPP do mês anterior somente como base visual**;
- Estado do DPP — ORION vs Final;
- Evolução do DPP;
- indicadores comparados ORION vs DPP Final;
- situação dos modelos do Cenário ORION;
- principais gargalos;
- modelos com maior risco;
- estado da construção da base;
- Plano consolidado por modelo do DPP Final.

### Informação contextual dos componentes

Todos os módulos analíticos/operacionais principais do **Dashboard do DPP** e dos **Testes do DPP** possuem um botão `i` quadrado junto ao título. O conteúdo aparece por hover ou foco de teclado e segue sempre a mesma estrutura:

```text
O que mostra
Origem
Finalidade
```

A fonte única dessas descrições é:

```text
knowledge/modulos-interface.md
```

Fluxo:

```text
knowledge/modulos-interface.md
        ├── GET /api/knowledge/module-info
        │        ↓
        │   ModuleInfoHint.jsx
        │        ↓
        │   Dashboard / Testes
        │
        └── SQLite / FTS5 / BM25
                 ↓
            Agente ORION
```

Assim, o mesmo conteúdo usado para explicar os módulos ao usuário também é conhecimento recuperável pelo Agente ORION. O frontend não mantém uma segunda cópia manual das descrições.

O contrato é validado no CI por `backend/tests/test_module_info.py`:

- módulos obrigatórios precisam existir;
- título, O que mostra, Origem e Finalidade não podem estar vazios;
- referências `REGRA-xxx` precisam corresponder a regras existentes;
- `modulos-interface.md` precisa estar indexado como conhecimento operacional para o Agente ORION.

O Dashboard cobre atualmente:

- contexto/Visão Geral;
- pacote compartilhado;
- Excel do cenário ORION;
- Evolução do DPP;
- papel do Agente ORION;
- ORION × DPP Final;
- aderência PGD × REAL;
- qualidade dos dados;
- guia de leitura;
- plano consolidado por modelo;
- comparativo completo das colunas.

Os Testes cobrem atualmente:

- visão geral;
- preparação;
- mês de referência;
- pacote compartilhado;
- arquivos usados;
- execução;
- veredito;
- REAL controlado;
- resumo das validações;
- comparação campo a campo;
- divergências ORION;
- intervenções humanas;
- correções do legado.

As descrições devem refletir a implementação vigente. Em particular, resultados de **Testes do DPP ainda não são sincronizados como evidência runtime do Agente ORION**; cenário, DPP Final e comparativos do workspace são sincronizados. Nenhum tooltip deve afirmar integração que o backend ainda não executa.

As regras de cálculo continuam pertencendo ao Python e a `motor-deterministico.md` / `regras-globais.md`; a documentação dos módulos descreve origem e uso, mas não substitui essas fontes determinísticas.

### Exportação Excel do cenário ORION

O Dashboard disponibiliza **Baixar Excel ORION** sempre que o Cenário ORION e o DPP do mês anterior estão disponíveis no pacote.

Fluxo:

```text
Cenário ORION em memória
        +
DPP do mês anterior usado somente como molde visual
        ↓
job de exportação no backend
        ↓
OpenPyXL atualiza workbook e reporta progresso real
        ↓
mesmo workbook / mesmas folhas / estilos / larguras / formatação
        ↓
aba DPP preenchida somente com dados do Cenário ORION
        ↓
DPP_ORION_AAAA_MM.xlsx ou .xlsm
```

O **DPP Final não participa da geração do Excel ORION**.

O exportador substitui no layout anterior:

- KIT disponível PGD por modelo;
- REAL ORION por modelo;
- matriz Material × Modelo;
- descrição, UM e origem;
- Check/estado disponível;
- OPC;
- STK SAP;
- Explosão;
- STK OP;
- STK TTL;
- NEC;
- SALDO.

Materiais novos do Cenário ORION que não existiam no DPP anterior são adicionados copiando somente o estilo estrutural de uma linha de material existente; os valores preenchidos continuam vindo do cenário atual. Linhas históricas que não pertencem ao cenário atual têm os valores operacionais anteriores limpos para não carregar informação do mês passado como se fosse ORION.

O workbook é marcado para recálculo automático ao abrir no Excel.

Endpoints:

```text
POST /api/dpp/monthly/export/jobs
GET  /api/dpp/monthly/export/jobs/{job_id}
GET  /api/dpp/monthly/export/jobs/{job_id}/download
```

Campos de início:

```text
scenario_id
base_dpp   ← DPP do mês anterior
```

O percentual exibido em **Gerando Excel · NN%** vem do job real do backend. O progresso avança somente quando etapas efetivas terminam: validação do cenário, abertura do workbook, leitura da estrutura, preenchimento de KIT/REAL, processamento real das linhas de materiais, configuração de recálculo, serialização do workbook e arquivo concluído. Durante o preenchimento das linhas, o avanço é calculado pela quantidade efetivamente processada; `100%` é atribuído apenas quando o arquivo final já está pronto para download.

A geração é feita em memória; nenhum Excel corporativo exportado é gravado no repositório. Os últimos jobs de exportação e seus bytes ficam temporariamente em memória para permitir o endpoint de download e são descartados conforme o limite do cache local do processo.

## Plano consolidado por modelo

O backend lê diretamente do DPP Final as linhas:

- `KIT Disponivel PGD`;
- `REAL`.

Para cada modelo retorna:

```text
nome
PGD
REAL final
delta = REAL final - PGD
ativo
alterado
em risco
```

O frontend permite filtrar:

- Ajustados;
- Com REAL;
- Todos;
- busca por modelo.

## Indicadores atualmente calculados

- PGD do mês;
- REAL planejado;
- gap PGD × REAL;
- modelos ativos;
- materiais críticos;
- OPCs;
- modelos em risco;
- modelos sem restrição material;
- PGD exposto;
- críticos compartilhados;
- maiores gargalos por déficit;
- variação ORION → DPP Final;
- alterações de REAL por modelo no DPP Final.

### Importante: cobertura material

A métrica atual de cobertura **não mede percentual da quantidade produzível**.

Ela mede:

```text
modelos ativos sem nenhum material UN com SALDO negativo
--------------------------------------------------------- × 100
                 modelos ativos
```

Exemplo: 3 de 27 modelos = 11,1%.

O design e a microcopy devem deixar essa definição explícita para não confundir cobertura de modelos com capacidade produtiva em unidades.

## Testes do DPP

O fluxo de teste reconstrói um mês conhecido e compara contra o DPP consolidado esperado.

São verificados, entre outros:

- universo de materiais;
- modelos;
- matriz Material × Modelo / Uso BOM;
- descrição, UM e origem;
- OPC;
- KIT PGD;
- STK SAP;
- Explosão;
- STK OP;
- STK TTL;
- NEC;
- SALDO.

O REAL esperado pode ser injetado no teste para isolar a validação do motor de cálculo. Isso não valida um solver automático de REAL.

### Interface atual dos Testes

A tela de Testes foi reconstruída como uma página técnica contínua e orientada ao modelo mental de Excel/Power BI:

- um único eixo de alinhamento e largura útil centralizada para toda a página;
- cabeçalho separado em contexto do teste e fluxo Reconstrução → Comparação;
- preparação organizada em mês, contexto do pacote compartilhado e lista técnica dos arquivos usados;
- arquivos do pacote apresentados em linhas com categoria e nome do arquivo, sem bolinhas ou marcadores semânticos;
- execução isolada em faixa própria, com ação explícita de executar/reexecutar;
- status técnicos do backend são convertidos para texto legível ao usuário, sem exibir códigos como `APROVADO_COM_...`;
- veredito apresentado por hierarquia tipográfica e contexto, sem verde/vermelho, badge ou accent bar;
- REAL controlado permanece como contexto lateral do veredito, separado por divisor estrutural;
- Materiais, Matriz, KIT PGD, STK SAP, Explosão, NEC e SALDO formam uma faixa de resumo com números tabulares;
- comparação campo a campo é a superfície principal do relatório, com cabeçalho sticky e alinhamento numérico;
- Divergências ORION, Intervenções humanas e Correções do legado são seções sucessivas do mesmo relatório;
- estados vazios e avisos são notas técnicas neutras;
- o layout se reorganiza em uma coluna em larguras menores sem perder acesso às tabelas via scroll horizontal;
- temas claro/escuro e informações contextuais `i` são preservados.

## Regras determinísticas principais

```text
NEC     = Σ(REAL do modelo × consumo do material no modelo)
STK TTL = STK SAP + Explosão + STK OP
SALDO   = STK TTL - NEC
```

KIT negativo é tratado como zero.

Classificação automática completa permanece restrita enquanto regras de conversão de unidade não forem formalizadas.

## Design atual

A identidade visual possui dois temas:

### Escuro ORION

O tema foi clareado para melhorar leitura em uso prolongado sem perder a identidade azul-marinho:

- fundo `#0D1826`;
- superfície `#142235`;
- elevada `#1B2D43`;
- borda `#2B4057`;
- azul `#46D9FF`;
- verde `#27F29A`;
- texto `#F4F8FC`;
- secundário `#91A4B8`.

### Claro

Linguagem Apple preto/branco, mantendo cores semânticas apenas onde têm significado operacional.

Existe alternância Sol/Lua na barra lateral e a preferência é persistida no `localStorage`.

### Marca

A marca principal foi simplificada para reduzir aparência decorativa:

```text
SIGMA-S ★RION
```

A estrela geométrica substitui o `O` de ORION. A mesma estrela é usada como marca compacta e favicon. O antigo símbolo de planeta/órbita não faz mais parte do wordmark.

As regras normativas de design estão em **`DESIGN_SYSTEM.md`**.

## Princípios visuais obrigatórios

Resumo; a especificação completa está em `DESIGN_SYSTEM.md`:

- densidade média-alta;
- menos cards;
- cantos retos nos controles e painéis;
- sem glassmorphism;
- sem gradiente decorativo;
- sem glow;
- sombras apenas quando existe elevação física real;
- cor com função;
- microcopy específica do DPP;
- tabelas como componentes de primeira classe;
- movimento somente com propósito;
- percentual numérico somente quando existe telemetria real do processamento;
- informação contextual `i` por bloco principal do Dashboard, com O que mostra / Origem / Finalidade;
- não repetir métricas sem acrescentar leitura nova.
- sem texto semântico colorido (azul/verde/amarelo/vermelho) para estados passivos;
- sem bolinhas coloridas de OK, atenção, erro ou divergência; status são comunicados por texto, contexto e estrutura neutra;

## Segurança

O repositório é público.

Nunca versionar:

- planilhas corporativas reais;
- `.env`;
- tokens;
- chaves;
- bancos locais;
- uploads;
- dados sensíveis.

Os arquivos persistidos em IndexedDB permanecem somente no navegador/origem local do usuário; não são enviados para serviços externos por causa dessa persistência.

## Limitações atuais

- solver automático do REAL ainda não está habilitado;
- conversões `KG→G`, `M→CM` e `L→ML` ainda não estão formalizadas no motor operacional;
- investigação automática completa ainda será construída;
- jobs e cenários calculados são mantidos em memória no backend e se perdem com reinício do backend;
- não há cancelamento de job no backend;
- o pacote persistido em IndexedDB pode ser removido se o usuário limpar os dados do site/navegador;
- preparação automática de Testes pode repetir processamento pesado em alguns fluxos;
- o DPP Final é analisado por endpoint separado para comparação do Dashboard.

## Próximas direções

1. formalizar e validar cálculo de capacidade real por modelo/material;
2. evoluir investigação automática de críticos;
3. reduzir recomputações desnecessárias do pacote mensal;
4. persistir resultados/cenários temporários no backend sem duplicar planilhas corporativas permanentemente;
5. manter Dashboard orientado às perguntas do analista, evitando redundância;
6. integrar RAG/LLM somente sobre fatos já consolidados pelo motor determinístico;
7. integrar n8n quando a orquestração externa trouxer valor real.


## Atualização visual de 2026-09-28

Navegação lateral fixa e recolhível, organizada por áreas com rótulos visíveis, substitui o dock flutuante. O cabeçalho mostra o contexto atual e mantém a busca do conhecimento. O chat prioriza a conversa e oferece evidências/inspeção sob demanda. Controles de ícone são quadrados; painéis, inputs e tabelas usam tokens de radius zero. Mantidos os dois temas, o Dashboard inicial, o pacote compartilhado, endpoints e cálculos determinísticos.


## Etapa 4.1 — investigação de divergência de estoque (2026-10-13)

Primeira entrega somente investigativa, correspondente ao fluxo da reunião:
- consulta sob demanda da aba ORIGINAL do mesmo arquivo STK SAP do cenário;
- cruza materiais classificados como INVESTIGAR com M221 e P277;
- agrupa quantidades da coluna Utilização livre por PN, depósito, centro e unidade e apresenta linhas de origem;
- não soma registros com unidade divergente, quantidade inválida ou não positiva;
- informa depósitos sem registros (ausência no arquivo não prova estoque igual a zero);
- PCM/Almoxarifado permanecem responsáveis por confirmar localização, baixa e disponibilidade;
- não altera NEC, STK TTL, SALDO, REAL, cenário, nem expõe disponibilidade confirmada sem validação;
- a API é POST /api/dpp/investigations/stock-divergence e o Dashboard oferece consulta manual.

Etapa 4.2 (Qualidade), scrap, movimento de inventário, recebimento, opcionais, retrabalho e Data Lake **não** fazem parte desta entrega. A automação de decisão e recálculo de gap ficam pendentes de definição e validação do processo.

O STK do cenário mensal novo registra fingerprint SHA-256; a investigação compara o conteúdo recebido com esse fingerprint para impedir o cruzamento silencioso de snapshots diferentes mesmo com nomes de arquivo iguais. Cenários antigos sem fingerprint preservam temporariamente a validação por nome.

### Etapa 4.1 — Confirmação declarada e projeção local (2026-10-13)

- O botão Validar/Revisar abre formulário para resultado (disponível/indisponível), quantidade confirmada, indicação de contabilização no DPP, responsável PCM declarado, contato do Almoxarifado declarado e evidência.
- Registros são persistidos no SQLite (stock_depot_reviews), com histórico append-only por candidato e fingerprint SHA-256 do STK; mesmo envio repetido é idempotente.
- Quantidade confirmada deve ser positiva e menor ou igual à quantidade do depósito. Em material indisponível, zero. Disponível já contabilizado ou de contabilização desconhecida NÃO reduz o gap.
- Gap investigativo projetado = max(0, déficit original − quantidades declaradas disponíveis e NOT_INCLUDED). O cenário original não é alterado, e não ocorre movimento SAP.
- PCM e Almoxarifado não possuem autenticação de identidade no MVP, os nomes são declarações fornecidas pelo usuário.
- A etapa 4.2 e Data Lake não são implementados por esta entrega.


### Ajustes de usabilidade de Divergência de Estoque (2026-10-13)

- Título visual atualizado para "Divergência de Estoque" (a referência interna à etapa 4.1 permanece na documentação técnica).
- A resposta da consulta agora é persistida junto ao estado processado do workspace no IndexedDB e vinculada à assinatura do pacote e ao identificador/cálculo do Cenário ORION. Navegar, atualizar a página e restaurar os arquivos não exigem clicar novamente. Mudança do cálculo REAL do mesmo pacote desencadeia atualização automática da consulta; substituição/limpeza de arquivos invalida a consulta.
- O seletor do pacote passa a substituir planilhas reconhecidas da mesma categoria (ou DPP do mesmo mês) em vez de manter a versão antiga como primeiro arquivo e acrescentar duplicatas.
- Ao clicar em Validar/Revisar, a página rola até o formulário com respeito a prefers-reduced-motion.
- PCM, Almoxarifado e evidência deixaram de ser campos obrigatórios no formulário e na API. Históricos antigos preservam esses campos, quando existentes; novos registros podem guardá-los vazios sem atribuição fictícia de identidade.
- Permanecem obrigatórios apenas resultado e, se disponível, quantidade e estado de contabilização. Gap projetado segue isolado e não substitui SALDO do DPP.

### Campo Justificativa restaurado em Divergência de Estoque (2026-10-13)

- O formulário Validar/Revisar volta a oferecer **Justificativa (opcional)**, sem restaurar responsável PCM, contato do Almoxarifado ou um campo separado de evidências.
- A justificativa é persistida no campo SQLite `evidence` já existente, recuperada ao revisar o registro e exibida no histórico. A API não mudou e continua aceitando registros sem justificativa, preservando retrocompatibilidade.
- Sem impacto em estoque oficial, SALDO, REAL ou projeção do gap.

### Etapa 4.1 — Decisão do fluxograma e encaminhamento lógico (2026-10-13)

- O texto do fluxo declara: cada causa explica somente quantidade comprovada.
- Para material AVAILABLE + NOT_INCLUDED, o campo confirmed_quantity é a quantidade adicional efetivamente recuperada na projeção.
- Para UNAVAILABLE, o mesmo campo armazenado representa a quantidade indisponível especificamente justificada; justificativa textual é obrigatória apenas quando essa quantidade é positiva. Zero permanece válido como registro sem quantidade explicada. A estrutura do banco já existente não precisa de migração.
- `gap_após_recuperação = max(0, déficit_original - disponível_adicional)`; `falta_sem_justificativa = max(0, gap_após_recuperação - indisponível_justificada)`. A justificativa não é somada como estoque. Unidade permanece a do PN.
- Sem falta não explicada: `FINISHED`. Restando falta após alguma validação: `QUALITY_4_2`, sinalização lógica, reavaliável após cada revisão humana. Havendo registros sem qualquer validação: `AWAITING_VALIDATION`. Sem registros M221/P277: encaminhamento direto para 4.2.
- A lista de encaminhamento abrange também PNs sem registros em depósito. A interface apresenta o valor de cada componente e não executa a etapa de Qualidade.
- A identidade dos dados persistidos na interface recebe versão da regra para recalcular consultas antigas do navegador; SALDO oficial permanece intacto.

### Etapa 4.2 — Análise de Qualidade (2026-10-15)

- Inicia após o encaminhamento lógico de 4.1 (estado REAL/depósitos/revisões recalculados no backend; não aceita lista de PNs atribuída pelo navegador).
- Consulta Q239 e, **somente quando não há registros do PN em Q239**, consulta Q273. O saldo bruto nesses depósitos é evidência para investigação, nunca confirmação automática de liberação ou refugo.
- Q239 permite confirmar liberação, reprovação ou ausência de evidência. Liberação só reduz o gap físico projetado se comprovadamente fora do DPP. Reprovação justificada explica a falta, sem aumentar estoque.
- Q273 permite confirmar refugo ou falta de evidência; refugo comprovado e justificado só explica a causa, sem somar estoque.
- Mantém duas grandezas separadas: gap físico após liberações = max(0, gap físico vindo de 4.1 − liberação adicional CQ); falta ainda sem justificativa = max(0, falta não explicada da 4.1 − liberação adicional − reprovação justificada − refugo comprovado).
- Resultado por PN: finalizado; aguardando CQ; ou encaminhamento **lógico** para Scrap 4.3. Não executa Scrap, Data Lake nem escreve SAP/DPP.
- Confirmações em SQLite (quality_depot_reviews) com histórico imutável, identidade de cenário, snapshot de STK e linhas da origem. A interface mantém o resultado do pacote e atualiza quando mudam revisões 4.1.
- Interface e botão contextual seguem as regras de DESIGN_SYSTEM.md e knowledge/modulos-interface.md.


### Exportação das investigações de Estoque e Qualidade (2026-10-15)

- Após consultar **Divergência de Estoque** ou **Análise de Qualidade**, cada seção apresenta o botão contextual **Baixar Excel**.
- O arquivo é regenerado pelo backend a cada download a partir do cenário ORION identificado pelo `scenario_id`, do **mesmo STK SAP** validado por nome e fingerprint SHA-256 e do histórico SQLite mais recente. O navegador não envia nem determina as quantidades calculadas.
- Estoque: abas **Resumo**, **PNs investigados**, **Registros depósitos** e **Histórico validações**. Todos os PNs críticos aparecem, inclusive os não localizados em M221/P277. Depósitos, centros, unidades, origem (aba ORIGINAL, linhas), justificativas, decisões, gap físico projetado, falta sem explicação e encaminhamentos são preservados.
- Qualidade: abas **Resumo**, **PNs investigados**, **Registros depósitos**, **Q273 não investigado** e **Histórico validações**. Esta última aba informativa de Q273 documenta registros não utilizados quando há Q239 para o mesmo PN; não modifica a prioridade nem soma esses valores à recuperação de estoque.
- As abas possuem títulos, resumo de fontes e cenário, cabeçalhos legíveis, larguras limitadas, filtros, cabeçalhos congelados, números formatados e cores para os estados. Textos livres e descrições são escapados contra fórmulas no Excel.
- A construção do cenário **2026-07** continua usando DPP **2026-06** como base e as demais fontes de julho (STK SAP, Explosão, WIU, PGD de geração, OPEN opcional). DPP Final de julho só serve como referência de comparação e validação, não para alterar o cenário nem os relatórios das investigações.
- Nenhuma exportação altera SALDO, STK TTL, NEC, REAL, decisões de aprovação, arquivo-base ou SAP; relatórios são snapshots informativos do estado operacional no momento do download.
- API: `POST /api/dpp/investigations/stock-divergence/export` e `POST /api/dpp/investigations/quality/export` (multipart `scenario_id` e `stock`).

### Revisão quantitativa e de legibilidade das investigações (2026-10-15)

- Auditoria dos Excel exportados identificou necessidade de distinguir saldos de depósitos (evidências), declarações de validação, e quantidade de fato atribuível à falta por PN.
- Agora a alocação de quantidade por PN é limitada: na etapa 4.1, confirmações disponíveis fora do DPP são atribuídas primeiro; justificativas de indisponibilidade só podem explicar a falta restante. Na etapa 4.2, liberações são limitadas à falta ainda não explicada da etapa anterior, seguidas de reprovação ou refugo justificado.
- Cada relatório e o Dashboard preservam **quantidade confirmada bruta** e mostram separadamente **quantidade aplicada ao gap**. Excedentes de quantidade confirmada não contam como nova recuperação ou justificativa do déficit. Causas e unidades não são somadas entre PNs diferentes.
- A cobertura potencial teórica por PN é limitada à falta individual e explicitamente identificada como **não validada**. O resumo do Excel agrega indicadores somente por unidade de medida e inclui PNs sem registro em M221/P277 no denominador de falta.
- Quando ainda há validações pendentes em qualquer depósito da etapa 4.1 ou da Qualidade, o encaminhamento/conclusão é rotulado **provisório**; etapas posteriores não são executadas automaticamente pelo simples status.
- O relatório Excel identifica o saldo como **SALDO Cenário ORION**, jamais o DPP Final já preenchido. Nas abas detalhadas mantém-se a fonte exata de cada quantidade (STK ORIGINAL), os IDs e histórico das revisões.
- Para impressão, planilhas largas não são mais comprimidas em uma única página A3: a configuração distribui o número de colunas em até duas ou três larguras, preservando legibilidade.
- Esses ajustes não introduzem o Data Lake, movimentação SAP, edição do DPP oficial, nem análise de Scrap 4.3.


### Paginação das investigações de Estoque e Qualidade (2026-10-16)

- As tabelas de registros por depósito e de resultados/consolidação por PN das etapas 4.1 e 4.2 possuem paginação local compartilhada, com 10 linhas por página (opções 25 e 50).
- Cada tabela tem paginação independente com faixa exibida, quantidade total, página atual e controles Primeira/Anterior/Próxima/Última.
- Trocar pacote ou cenário reinicia a paginação; a revisão de um candidato não apaga a página corrente. Navegar entre páginas de registros fecha o formulário de validação aberto para não manter um formulário de um registro fora da página visível.
- Indicadores gerais, decisões salvas e download Excel continuam referentes a **todos** os PNs e depósitos da investigação. Nenhum dado é removido, filtrado do backend ou alterado no DPP.
- Testes de paginação executam no frontend CI com Node antes do build Vite.

### Correção dos depósitos de investigação de estoque (2026-10-19)

- A etapa 4.1 considera exclusivamente os depósitos **M221** e **P277**, conforme correção operacional do usuário. Não inferir depósitos adicionais a partir do fluxograma anteriormente importado.
- Textos de interface, referência de conhecimento, resumo da API, relatório Excel e testes foram alinhados à mesma lista de dois depósitos.
- O cache local da investigação recebeu uma nova versão para evitar reutilização de relatórios produzidos com a regra anterior. A etapa 4.2 parte somente do encaminhamento atual recalculado pelo backend, portanto é atualizada a partir do novo relatório.
- Depósitos fora da configuração são ignorados no cruzamento e não acrescentam quantidade, nem justificativa, nem encaminhamentos. O arquivo STK de origem e o histórico imutável de validações não são apagados.
- Nenhum impacto nas fórmulas de NEC, SALDO, STK TTL ou REAL, nem movimentação SAP.

### Resumo único das investigações e Excel simplificado (2026-10-19)

- O Dashboard ganhou um resumo operacional conjunto de Divergência de Estoque e Qualidade, com contagem de PNs críticos, PNs encontrados, encaminhamentos, validações pendentes e totais quantitativos separados por UM. Dados não consultados aparecem como indisponíveis, não como zero.
- As duas seções usam os títulos **PNs e divergências** e **Confirmar com área**, idênticos às abas dos dois relatórios Excel.
- Cada exportação possui **três abas somente**: **Resumo**, **PNs e divergências** e **Confirmar com área**. A aba Resumo oferece indicadores espelhados do Dashboard e visão integrada de Estoque e CQ por unidade de medida, inclusive fontes e notas de leitura.
- PNs e divergências consolida déficits, quantidades reais encontradas por depósito, cobertura potencial, validação aplicada ao gap, saldo remanescente e ação. Todos os PNs do escopo são apresentados, inclusive ausentes dos depósitos pertinentes.
- Confirmar com área contém lista operacional de achados individuais no STK ORIGINAL para o analista solicitar confirmação a PCM/Almoxarifado ou Qualidade/CQ; identifica material, centro, depósito, quantidade, linha, decisão, justificativa e histórico de revisões na mesma aba.
- Q273 com Q239 prioritário continua informativo e não entra em somas de CQ. Não se supõe Scrap confirmado na ausência de registro; SALDO/REAL/NEC e DPP final permanecem intactos.
- As duas exportações são reconstruídas pelo backend com os estados atuais de Estoque e Qualidade no mesmo cenário e snapshot STK; o botão de download exporta toda a população independentemente da página visível.


### Refatoração visual do Dashboard do DPP (2026-10-19)

- Escopo **exclusivamente frontend**: a página web do DPP, as seções Divergência de Estoque e Análise de Qualidade. Nenhum endpoint, cálculo, fonte, regra de classificação, banco SQLite, cache persistente ou geração de Excel foi alterado.
- O cabeçalho do cenário passa a mostrar quatro KPIs legíveis: PGD, REAL, gap PGD×REAL e PNs críticos. Comparação ORION×DPP Final e demais análises permanecem acessíveis em um agrupamento expansível, usando cards responsivos, sem tabela visual.
- **Resumo operacional**: KPIs do fluxo completo (negativos, encontrados, pendentes por área, encaminhados ao CQ) e grupos quantitativos por unidade de medida. Não apresentar dados de investigação não consultada como zero.
- **Divergência de Estoque**: fila de confirmação com PCM/Almoxarifado para registros encontrados e não validados; lista somente de PNs encontrados em M221/P277, com cards expansíveis por PN, busca/filtro, quantidade encontrada, cobertura teórica, recuperação aplicada, gap recalculado, falta residual, evidências e formulário original de validação.
- **Análise de Qualidade**: fila análoga para Qualidade/CQ; lista somente de PNs encontrados em Q239/Q273, com gaps por PN, decisões de liberação/reprovação/refugo, busca e validação na mesma UI. Ausência de registro é contada no resumo, não tratada como scrap confirmado.
- Filas e cards podem ser paginados independentemente (10/25/50), com espaço flexível e colunas responsivas (notebook em uma coluna; monitor grande em duas).
- Exclusividade da apresentação: os relatórios Excel **continuam idênticos**, com abas `Resumo`, `PNs e divergências` e `Confirmar com área`; quantitativos e registros do Excel permanecem completos, inclusive sem achados.
- Testes de apresentação determinística no Node adicionados ao pipeline de frontend para assegurar ordenação de pendências, filtros, ausência de PNs sem registros na lista e agregação sem misturar UM.

### Refinamento de contraste e leitura do Dashboard DPP (2026-10-19)

- Atualização **somente no frontend**: títulos com ícones SVG pequenos e acessíveis (decorativos `aria-hidden`), maior separação entre as seções, superfícies em tons derivados dos tokens do ORION e destaque contido no resumo dos PNs encontrados.
- Novo indicador visual da proporção de **PNs encontrados versus PNs investigados**, com rótulos e valores absolutos. Barras de PN individuais exibem a parcela teórica da falta para a qual existem registros, sem qualquer inferência de disponibilidade.
- A tela distingue visualmente o cenário inicial, resumo operacional, filas de confirmação com Almoxarifado/CQ, cards encontrados e comparações complementares. Os links entre seções e o retorno ao resumo reduzem rolagem manual.
- Espaçamento e rearranjo responsivo seguem os tokens existentes; ícones não denotam sucesso, risco ou status. Cores semânticas passivas continuam proibidas.
- Não houve alteração no backend, cálculos, registros SQLite, dados do DPP ou nos geradores de Excel. As três abas e a estrutura dos relatórios permanecem integralmente as mesmas.
- Testes Node cobrem limites das barras de proporção, inclusive casos sem déficit; CI frontend executa os testes e o build Vite.

### Correção de estilo anti-interface genérica (2026-10-19)

- Revisão dirigida por `DESIGN_SYSTEM.md` e pela captura enviada pelo usuário: retirados os ícones SVG de cabeçalhos que estavam em quadrados com fundo/borda azul. O exemplo do ícone de Estoque era uma ornamentação, não um controle funcional.
- Retiradas trilhas visuais redundantes com ícones e setas, além das barras quantitativas repetidas em cada card de PN. Ícones SVG menores sobrevivem somente em atalhos de navegação efetivos (Estoque, Qualidade e voltar ao resumo).
- Ajustada a apresentação de métricas do cenário e das investigações para faixas com divisores internos em vez de múltiplas caixas individuais com bordas e fundos azulados. Filas de trabalho usam seções neutras e divisores, mantendo foco no PN e na ação.
- As duas barras agregadas de PNs encontrados na visão geral foram mantidas por conterem informação medida, explicitamente não validada; preservados os textos e valores absolutos.
- Mantidos tema claro/escuro e comportamento responsivo. Não houve mudanças no backend, lógica determinística, dados do DPP, decisões ou exportações Excel.
- Teste estático adicional verifica que não reaparecem tiles decorativos de ícones nem trilha ilustrativa redundante no Dashboard.

### Remoção definitiva do tile decorativo do cabeçalho do DPP (2026-10-19)

- O cabeçalho principal usa a estrutura explícita `dashboard-primary-heading`: texto simples `Cenário inicial do DPP` seguido apenas de `ModuleInfoHint` (controle `i`).
- Removida a classe `orion-visual-dashboard-header` herdada da experiência de ícones com caixa e suas regras CSS. O código atual já não incluía o SVG decorativo no JSX; a limpeza elimina a identidade visual antiga do cabeçalho e acrescenta um teste direto sobre a sua composição.
- O controle contextual `i` mantém fundo transparente e borda neutra no CSS existente. Nenhum ícone de marca/depósito foi adicionado ao título.
- Alteração apenas de marcação, CSS, documentação e teste do frontend; não modifica dados, cálculos, endpoints, decisões ou Excel.
- Para visualizar a alteração, o navegador deve carregar o build/branch atualizados; uma cópia local anterior continuará exibindo a versão antiga mesmo após o commit no GitHub.

### Recálculo mensal do gap após Estoque e Qualidade (2026-10-19)

- O serviço dpp_monthly_gap_service.py recompõe as investigações e revisões efetivas do SQLite com o mesmo cenário e STK, produzindo uma projeção para **todos os materiais** do DPP em construção.
- A API POST /api/dpp/monthly/gap/recalculate recebe scenario_id e o STK original. O navegador não fornece quantidades a creditar. Cada recuperação confirmada fora do DPP fica limitada ao déficit residual do PN, sem misturar UM.
- Para cada PN são apresentados SALDO original e projetado, falta inicial, recuperação confirmada em M221/P277, falta após Estoque, indisponibilidade justificada, recuperação em Q239/Q273, reprovação/refugo justificado no CQ, falta física após Qualidade e falta sem explicação. Justificativas não são convertidas em estoque.
- A projeção cobre também materiais positivos e negativos fora do escopo UN; nesses últimos nenhuma recuperação automática é atribuída. Totais agrupados por UM.
- O Dashboard inclui Gap recalculado do DPP após Estoque e Qualidade, com botão Recalcular gap e atualização automática após mudanças nas revisões registradas. A tela resume toda a população e detalha apenas os PNs com alteração confirmada.
- Não executa a investigação posterior de Scrap, não altera NEC/REAL/STK TTL/SALDO oficial, nem modifica o Excel do DPP ou os relatórios de investigação. O resultado é uma projeção separada e auditável, não uma materialização silenciosa em exportação.
- Testes cobrem limites, preservação do cenário, PNs não localizados, UMs fora do escopo e as revisões reais pelas APIs.


### Aplicação confirmada do gap ao DPP de julho (2026-10-19)

- Separadas duas ações: **Atualizar prévia** (somente leitura) e **Conferir e aplicar ao DPP** (prévia de aprovação com diálogo nativo, confirmação inequívoca).
- Novas rotas `POST /api/dpp/monthly/gap/prepare` e `POST /api/dpp/monthly/gap/apply`. O servidor recompõe as validações atuais de Estoque e CQ pelo cenário e fingerprint STK; nunca aceita números de ajuste do navegador.
- Aplicação bloqueada por qualquer candidato encontrado em M221/P277 ou Q239/Q273 sem decisão humana registrada. PNs sem nenhum registro não se tornam automaticamente validados: continuam com falta real e sem ajuste. Quando existem PNs sem explicação, há ciência explícita adicional na janela; não se inventa disponibilidade.
- O token de aprovação é derivado de cenário, STK, resultado completo e IDs das revisões efetivas de ambos os processos. Mudanças entre conferência e aplicação invalidam o token. Confirmar não é disparado automaticamente.
- A aplicação aprovada **cria um novo ID de cenário mensal**, preservando o anterior como uma versão histórica recuperável após reinício. O cenário anterior é imutável sob esse fluxo; o novo contém metadados de aprovação (data UTC, STK SHA256, origem, quantidade/UM e quantidade não explicada).
- O motor determinístico do novo cenário acrescenta exclusivamente a disponibilidade **confirmada e fora do DPP** como componente `approved_gap_added_stock` em STK TTL. Atualiza, por consequência, SALDO/Amount, status dos PNs e indicadores do cenário completo. NEC, REAL, EXPLOSÃO e os valores brutos do STK SAP permanecem iguais. Quantidade indisponível/reprovada/refugo CQ justificada fica no histórico, sem acrescentar saldo.
- O Excel mensal **da versão aprovada** mantém o layout existente do DPP; a fórmula de STK TTL passa a buscar acréscimos na aba técnica oculta `ORION_CONFIRMACOES` contendo PN, Estoque confirmado, CQ liberado, total adicional e referência de auditoria. SALDO/Amount continuam fórmulas dependentes, reaplicadas e auditadas pelo pipeline canônico. O Excel anterior não é alterado.
- A aplicação original é protegida contra execução repetida e falha caso a persistência da aprovação não esteja disponível; sem mensagem falsa de sucesso.
- O frontend exibe o estado `GAP_APLICADO`, a origem do cenário e os quantitativos da aplicação. Mantido o design sóbrio de acordo com `DESIGN_SYSTEM.md` (sem ícones encaixotados).
- Testes de ponta a ponta incluem bloqueio por Estoque/CQ, confirmação obrigatória, ciência sobre faltas não resolvidas, invalidação por revisão nova, dupla aplicação, persistência após reinício, recálculo do cenário e auditoria das fórmulas do Excel exportado.


### Abas explicativas de Estoque e Qualidade nos relatórios Excel (2026-10-20)

- Os botões **Baixar Excel** de Divergência de Estoque e Análise de Qualidade agora geram **cinco abas**: as três originais (Resumo, PNs e divergências, Confirmar com área) e duas novas (Divergência de Estoque, Análise de Qualidade).
- Ambos os downloads incluem as duas investigações recalculadas pelo backend a partir do mesmo cenário, do STK SAP ORIGINAL e do histórico SQLite. As abas operacionais originais permanecem disponíveis para revisão granular do processo correspondente ao botão acionado.
- A aba **Divergência de Estoque** apresenta todos os PNs críticos, inclusive os sem registros em M221/P277, saldo inicial, falta, quantidades brutas por depósito, cobertura não validada, disponibilidade adicional aplicada, justificativas, faltas remanescentes, pendências e linhas de origem no STK.
- A aba **Análise de Qualidade** apresenta apenas PNs efetivamente encaminhados pelo Estoque, Q239 e Q273 ativos, Q273 meramente informativo quando Q239 tem prioridade, liberação adicional aplicada, reprovação/refugo justificado, faltas remanescentes, pendências em CQ/Estoque e linhas de origem.
- O Resumo ganhou descrições dos depósitos, dos critérios de atribuição ao déficit, das regras de prioridade Q239/Q273 e da diferença entre evidência SAP e liberação validada.
- Não houve alteração de regras do motor, decisões SQLite, fontes, endpoints, planilha DPP canônica ou automação de Scrap. As novas abas são somente leitura e não representam ajuste automático do SALDO oficial.
