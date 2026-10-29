# SIGMA-S ORION — Estado atual do projeto

## 29/10/2026 — Referências a resultados agregados no Agente ORION

O roteador anterior interpretava a pergunta "Como você chegou nesse resultado?"
após uma tabela de materiais críticos como referência ao **último PN listado**,
pois `last_entities` continha as últimas linhas de uma coleção e a resolução
dêitica priorizava a última entidade em vez do assunto da resposta.

A correção preserva o **foco da coleção** em sessão (24h) e resolve perguntas
sobre "esse resultado", "esse total", "essa lista", "essa tabela", além de
justificativas curtas, para a consulta agregada anterior. A resposta sobre
criticidade agora retorna a cadeia determinística completa:
NEC (REGRA-001), STK TTL (REGRA-002), SALDO (REGRA-003), filtro de UM=UN
e SALDO<-0,0001 (REGRA-004), com contagem consultada novamente nas
entidades SQLite atuais. Não usa o último PN da tabela como referência
implícita, mas respeita códigos explicitamente informados.

A resposta explicativa não necessita LLM nem expõe um número fixo: a contagem
muda com o Cenário ORION sincronizado. Preserva fontes, tabelas originais,
auditoria SQLite, consultas pontuais e retenção de conversa existente.
Regressão: `backend/tests/test_database_chat_context.py`.
Não altera o cálculo DPP, o DPP Final ou qualquer confirmação humana.


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


### Revisão do escopo de abas do Excel por indicador (2026-10-20)

- Esta regra **substitui** a proposta imediatamente anterior de cinco abas integradas e as versões antigas com três abas genéricas. O usuário solicitou que cada botão **Baixar Excel** exporte exatamente os cinco indicadores do *seu próprio painel* e os PNs que formam suas contagens.
- **Divergência de Estoque:** `PNs Críticos`, `PNs Encontrados`, `Aguardando Almoxarifado`, `Sem Registros`, `Encaminhados à Qualidade`.
- **Análise de Qualidade:** `PNs Recebidos`, `Encontrados Q239`, `Encontrados Q273`, `Aguardando CQ`, `Sem Registros nesses depósitos`.
- Cada aba tem uma linha por PN, todos os materiais da categoria e colunas de descrição, UM, déficit, depósitos, quantidades brutas, confirmação humana, parcela aplicada ao gap, falta remanescente, evidência com centro/linhas STK ORIGINAL, status, próxima ação e histórico de decisões.
- Aguardando Almoxarifado / CQ corresponde à contagem de PNs únicos com ao menos um candidato ativo pendente (`!candidate.validation`), inclusive os que já foram provisoriamente encaminhados, tal como o frontend.
- Indicadores não são necessariamente disjuntos; um PN pode estar em mais de uma aba. `Encontrados Q273` usa apenas depósito ativo Q273 quando não existe Q239. Q273 com Q239 prioritário continua descrito no histórico/evidência, mas é informativo, sem somar ou atribuir ao déficit.
- Os PNs do Excel são derivados do backend e independem da paginação, filtros e busca do frontend. Nenhuma movimentação SAP, nova fonte, recálculo do DPP final nem mudança de fórmula é feita na exportação.


### Painéis compactos com modais por indicador (2026-10-20)

- Interface do Cenário Inicial organizada em um único painel contendo título e quatro métricas já existentes.
- Resumo Operacional mantém seis métricas: negativos, encontrados Estoque, aguardando Almoxarifado, encaminhados Qualidade, encontrados CQ e aguardando Qualidade. Barras, sequências de gap e links de fila foram retirados da visão inicial.
- As duas investigações exibem somente os cinco indicadores derivados dos relatórios atuais, com clique que abre diálogo nativo. Removidas da tela listas paginadas e cards expansíveis por PN. Modal exibe os PNs de cada categoria (inclusive sem registros), detalhes completos e formulário original de confirmação por depósito.
- Na interface dos modais, borda amarela identifica registros sem `candidate.validation`; borda azul identifica decisões humanas persistidas. PNs sem registro não simulam validação. Após salvar, a fila/categoria é recalculada com os dados do backend e o histórico continua disponível.
- O Gap recalculado move detalhamento por PN e unidade para modais acionados pelos quatro KPIs. Confirmação de aplicação permanece separada e auditável. A versão já aprovada oferece diálogo de auditoria por indicador.
- Não modifica Pacote do mês, ORION × DPP Final, regras determinísticas, endpoints, SQLite, confirmações de área, backend nem as exportações Excel.
- Esta seção prevalece sobre a documentação histórica de paginação e filas da página web.


