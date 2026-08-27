# SIGMA-S ORION — Estado atual do projeto

Atualizado em: **2026-08-27**

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

## Stack atual

- Frontend: React + Vite
- Backend: Python + FastAPI
- Planilhas: OpenPyXL + Pandas
- Persistência local: SQLite + SQLAlchemy
- Persistência do pacote no navegador: IndexedDB
- Conhecimento: Markdown versionado
- RAG atual: recuperação lexical local
- LLM padrão: mock
- Provider opcional: Groq/Qwen
- Execução local: scripts PowerShell/Python

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

### Exportação Excel do cenário ORION

O Dashboard disponibiliza **Baixar Excel ORION** sempre que o Cenário ORION e o DPP do mês anterior estão disponíveis no pacote.

Fluxo:

```text
Cenário ORION em memória
        +
DPP do mês anterior usado somente como molde visual
        ↓
backend OpenPyXL
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

Endpoint:

```text
POST /api/dpp/monthly/export
```

Campos principais:

```text
scenario_id
base_dpp   ← DPP do mês anterior
```

A geração é feita em memória; nenhum Excel corporativo exportado é gravado no repositório.

Como a exportação ainda é uma única resposta HTTP e não possui checkpoints percentuais próprios, o botão apresenta uma **barra indeterminada honesta** e contador de segundos durante `Gerando Excel`, em vez de inventar uma porcentagem falsa.

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

A tela de Testes foi alinhada ao `DESIGN_SYSTEM.md` e funciona como relatório técnico de validação, não como coleção de cards:

- configuração e mês em faixa operacional compacta;
- pacote de arquivos mostrado como lista técnica dentro de um único agrupamento;
- veredito do teste destacado primeiro, por borda semântica e texto;
- Materiais, Matriz, KIT PGD, STK SAP, Explosão, NEC e SALDO em uma única faixa de resumo com divisores;
- comparação campo a campo como tabela principal;
- Divergências ORION, Intervenções humanas e Correções do legado em seções separadas por divisores;
- estados vazios apresentados como notas técnicas, sem card dentro de card;
- tabelas densas, cabeçalho sticky, números tabulares e suporte aos temas claro/escuro;
- verde reservado a validação concluída/OK e vermelho a divergência confirmada do motor.

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
- radius 3–8 px como padrão;
- sem glassmorphism;
- sem gradiente decorativo;
- sem glow;
- sombras apenas quando existe elevação física real;
- cor com função;
- microcopy específica do DPP;
- tabelas como componentes de primeira classe;
- movimento somente com propósito;
- não repetir métricas sem acrescentar leitura nova.

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
