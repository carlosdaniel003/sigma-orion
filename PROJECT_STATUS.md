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