### Dashboard enxuto e abertura robusta dos modais (2026-10-20)

- Esta é a decisão visual **vigente**, que substitui referências históricas deste documento a um painel de Gap recalculado visível, às métricas complementares recolhíveis e ao comparativo completo de colunas no Dashboard.
- Retirados **do frontend renderizado**: `DppGapProjection`, `DppColumnComparison` e o grupo recolhível `Ver indicadores complementares`. Serviços Python, endpoint de projeção, histórico de decisões, documentos de conhecimento e os cálculos de DPP permanecem no repositório; a ação de aplicação do gap existente naquele painel não fica mais acessível por esse Dashboard.
- Mantido **sem alterações funcionais** o `FinalModelPlan` (Plano consolidado por modelo ORION × DPP Final), incluindo busca, filtros e explicação das divergências.
- O Pacote do mês usa, **apenas em modo compacto**, grade responsiva com quatro, três, duas ou uma coluna conforme a área útil; nomes completos de arquivos podem ser lidos por tooltip. A versão completa de carregamento mantém sua lista.
- A composição visual do Dashboard foi simplificada: Cenário inicial com quatro métricas, Resumo Operacional com seis, investigações com cinco cards cada, mais o pacote e o plano consolidado. Margens duplicadas e o espaçamento antigo de 24–40 px entre módulos foram reduzidos para 8–12 px por meio de tokens existentes.
- A não abertura dos diálogos estava ligada ao `onClose` nativo disparado pelo `close()` na limpeza do efeito durante o ciclo de desenvolvimento do React StrictMode. O componente agora usa `createPortal`, `useLayoutEffect` e trata Fechar/Escape/backdrop explicitamente; a limpeza interna do efeito não reseta a categoria selecionada.
- Os relatórios de cinco abas por área, controles de validação humana e regras do STK ORIGINAL não foram alterados.


### Sidebar ORION e background Mondial (2026-10-20)

- Na sidebar, tema claro invertido para fundo preto e texto/ícones primários brancos, tema escuro alterado para azul da estrela `#46D9FF` com textos cinza de apoio, principais escuros e estrela invertida para garantir contraste. Nenhum token global foi alterado.
- A estrela da marca em `BrandLogo.jsx` virou o único toggle da sidebar (botão acessível), removendo o botão de alternância do cabeçalho e o botão de fechamento móvel. Permanece acessível no rail de 64 px e no menu aberto.
- `sidebar-theme.css` implementa a imagem de fundo em camada separada, com opacidade controlada por tema e sem interceptar cliques. O JPG **não foi inserido** porque o usuário ainda não anexou o arquivo. A integração já aponta para `frontend/public/assets/mondial-sidebar.jpg` e a pasta inclui instruções de upload.
- Os módulos do Dashboard, motor Python, planilhas e fluxos operacionais permanecem intactos. A navegação fica íntegra mesmo sem o arquivo de imagem.


### Inversão do tema escuro e acessibilidade da sidebar (2026-10-20)

- Implementada inversão visual do tema escuro, **globalmente**: fundo/painéis azul ORION `#46D9FF`, texto principal azul-marinho `#08111F`, secundário azul-petróleo `#28546B`, bordas `#2A7894` e elevado `#83E8FF`. Estilo `frontend/src/orion-inverted-dark.css` é carregado após as demais folhas; controles primários, foco e marcação de validação possuem contraste azul-marinho. Tema claro permanece inalterado.
- `BrandLogo.jsx` usa um botão único envolvendo **todo o wordmark** da marca para abrir/recolher a sidebar quando expandida; no rail recolhido a mesma ação exibe só a estrela. Mantidos `aria-controls` e `aria-expanded`.
- Na sidebar escura, rótulos secundários deixam de ser cinza para usar o mesmo azul-marinho do wordmark; scrollbar invisível em Firefox/Chromium/WebKit, preservando rolagem por wheel/touch/teclado.
- O cabeçalho dos diálogos de PN fica `sticky` em `top:0`, preservando o botão **Fechar** após rolar conteúdo extenso.
- Sem alterações em cálculo DPP, consultas STK, persistência ou exportações Excel; foto Mondial continua pendente de arquivo autorizado do usuário.


### Refinamento do tema escuro com base em capturas reais (2026-10-20)

- Usuário confirmou a imagem da Mondial instalada; o modo claro com sidebar preta foi considerado visualmente adequado e não foi alterado.
- A inversão anterior (ciano em fundo e painéis simultaneamente) não apresentou hierarquia adequada nas capturas. Foi removida a folha `orion-inverted-dark.css`.
- O modo escuro reintroduz fundo `#0D1826`, painéis `#142235`, superfícies elevadas `#1B2D43`, textos principais `#F4F8FC` e auxiliares `#91A4B8`, em `orion-dark-refinement.css`; ciano `#46D9FF` permanece na sidebar, na identidade e nas ações primárias.
- O comportamento do wordmark, a scrollbar oculta, o fechamento fixo de modais, a foto da sidebar, o Dashboard de KPIs, a investigação e as exportações foram preservados.


### Paleta escura Mondial em preto e branco (2026-10-21)

- A terceira revisão cromática foi orientada por captura real: azul-claro integral e tons azul-marinho nos painéis não entregaram o contraste/harmonia pretendidos.
- Paleta escura **vigente**: sidebar quase preta `#090A0C`, letras brancas `#F5F5F6`, foto Mondial em fundo discreto, estrela ciano `#46D9FF`. Área de trabalho grafite `#191A1D`, painéis `#242529`, elevado `#2E3035`, bordas `#404249`, secundários `#BBC0C8`. Ações primárias brancas com letras escuras, outras cinza; ciano reservado ao símbolo e interações pontuais.
- Ajustes somente em `orion-dark-refinement.css`, `sidebar-theme.css`, testes de design e documentação; sem alterações no tema claro, funcionalidades, arquivos corporativos, cálculos nem Excel.
- Esta regra substitui as paletas azul-marinho/ciano apresentadas nos históricos acima.


### Alinhamento operacional, consultas automáticas e prevenção de estado expirado (2026-10-21)

- Retirada da árvore renderizada do Dashboard a seção “Cenário inicial do DPP” (quatro métricas); “Resumo Operacional” assume a primeira posição sem mudar seus seis KPIs. Resumo, Estoque e Qualidade foram alinhados à caixa do Pacote do mês: borda total, padding 16 px e heading de mesma escala; gap vertical 12 px/8 px em telas menores.
- Removidos os botões de reconsulta dos módulos Estoque e Qualidade. Fluxo sequencial de geração DPP → consulta automática Estoque M221/P277 → consulta automática Qualidade Q239/Q273 dos PNs encaminhados, sem submissão manual; Excel e validação humana continuam.
- Corrigida a condição inicial da 4.1 que aguardava um cache de Estoque preexistente antes de iniciar sua primeira consulta. Falhas temporárias das investigações podem ser reconsultadas ao focar/retomar a aba.
- Backend: `dpp_scenario_service.py` registra snapshots v3 de todas as até oito versões de cenário ativas, preservando leitura dos registros antigos v2; endpoint `GET /api/dpp/monthly/scenarios/{scenario_id}/availability` verifica somente a identidade real mantida no servidor.
- Frontend: `useScenarioAvailability.js` verifica servidor no primeiro carregamento, retorno da aba/foco, periodicamente e ao solicitar abertura do modal, evitando exibir indicadores antigos como válidos depois da expiração ou substituição do cenário. Comparação com assinatura do pacote impede cruzamento entre meses e arquivos.
- Em cenário realmente ausente: ocultar todos os números da investigação e disponibilizar “Tentar recuperar cenário” ou “Reprocessar pacote salvo” usando arquivos mantidos no IndexedDB. Não copiar confirmações humanas SQLite de um ID para outro; avisar sobre isso, sem atualização silenciosa do DPP oficial.
- Sem alterações nas regras determinísticas de NEC, REAL, SALDO, STK TTL, Amount, validação de PN ou nas 5 abas por exportação Excel.


### Dashboard em duas faixas responsivas — Etapa 1 (2026-10-21)

- Layout do Dashboard reorganizado em duas faixas: Resumo Operacional (37%) + Pacote mensal (63%) em desktop amplo; Estoque + Qualidade lado a lado em telas amplas, com empilhamento responsivo. O Plano Consolidado por Modelo permanece em largura total.
- A primeira faixa só apresenta o Resumo para um cenário confirmado e não aprovado; caso contrário, o pacote aparece sozinho. O fluxo existente de verificação/recuperação de cenário foi preservado, sem mostrar dados de investigação potencialmente expirados.
- Indicadores de Estoque/CQ ficam menores, ainda acionáveis, com rótulo acessível completo. As mesmas cinco categorias/modais de cada investigação permanecem, sem mudança de contagens, decisões e relatórios Excel.
- O painel funcional de Pendências previsto na composição final ainda **não foi implementado**: para evitar espaço vazio ou métricas duplicadas, Estoque/CQ dividem a segunda faixa temporariamente. Os modais ainda têm o comportamento anterior de rolagem e backdrop.
- Composição explícita no JSX e CSS central em `dashboard-hierarchy.css`; não houve alteração em backend, regras, dados, consultas automáticas, endpoints nem planilhas empresariais.


### Modais de Estoque e Qualidade com rolagem isolada — Etapa 2 (2026-10-21)

- `InvestigationModal` continua com portal e `<dialog>` nativo, preservando foco, Escape, botão Fechar, busca e validações humanas. A rolagem deixa de acontecer no elemento inteiro: somente `.orion-investigation-dialog-content` é rolável, mantendo título, Fechar e pesquisa fixos.
- `modal-scroll-lock.js` aplica e restaura o bloqueio da página (incluindo Safari móvel), preserva a posição de rolagem e usa contagem de referências para não liberar o scroll na presença de outro modal. Cleanup de `StrictMode` não remove seleção de KPI.
- Backdrop escurecido com desfoque funcional discreto de 3 px; alternativa sem filtro em `prefers-reduced-transparency`. Os temas claro e escuro continuam baseados nos mesmos tokens.
- Acrescentados testes de isolamento de rolagem, liberação idempotente, múltiplas travas e estrutura do diálogo. Sem mudanças em backend, relatórios Excel, regras determinísticas ou painel de Pendências (etapa futura).


### Painel de Pendências com navegação por PN — Etapa 3 (2026-10-21)

- As investigações de Estoque e Qualidade ficam empilhadas à esquerda (62%) e o painel Pendências de validação à direita (38%) em desktop. Empilhamento responsivo em notebooks e dispositivos menores; a comparação ORION × DPP Final permanece integral.
- O novo painel deriva PNs únicos dos mesmos grupos de pendência das investigações e distingue consulta indisponível de zero realmente conhecido. Os atalhos por PN e "Ver todos" abrem o modal original, incluindo checagem de disponibilidade do cenário antes de mostrar decisões.
- O Resumo e a nova fila reutilizam o seletor de relatórios por identidade de pacote e revisões, sem chamadas adicionais a backend, cálculos no navegador ou mudanças no Excel. A categoria é filtrada pelo PN selecionado, com possibilidade de pesquisar normalmente no modal.
- Atualizados os testes de layout e adicionados testes determinísticos para seleção de relatórios e composição das filas. Fica fora do escopo o refinamento visual geral da Etapa 4.


### Auditoria visual responsiva e limpeza CSS — Etapa 4 (2026-10-21)

- Revisadas hierarquia, bordas de métricas, alinhamento do painel Pendências, quebra de textos longos e responsividade das fontes do Plano Consolidado em telas menores. A tabela mantém sua rolagem horizontal isolada.
- `dashboard-visual-rhythm.css` mantém apenas classes atualmente montadas; estilos históricos de coberturas, filas, métricas iniciais e painéis ocultos foram eliminados. O entrypoint deixou de carregar quatro CSS legados usados exclusivamente pelas antigas seções de KPI, risco, PGD x REAL e correções de tema dessas seções. Os estilos restantes de Dashboard, modais, temas e Excel não foram alterados.
- Incluído teste estático para evitar retorno de imports antigos, inversão visual da ordem do DOM ou bordas sobrepostas. Sem mudanças nos relatórios, validações humanas, identidade do cenário, endpoints, regras determinísticas ou exportações.


### Ícones SVG lineares nos cabeçalhos (2026-10-21)

- Adicionado o componente `DashboardModuleIcon.jsx` com quatro desenhos inline para títulos de Pacote mensal (somente versão compacta), Estoque, Qualidade e Pendências.
- A apresentação usa `dashboard-module-icons.css`: traço 1,7 px, 20 × 20 px, cor secundária do tema, sem tiles, fundos, bordas ou sombras. Os SVGs são ocultos da árvore acessível porque o título textual já identifica o módulo.
- Não alterados Resumo, KPIs, PN, comparação ORION × DPP Final, consultas, cálculos, validações humanas, Excel ou estrutura do layout. Teste estático adicionado à suíte existente.


### Acentos ciano funcionais no Dashboard escuro (2026-10-21)

- Aplicado o token existente `--orion-blue` somente aos quatro SVGs de identificação, ao link `Ver todos` das Pendências e, nos estados de hover/foco, aos títulos dos indicadores acionáveis Estoque/CQ e aos códigos PN da lista de Pendências.
- O conjunto está centralizado no novo `frontend/src/dashboard-interaction-accents.css`, escopado ao Dashboard do tema escuro e carregado após `orion-dark-refinement.css`. Não altera o tema claro, números, descrições, arquivos, bordas, botões de exportação ou a comparação por modelo.
- Acrescentado contrato estático à suíte frontend para garantir seletor por tema e uso do token em vez de cores duplicadas. Nenhuma lógica operacional ou endpoint modificado.


## Agente ORION — sincronização das investigações do Dashboard (2026-10-29)

- A página do Agente recupera exclusivamente os relatórios correspondentes ao cenário, pacote e revisões atualmente válidos no Dashboard (mesma chave de `currentInvestigationReports`).
- O endpoint `/api/knowledge/workspace/sync` passa a indexar resumos e evidências por PN de Estoque (M221/P277) e Qualidade (Q239/Q273 ativos), mantendo dados de candidatos, centros, linhas ORIGINAL, decisões e históricos. Relatórios de cenário diferente ou STK com filename incompatível são ignorados.
- A versão/fingerprint do workspace acompanha revisões humanas: uma nova decisão em Almoxarifado ou CQ substitui os fatos de investigação no SQLite/RAG, sem alterar o Cenário ORION ou o DPP Final.
- O chat dispõe de consultas determinísticas para os indicadores do Resumo Operacional, cinco categorias de Estoque e cinco de Qualidade e detalhes por PN. Q239 prevalece; Q273 paralelo é apenas evidência informativa. Sem relatório vigente, o chat indica indisponibilidade, não zero.
- O Agente não faz validação humana, movimentação SAP, análise posterior de Scrap ou recálculo independente de gap. Outros dados do Dashboard (materiais, modelos, cenário, DPP Final e comparação) continuam nas entidades já existentes.
- Cobertura de regressão: `backend/tests/test_agent_investigation_queries.py`.


## Ampliação do Agente — glossário, calendário e perguntas independentes (2026-10-29)

- A resolução de definições curtas consulta `knowledge/glossario.md` por correspondência exata de termo, sem depender de ranqueamento lexical ou da interpretação da LLM. PN e PGD recebem definições operacionais, e as limitações locais de Open PO, PCP e PCPM ficam explícitas.
- O relógio do backend passa a responder data e hora atuais no fuso `ORION_TIMEZONE` (padrão `America/Manaus`) com fonte de runtime e registro de auditoria, independentemente da LLM.
- Perguntas independentes separadas por `?` e com intenção de definição/data podem receber respostas individuais em uma única mensagem, reunindo evidências; combinações matemáticas/causais seguem sob o planejador composto anterior.
- O contrato `ChatResponse` mantém no máximo uma tabela; caso duas partes tenham tabelas, elas são representadas em um único conjunto combinado com a origem da consulta em cada linha.
- Testes: `backend/tests/test_agent_domain_definitions.py`; teste de abstinência do RAG atualizado para fatos realmente fora do domínio.

## Encadeamento de investigação por criticidade (2026-10-29)

- Serviço `database_critical_investigation_chain_service.py` faz o ranking auditável dos PNs com UM = UN e SALDO < -0,0001 a partir do Cenário ORION sincronizado, sem recálculo da NEC/STK pelo LLM.
- Perguntas sequenciais podem listar críticos, explicar a contagem e as REGRA-001/002/003/004, pedir os maiores déficits por valor absoluto de SALDO negativo e aprofundar o PN por código exato ou posição no ranking anterior.
- A investigação do PN exibe NEC/STK TTL/SALDO, déficit inicial derivado e sinais disponíveis de M221/P277 e Q239/Q273, identificando relatórios ausentes como indisponíveis e quantidades brutas como não liberadas automaticamente. Q273 paralelo ao Q239 permanece informativo.
- O contexto do SQLite armazena somente o escopo, os PNs ordenados e o PN selecionado, preservando a retenção de 24 horas; os valores são relidos do banco a cada consulta. Ao alterar o fingerprint do workspace, o contexto anterior é descartado.
- A resposta separa explicitamente Fatos, Cálculo determinístico e Interpretação/pendências. Não extrapola uma divergência contábil em causa, perda física ou pedido de compra.
- Consultas de CQ/Estoque logo após selecionar um PN retomam o PN explicitamente selecionado, mas consultas plurais continuam operando na categoria inteira.
- Regressões de encadeamento e isolamento em `backend/tests/test_agent_critical_investigation_chain.py`.

### Ajuste contextual de REGRA-004 e CQ por PN (2026-10-29)

- Correção da rota **"Consulta os materiais do Cenário ORION conforme a REGRA-004"**: apresentação da lista atual de críticos e contexto de coleção, preservando a consulta literal da regra quando a pergunta pede sua definição.
- A sequência **lista → "Explique essa contagem" → ranking → PN** passa pela consulta determinística à contagem atual, sem depender da síntese livre da LLM.
- Em consulta singular de Qualidade para um PN selecionado, o roteador utiliza a pergunta original e o foco do contexto, não apenas o texto expandido pelo planejador. Se o PN estiver ausente do relatório de CQ, a resposta informa a ausência de registro *desse PN*, sem retornar os demais cinco encontrados. Relatório ausente e PN ausente são estados distintos.
- Regressões em `backend/tests/test_agent_critical_investigation_chain.py`, incluindo o PN `0404-26` com estoque aguardando validação e sem registro individual em Qualidade.
