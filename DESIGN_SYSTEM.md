# SIGMA-S ORION — Design System

> Documento normativo do frontend. Toda alteração visual deve consultar este arquivo antes da implementação. Se uma alteração introduzir uma regra visual nova e aprovada, este documento deve ser atualizado no mesmo trabalho/PR.

## 1. Objetivo do produto

O SIGMA-S ORION é um software industrial de análise e consolidação do DPP. A interface deve parecer um produto deliberadamente construído por uma equipe de produto, não uma landing page SaaS nem um dashboard genérico gerado por IA.

A prioridade visual é:

1. responder rapidamente às perguntas do analista;
2. mostrar dados reais do DPP com contexto;
3. deixar claro o que é cenário ORION e o que é DPP Final;
4. evidenciar exceções, riscos e decisões;
5. manter densidade adequada para uso contínuo em desktop;
6. preservar desempenho e consistência.

## 2. Regra principal

Toda decisão visual precisa ter função.

Antes de adicionar um card, perguntar se uma destas soluções resolve melhor:

- seção;
- tabela;
- linha;
- divisor;
- agrupamento por proximidade;
- mudança tipográfica;
- coluna;
- estado semântico.

Não criar elementos apenas para preencher espaço ou deixar a tela “mais bonita”.

## 3. Linguagem visual

A interface deve ser:

- industrial;
- técnica;
- desktop/web;
- densa em nível médio-alto;
- funcional;
- sóbria;
- orientada a dados;
- coerente entre telas;
- rápida de ler;
- compatível com uso prolongado.

A referência de maturidade é a densidade e disciplina de ferramentas profissionais de engenharia, IDEs e software corporativo moderno. A organização do ChatGPT é referência para a navegação lateral recolhível e a área de conversa. A marca, as cores semânticas e os fluxos operacionais continuam próprios do ORION.

## 4. Padrões proibidos

Evitar padrões típicos de “vibe code” e interfaces geradas por IA:

- excesso de cards;
- cards dentro de cards sem necessidade;
- border-radius de 16–24 px aplicado indiscriminadamente;
- pills, chips e badges usados automaticamente para qualquer status;
- combinação de texto semântico + fundo pastel + borda da mesma cor + cápsula;
- barras laterais coloridas, accent borders e status rails sem função operacional explícita;
- `border-left` semântico usado apenas para dar destaque;
- glow;
- glassmorphism;
- backdrop blur decorativo;
- gradientes sem função operacional;
- sombras grandes para criar hierarquia;
- métricas gigantes sem contexto;
- espaços vazios de landing page;
- conteúdo centralizado sem motivo;
- emojis;
- ícones decorativos;
- ícones em todo título, badge e ação;
- ícones dentro de círculos coloridos sem função;
- microcopy genérica de template;
- animação contínua sem função;
- cores de identidade aplicadas a tudo;
- caixas com fundo pastel para cada indicador;
- bordas coloridas acompanhando automaticamente a cor do texto;
- pequenos elementos geométricos sem significado;
- componentes criados apenas para ocupar layout.

## 5. Hierarquia baseada no trabalho do usuário

O layout deve nascer das perguntas do analista, nesta ordem conceitual:

```text
Qual cenário estou vendo?
        ↓
Quanto queremos produzir? (PGD)
        ↓
Quanto foi definido no REAL?
        ↓
O que mudou no DPP Final?
        ↓
Quais modelos estão restritos?
        ↓
Quais materiais causam a restrição?
        ↓
Qual evidência explica o problema?
        ↓
Qual ação precisa ser investigada/decidida?
```

A ordem dos componentes deve acompanhar esse fluxo sempre que os dados disponíveis permitirem.

## 6. Tokens obrigatórios

Nenhuma nova cor, radius, sombra ou espaçamento deve ser criada fora destes tokens sem justificativa explícita e atualização deste documento.

### 6.1 Tema escuro — identidade ORION

O tema escuro deve permanecer técnico e azul-marinho, mas não pode ser preto demais. A leitura precisa continuar confortável em uso prolongado.

```css
--orion-bg: #0D1826;
--orion-surface: #142235;
--orion-surface-elevated: #1B2D43;
--orion-border: #2B4057;

--orion-blue: #46D9FF;
--orion-success: #27F29A;
--orion-warning: #F5C451;
--orion-danger: #FF5D6C;
--orion-neutral: #7F93A8;

--orion-text: #F4F8FC;
--orion-text-secondary: #91A4B8;
```

### 6.2 Tema claro — Apple preto e branco

```css
--orion-bg: #F5F5F7;
--orion-surface: #FFFFFF;
--orion-surface-elevated: #F5F5F7;
--orion-border: #D2D2D7;

--orion-text: #1D1D1F;
--orion-text-secondary: #6E6E73;
```

No tema claro, preto/cinza assumem ação e seleção. Verde, amarelo e vermelho continuam semânticos.

### 6.3 Cores semânticas

Os tokens semânticos continuam disponíveis para situações em que a cor representa **dados, telemetria ou uma ação real**, mas não são a linguagem padrão de status da interface.

- Azul `#46D9FF`: identidade ORION, foco, seleção, ação e progresso medido.
- Verde `#27F29A`, amarelo `#F5C451` e vermelho `#FF5D6C`: reservados a visualizações/telemetria em que a cor seja necessária para interpretar dados ou progresso.
- Cinza e as cores de texto do tema: padrão para estados, resultados, divergências e mensagens operacionais.

### Regra de neutralidade semântica

**Status passivos não devem usar texto verde, amarelo, vermelho ou azul e não devem usar bolinhas coloridas.**

Isso vale globalmente para:

- Dashboard;
- Testes do DPP;
- Base de conhecimento;
- Agente ORION;
- listas de arquivos;
- tabelas;
- comparações ORION × DPP Final;
- divergências;
- estados OK / atenção / erro / pendente;
- indicadores de origem e disponibilidade.

A informação deve continuar explícita por palavras, números, hierarquia tipográfica, divisores e, quando necessário, uma diferença neutra de superfície.

Cores continuam permitidas em controles realmente interativos, foco, seleção, marca, realce de pesquisa e progresso real do processamento.

## 7. Radius

```css
--radius-xs: 0px;
--radius-sm: 0px;
--radius-md: 0px;
--radius-lg: 0px;
```

Regras:

- inputs e botões: cantos retos (`0px`);
- tabelas, agrupamentos e seções: cantos retos (`0px`);
- controles de ícone: área quadrada, com largura e altura iguais;
- cápsula (`999px`, `9999px`, `50px`, `rounded-full`) não faz parte da linguagem padrão de informação ou status;
- cápsulas são reservadas a controles interativos cuja própria interação justifique o formato, conforme a seção de status e badges;
- não usar `16–24px` como padrão.

## 8. Espaçamento

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
```

Não criar espaçamento de landing page. A densidade padrão é média-alta.

## 9. Tipografia

Fonte de interface:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Escala:

```css
--text-xs: 11px;
--text-sm: 12px;
--text-md: 14px;
--text-lg: 16px;
--title: 20px;
--display: 28px;
```

Regras:

- números importantes podem usar `28px`, mas precisam de contexto próximo;
- não criar dezenas de tamanhos diferentes;
- títulos de seção normalmente `16–20px`;
- labels, colunas e metadados `11–12px`;
- dados tabulares `12–14px`;
- usar `font-variant-numeric: tabular-nums` para métricas e tabelas numéricas.

## 10. Sombras e elevação

Hierarquia deve vir de fundo, borda, espaçamento, alinhamento e tipografia.

Padrão:

```css
--shadow-none: none;
--shadow-control: 0 1px 2px rgba(0, 0, 0, 0.08);
```

Sombras são permitidas apenas para controles flutuantes, tooltips, menus e overlays quando a separação espacial realmente existir.

Painéis e cards de conteúdo não devem usar sombras grandes.

## 11. Cards e agrupamentos

Cards não são a unidade padrão do sistema.

Preferir:

- seção com cabeçalho + conteúdo;
- tabela;
- lista dividida por linhas;
- agrupamento com uma borda externa e divisores internos;
- duas colunas separadas por divisor;
- faixa de métricas com separadores.

Quando um card for realmente necessário:

- cantos retos;
- sem sombra grande;
- padding compacto;
- conteúdo específico do domínio;
- não aninhar outro card sem necessidade.

### Princípio de contenção visual

Não colocar uma forma geométrica ao redor de uma informação apenas para torná-la visualmente reconhecível.

Primeiro resolver hierarquia utilizando:

- posição;
- alinhamento;
- espaçamento;
- tamanho;
- peso tipográfico;
- contraste;
- divisores.

Somente criar um container quando houver necessidade funcional de agrupamento, interação ou separação estrutural.

Antes de criar um badge, card ou caixa, verificar se texto, marcador, alinhamento, espaço, divisor ou tipografia já resolvem o problema.

## 12. Tabelas

Tabelas são componentes de primeira classe no ORION.

Regras:

- cabeçalho compacto;
- números alinhados à direita;
- `tabular-nums`;
- hover discreto;
- estado por cor apenas quando necessário;
- descrição secundária menor que o código/modelo;
- sticky header quando a tabela for longa;
- priorizar colunas que respondem às decisões do analista.

## 13. Status, indicadores, labels e badges

### Regra principal

Não transformar informações, estados ou indicadores automaticamente em badges, chips, pills ou cápsulas.

Os padrões conhecidos como **pill badge**, **status chip**, **soft badge**, **outlined badge** ou **capsule badge** não fazem parte da linguagem visual padrão do ORION.

Evitar especialmente o padrão:

- texto colorido em negrito;
- fundo pastel da mesma cor;
- borda colorida;
- formato totalmente arredondado;
- `border-radius: 9999px` ou equivalente;
- combinação simultânea de fundo + borda + texto usando a mesma cor semântica.

Esse padrão não deve ser usado como solução visual padrão para estados como:

- Mantido;
- Reduzido;
- Acima do PGD;
- Abaixo do PGD;
- Divergência;
- Pendente;
- Concluído;
- Ativo;
- Inativo;
- OK;
- Atenção.

**Status são informação, não ação. Portanto, não devem parecer botões.**

### Tratamento padrão de status

Preferir, nesta ordem:

1. texto simples;
2. texto principal + descrição secundária;
3. mudança tipográfica moderada;
4. alinhamento/coluna específica;
5. divisor;
6. mudança muito sutil de fundo neutro quando houver seleção, expansão ou necessidade real de agrupamento.

Não utilizar bolinha colorida, ponto semântico, círculo, quadrado colorido ou barra lateral como tratamento padrão de status.

Exemplos preferidos:

```text
Sem divergência
Divergência · Δ total +16.872 un.
Pendente · aguardando DPP Final
Erro · não foi possível carregar a análise
```

Também é aceitável separar a informação em linhas:

```text
Resultado
Divergência

Δ total
+16.872 un.
```

Evitar:

```text
● Sem divergência
● Atenção
● Erro
```

e qualquer equivalente em verde, amarelo, vermelho ou azul.

Em tabelas, status devem aparecer como texto neutro na própria célula. Se o estado precisar de maior destaque, usar peso tipográfico, uma segunda linha de contexto ou superfície neutra — não cor semântica decorativa.

### Uma cor, um canal

Quando a cor for realmente necessária em uma exceção funcional, não codificar o mesmo significado simultaneamente por texto, borda e preenchimento.

Para **status passivos**, o padrão é ainda mais simples:

```text
texto neutro + contexto
```

Exemplo:

```text
Divergência
Δ total +16.872 un.
```

Não utilizar ponto, ícone ou texto colorido apenas para sinalizar o estado.

### Uso de cores semânticas

Verde, amarelo e vermelho não são a linguagem padrão de status do ORION.

Podem ser usados apenas quando a cor é parte necessária de:

- telemetria;
- progresso real;
- visualização de dados;
- gráfico com legenda;
- situação excepcional em que a leitura perderia informação relevante sem cor.

Mesmo nesses casos, a informação deve continuar compreensível por texto, valor, eixo, legenda ou estrutura.

### Tipografia de status

Não utilizar automaticamente `font-weight: 600`, `700` ou `800` em status.

Estados secundários devem normalmente utilizar peso `400` ou `500`.

Negrito deve indicar hierarquia ou importância real, e não servir apenas para compensar um componente pequeno.

### Forma

Cápsulas totalmente arredondadas não fazem parte da linguagem visual padrão do sistema para informação.

Evitar em status, métricas, labels informativos e indicadores:

```css
border-radius: 9999px;
border-radius: 999px;
border-radius: 50px;
```

E, em Tailwind ou bibliotecas equivalentes:

```text
rounded-full
```

Para elementos retangulares, utilizar os raios discretos definidos nos tokens do sistema.

### Exceções

Pills/chips podem existir apenas quando a própria interação justificar esse formato, por exemplo:

- filtros selecionáveis;
- tags removíveis;
- tokens;
- seleção múltipla;
- toggle segmentado;
- categorias clicáveis.

Mesmo nesses casos, devem ser tratados como **controles interativos**, não como decoração ou status.

### Hierarquia de forma

Um elemento só deve parecer botão quando for clicável.

Um status não clicável não deve compartilhar a mesma linguagem visual dos botões.

Uma informação textual não deve receber contorno apenas para parecer um componente.

Antes de criar um badge, verificar se texto, ícone, marcador, alinhamento, espaço, divisor ou tipografia já resolvem o problema.

### Restrição de implementação

Não utilizar `rounded-full` em elementos de status, métricas ou informação.

Antes de utilizar classes equivalentes a:

- `rounded-full`;
- `bg-green-50`;
- `text-green-700`;
- `border-green-200`;

em conjunto, revisar o componente.

A combinação abaixo é considerada **antipadrão deste projeto**:

```text
texto semântico + fundo semântico claro + borda semântica + cápsula
```

Exemplo proibido como padrão de status:

```jsx
<span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
  Mantido
</span>
```

A implementação deve preferir algo estruturalmente simples, por exemplo:

```jsx
<span className="status-text">
  Mantido
</span>
```

### Evitar estética genérica de dashboard SaaS/IA

Não usar indiscriminadamente:

- cards para toda informação;
- pills para todo status;
- gradientes decorativos;
- ícones dentro de círculos coloridos;
- caixas com fundo pastel para cada indicador;
- bordas coloridas acompanhando a cor do texto;
- excesso de cantos arredondados;
- componentes visuais sem função operacional.

A interface deve parecer uma ferramenta profissional construída deliberadamente, e não uma coleção de componentes genéricos de biblioteca UI.

## 14. Barras laterais, accent borders e indicadores de seleção

### Regra principal

Não utilizar barras coloridas nas laterais de linhas, cards, itens de lista ou células apenas para criar destaque visual.

Os padrões conhecidos como **accent border**, **left accent bar**, **status rail**, **colored stripe** ou `border-left` semântico não fazem parte da linguagem visual padrão do ORION quando não adicionam informação funcional.

Evitar especialmente:

- `border-left` colorido;
- `border-inline-start` colorido;
- pseudo-elementos `::before` posicionados na lateral para formar uma faixa;
- barras verticais de `2px`, `3px` ou `4px` como decoração;
- `box-shadow: inset ...` simulando barra lateral;
- faixas coloridas acompanhando todas as linhas de uma tabela;
- accent bars cuja cor não represente informação adicional necessária.

Esse padrão é considerado decorativo quando a mesma informação já pode ser compreendida por texto, posição, seleção, fundo, estrutura da tabela ou hierarquia tipográfica.

### Antipadrão

Não usar automaticamente:

```text
| Modelo A
| Modelo B
| Modelo C
```

com uma barra colorida à esquerda apenas para dar personalidade visual ao componente.

Também evitar como solução automática:

```css
border-left: 3px solid var(--accent);
```

ou equivalentes com pseudo-elementos:

```text
before:absolute
before:left-0
before:w-[3px]
before:bg-accent
```

em linhas e itens que não precisam comunicar um estado adicional.

### Tratamento padrão para linhas e itens

Para diferenciar itens, preferir nesta ordem:

1. alinhamento e espaçamento;
2. divisores horizontais discretos;
3. contraste tipográfico;
4. mudança sutil de fundo em hover;
5. mudança sutil de fundo para seleção;
6. ícone funcional quando necessário.

Não adicionar uma barra lateral apenas para indicar que o item existe ou pertence a determinada seção.

Em uma tabela, a própria estrutura da coluna já comunica pertencimento. Não repetir essa informação com uma faixa colorida na lateral de cada linha.

### Estado selecionado

Um item selecionado deve ser indicado prioritariamente por:

- fundo discretamente diferente;
- texto com contraste maior;
- peso tipográfico moderado;
- ícone de seleção quando necessário.

Evitar usar uma barra vertical colorida como indicador padrão de seleção.

### Uso excepcional

Uma barra lateral só pode ser utilizada quando houver significado funcional explícito, por exemplo:

- classificação de severidade que precise ser escaneada rapidamente;
- agrupamento hierárquico em que a posição lateral tenha significado;
- estado operacional que precise de reconhecimento imediato e não esteja suficientemente claro por ponto, ícone, texto ou fundo;
- comparação em que a própria posição lateral represente uma relação funcional.

Mesmo nesses casos, verificar primeiro se ponto, ícone, texto ou fundo resolve melhor.

A exceção deve ser justificável pela informação transmitida, não pela aparência.

### Restrição de implementação para accent bars

Não utilizar como padrão visual:

- `border-l-*`;
- `border-s-*`;
- `before:w-[2px]`;
- `before:w-[3px]`;
- `before:w-1`;
- `before:bg-*`;
- `shadow-[inset_*]`;
- `box-shadow: inset ...` para simular uma faixa lateral.

Antes de utilizar qualquer uma dessas técnicas em linhas, cards, itens de menu, células ou listas, deve existir uma justificativa funcional explícita para a barra lateral.

### Regra de composição de linhas

Não adicionar elementos lineares decorativos apenas para “dar destaque”.

Uma linha deve existir porque:

- separa;
- conecta;
- indica continuidade;
- representa relação;
- comunica estado funcional necessário.

Se não cumprir uma dessas funções, remover.

### Proibição de ornamentação compensatória

**Simplicidade não é ausência de design.**

Não adicionar elementos visuais apenas para evitar que uma área pareça simples.

Não compensar interfaces simples adicionando:

- barras laterais coloridas;
- badges;
- pills;
- fundos pastel;
- círculos atrás de ícones;
- linhas decorativas;
- gradientes;
- sombras sem função;
- bordas de destaque;
- pequenos elementos geométricos sem significado.

Quando uma estrutura já é compreensível por hierarquia, tipografia, alinhamento, espaçamento e divisores, não adicionar ornamentação adicional.

Um componente não precisa de um detalhe visual extra para parecer desenhado. Cada elemento visual deve justificar sua existência pela função que exerce.

## 15. Ícones, informação contextual e marca

Usar ícones apenas quando ajudam a reconhecer, executar ou compreender uma ação/informação.

Permitidos:

- navegação compacta;
- tema claro/escuro;
- ação cujo símbolo é universal;
- informação contextual `i`;
- marca ORION;
- status excepcional quando texto sozinho não basta.

Evitar ícone + título + subtítulo + badge + seta simultaneamente.

### Informação contextual do Dashboard e dos Testes do DPP

Cada **módulo analítico ou operacional principal** do Dashboard do DPP e dos Testes do DPP deve disponibilizar um `i` de informação junto ao título. O objetivo é explicar a lógica sem poluir permanentemente a tela.

O tooltip deve responder sempre, e nesta ordem, a três perguntas:

```text
O que mostra
Origem
Finalidade
```

A **Finalidade** deve explicar também a relação do módulo com o restante do sistema: se alimenta outro módulo, se é apenas leitura, se serve para validação/regressão, se entra no workspace do Agente ORION ou se não é atualmente sincronizado com o Agente.

#### Fonte única de verdade

As descrições dos módulos ficam em:

```text
knowledge/modulos-interface.md
```

Esse arquivo é simultaneamente:

1. fonte do endpoint `GET /api/knowledge/module-info`;
2. fonte dos componentes `ModuleInfoHint` do frontend;
3. documento indexado no SQLite/FTS5/BM25;
4. conhecimento recuperável pelo Agente ORION.

Não manter uma segunda cópia manual do mesmo texto dentro dos componentes React.

As descrições de interface não criam regras determinísticas. Quando citarem cálculo, classificação ou tolerância, devem ser compatíveis com:

```text
knowledge/motor-deterministico.md
knowledge/regras-globais.md
implementação Python vigente
```

Em caso de conflito, o motor Python e as regras determinísticas prevalecem e `modulos-interface.md` deve ser corrigido.

Regras visuais e de interação:

- um `i` por módulo coerente; não colocar um ícone em cada célula, linha ou métrica individual;
- a origem deve citar a fonte real: Cenário ORION/Python, DPP Final, DPP anterior, PGD, WIU, STK SAP, Explosão, workspace, resultado de teste etc.;
- não afirmar que um dado vai para o Agente ORION quando ele não é sincronizado no workspace do RAG;
- o botão `i` é **quadrado**, com largura e altura iguais e `border-radius: 0`;
- o botão é neutro; azul ORION somente em hover/foco;
- tooltip usa superfície elevada, borda e `--shadow-control`, pois existe elevação espacial real;
- deve funcionar com mouse e teclado (`focus`/`focus-within`), não somente hover;
- texto do tooltip usa a escala `11–12px` e microcopy do domínio;
- não usar biblioteca de ícones para representar o `i`; o caractere simples é suficiente;
- o CI deve falhar se um módulo obrigatório ficar sem título, O que mostra, Origem ou Finalidade, ou se a documentação citar um código `REGRA-xxx` inexistente.

### Marca SIGMA-S ORION

A marca principal deve ser simples e reconhecível em tamanho pequeno.

Regra atual:

```text
SIGMA-S  ★RION
         ↑
   estrela substitui o O de ORION
```

- não usar símbolo de planeta/órbita como letra `O`;
- usar uma estrela geométrica simples como o `O` de ORION;
- o favicon e a marca compacta usam a mesma estrela;
- a estrela usa o azul ORION;
- o wordmark acompanha `--orion-text`;
- não adicionar glow, órbitas ou detalhes decorativos à marca.

## 16. Movimento

Animação deve comunicar estado ou progresso.

Permitido:

- constelação do ORION vinculada ao progresso real do backend;
- transição curta de tema;
- feedback de hover/focus;
- entrada/saída funcional de overlay.

### Regra de progresso

Quando a interface exibir um **percentual numérico**, esse valor deve vir de telemetria real do processamento no backend ou de uma contagem objetiva de trabalho concluído. Não interpolar, estimar ou animar uma porcentagem falsa apenas para transmitir sensação de avanço.

- percentual disponível = barra determinada + número real;
- apenas etapas conhecidas = usar checkpoints reais e documentar o que representam;
- sem telemetria suficiente = usar progresso indeterminado, sem percentual inventado;
- `100%` somente depois que o backend concluir de fato o artefato/operação correspondente.

### Tela de carregamento

A animação de progresso deve usar uma geometria simplificada da **constelação real de Órion**. A forma final precisa ser reconhecível por:

- cabeça;
- dois ombros;
- as três estrelas do cinturão (Três Marias);
- dois pés principais.

Durante o processamento:

- futuro = neutro;
- etapa atual = azul ORION;
- concluído = verde;
- cada avanço deve continuar ligado a checkpoint real quando houver telemetria.

Ao chegar a `100%`, todas as conexões devem se completar e a constelação de Órion deve permanecer visível brevemente antes do fechamento da tela.

Evitar:

- animações decorativas contínuas;
- glow pulsante;
- parallax;
- transições longas.

Sempre respeitar `prefers-reduced-motion`.

## 17. Performance visual

Preferir:

- CSS simples;
- SVG leve;
- transform/opacity para movimento;
- bordas e superfícies sólidas;
- poucos níveis de DOM quando possível.

Evitar:

- `backdrop-filter` pesado;
- blur decorativo;
- filtros SVG complexos;
- imagens grandes para elementos que podem ser vetor/CSS;
- animação JS para efeitos puramente visuais.

## 18. Conteúdo é parte do design

Usar dados e terminologia reais do DPP:

- KIT disponível PGD;
- REAL;
- NEC;
- STK TTL;
- SALDO;
- OPC;
- material;
- modelo;
- cenário ORION;
- DPP Final.

Evitar conteúdo genérico como “Revenue”, “Growth”, “Insights”, “Performance” sem relação direta com a operação.

## 19. Regras específicas do Dashboard DPP

- Nunca misturar Cenário ORION e DPP Final sem identificar claramente a origem.
- Métrica precisa informar o que mede; não usar nomes que sugiram capacidade produtiva quando o cálculo mede proporção de modelos.
- `Cobertura material` atual mede modelos ativos sem material UN negativo; comunicar isso explicitamente.
- Comparações devem mostrar valor, origem e contexto.
- O plano por modelo deve priorizar alterações no REAL e diferenças contra KIT disponível PGD.
- Gargalos devem mostrar material, déficit, modelos afetados e OPC quando disponível.
- Não repetir a mesma métrica em múltiplos componentes sem oferecer uma leitura adicional.
- Status de tabelas devem seguir a regra de texto neutro + marcador semântico, evitando badges/pills não interativos.
- Resumos de divergência como “6 indicadores com divergência” devem preferir hierarquia tipográfica ou marcador discreto, sem cápsula e sem accent bar decorativa.
- Linhas de modelos, materiais ou resultados não devem receber `border-left` colorido apenas por estarem divergentes, selecionadas ou pertencerem a uma seção; primeiro usar texto, ponto, fundo sutil ou estrutura tabular.
- Ações de exportação/download devem aparecer como controle contextual ou faixa operacional compacta, não como um card isolado. O texto deve deixar explícito qual cenário será exportado e qual arquivo/layout serve apenas como modelo visual.
- Todo bloco principal visível do Dashboard deve possuir informação contextual `i` com **O que mostra / Origem / Finalidade**.

## 20. Checklist obrigatório antes de alterar frontend

Antes de implementar:

- [ ] Li este `DESIGN_SYSTEM.md`.
- [ ] Sei qual pergunta operacional o componente responde.
- [ ] Verifiquei se a informação já existe em outro componente.
- [ ] Avaliei seção/tabela/divisor antes de criar card.
- [ ] Avaliei texto/marcador/divisor antes de criar badge, pill ou chip.
- [ ] Não usei `rounded-full` para status, métrica ou informação.
- [ ] Não codifiquei o mesmo estado simultaneamente por texto + fundo + borda semânticos.
- [ ] Não usei `border-left`, pseudo-elemento ou `inset shadow` como ornamentação de linha/item.
- [ ] Se existe accent bar, consigo explicar qual informação funcional adicional ela comunica.
- [ ] Não adicionei detalhe visual apenas para compensar uma área simples.
- [ ] Não criei cor nova sem necessidade.
- [ ] Não criei radius novo.
- [ ] Não criei sombra grande.
- [ ] Mantive densidade média-alta.
- [ ] Usei microcopy do domínio.
- [ ] Mantive tema claro e escuro.
- [ ] Mantive `prefers-reduced-motion`.
- [ ] Evitei impacto desnecessário de renderização.
- [ ] Se alterei/criei bloco do Dashboard, revisei seu tooltip e a origem dos dados.

Depois de implementar:

- [ ] O resultado continua legível sem cor.
- [ ] A cor tem significado e usa preferencialmente um único canal visual.
- [ ] Status não clicáveis não parecem botões.
- [ ] Linhas e itens não possuem accent bars decorativas.
- [ ] A interface não contém ornamentação criada apenas para “dar destaque”.
- [ ] O componente não parece uma landing page nem um dashboard SaaS/IA genérico.
- [ ] Não existe redundância de informação.
- [ ] O estado ORION vs Final está explícito.
- [ ] Tooltips não inventam cálculos nem fontes.
- [ ] Se uma nova regra visual foi aprovada, atualizei este documento.

## 21. Protocolo de manutenção

Este documento é parte do código do produto.

Para qualquer mudança visual futura:

1. consultar `DESIGN_SYSTEM.md` antes de editar o frontend;
2. reutilizar os tokens existentes;
3. justificar qualquer exceção;
4. atualizar este arquivo quando a linguagem visual evoluir;
5. manter a implementação compatível com os dois temas;
6. não reintroduzir estilos legados de 16–24 px, grandes sombras, glassmorphism, cards excessivos, pills/badges como padrão de status ou accent bars decorativas.

A consistência do sistema tem prioridade sobre criatividade isolada em uma única tela.

## 22. Layout industrial com navegação lateral

Atualização visual solicitada em 2026-09-28:

- lateral fixa, recolhível, com nomes das áreas e agrupamentos DPP / conhecimento;
- estado selecionado por fundo neutro e `aria-current`, sem faixa decorativa;
- cabeçalho compacto com título da área e busca contextual do conhecimento;
- controles de ícone quadrados; campos, tabelas e áreas de texto mantêm proporções adequadas ao conteúdo e cantos retos;
- conversa ocupa a área central; evidências e inspeção abrem por controle explícito, sem perda de rastreabilidade;
- navegação compacta em telas pequenas, expansível com botão de fechamento;
- temas claro/escuro, foco visível e rótulos acessíveis preservados;
- `WorkspaceNavigation.jsx` concentra navegação e seus ícones; `App.jsx` mantém a seleção das áreas e a composição funcional;
- `navigation.css` controla o frame; tokens geométricos continuam centralizados em `product-language.css`.

A referência ao ChatGPT orienta a organização, sem acrescentar recursos fictícios de histórico ou nova conversa.


## 23. Linguagem neutra global

Atualização visual aprovada em **2026-09-28** e aplicável a todo o SIGMA-S ORION.

Esta seção substitui qualquer orientação anterior que recomendasse ponto/bolinha semântica como tratamento padrão.

### Regra

O ORION deve se aproximar da sobriedade visual de ferramentas como o ChatGPT sem copiar sua identidade. A interface usa predominantemente:

- texto branco/preto conforme o tema;
- texto secundário cinza;
- superfícies neutras;
- divisores;
- alinhamento;
- tipografia;
- tabelas compactas.

Não usar como linguagem padrão:

- números ou valores em azul/ciano apenas por serem do ORION;
- texto verde para OK;
- texto amarelo para atenção/divergência;
- texto vermelho para erro/criticidade;
- bolinhas verdes, amarelas ou vermelhas;
- marcadores coloridos anexados a status;
- fundos semânticos pastel;
- bordas semânticas decorativas.

### Exceções funcionais

A cor pode permanecer quando representa uma interação ou telemetria real:

- botão/ação primária;
- foco de teclado;
- item interativo selecionado quando necessário;
- marca ORION;
- destaque de busca;
- progresso real;
- constelação de carregamento ligada aos checkpoints reais do backend;
- visualização de dados em que a cor seja indispensável e tenha legenda/contexto.

Mesmo nas exceções, texto operacional deve permanecer predominantemente neutro.

### Implementação

A camada `frontend/src/industrial-neutral-language.css` é carregada por último e funciona como compliance global para neutralizar estilos semânticos legados. Novos componentes devem nascer neutros e não depender dessa camada para corrigir padrões antigos.


## 24. Público-alvo e ponte Excel → automação

O ORION foi pensado para usuários que hoje consomem diretamente planilhas de Excel e análises visuais próximas ao Power BI. O objetivo do produto não é romper abruptamente com esse repertório, mas transformar esse fluxo em um sistema automatizado, rastreável e assistido pelo Agente ORION.

### Princípio de transição

A interface deve funcionar como uma ponte:

```text
Excel / planilhas
      ↓
tabelas e indicadores familiares
      ↓
sistema ORION
      ↓
automação determinística
      ↓
Agente ORION / IA
```

O usuário precisa reconhecer rapidamente os dados que já conhece, entender de onde vieram e perceber o ganho da automação sem sentir que perdeu controle sobre a informação.

### Três pilares

A linguagem visual do ORION deve equilibrar permanentemente:

1. **Industrial**
   - aparência técnica;
   - densidade adequada ao trabalho;
   - superfícies sóbrias;
   - organização previsível;
   - informação acima de ornamentação.

2. **Fluidez**
   - reduzir cliques e trocas desnecessárias de contexto;
   - manter navegação previsível;
   - preservar filtros, seleção e contexto durante a análise;
   - permitir ir do resumo ao detalhe sem interromper o raciocínio;
   - o Agente ORION deve complementar o trabalho, não esconder os dados que sustentam a resposta.

3. **Clareza visual**
   - hierarquia evidente;
   - nomes e unidades explícitos;
   - origem do dado acessível;
   - comparação direta;
   - estados comunicados por texto e estrutura;
   - evitar códigos visuais que o usuário precise aprender antes de entender a informação.

### Familiaridade com Excel e Power BI

Tabelas e gráficos não devem ser tratados como recursos secundários. Para este público eles são a linguagem de trabalho já conhecida.

Priorizar:

- tabelas compactas e legíveis;
- cabeçalhos fixos em conjuntos longos;
- alinhamento consistente de números;
- unidades próximas ao valor;
- filtros e busca fáceis de localizar;
- ordenação compreensível;
- totais, diferenças e comparações explícitas;
- drill-down do agregado para o material/modelo que explica o resultado;
- gráficos somente quando tornam uma relação, tendência ou comparação mais rápida de entender do que uma tabela.

Evitar transformar dados naturalmente tabulares em cards apenas para modernizar a aparência.

### Modernizar sem descaracterizar

O ORION não deve reproduzir visualmente uma planilha do Excel, mas deve preservar seu modelo mental útil:

- linhas representam registros;
- colunas têm significado estável;
- números podem ser comparados verticalmente;
- filtros alteram um conjunto visível;
- totais e diferenças possuem posição previsível;
- a evidência detalhada permanece acessível.

A modernização deve acrescentar:

- automação;
- validação;
- persistência de contexto;
- rastreabilidade;
- explicação;
- navegação;
- IA assistiva.

Não deve retirar a capacidade do analista de inspecionar os dados.

### Agente ORION

A IA representa uma nova camada para esse público. Por isso:

- respostas devem se conectar aos dados e termos do DPP;
- evidências devem permanecer acessíveis;
- tabelas devem ser usadas quando a resposta envolver muitos materiais/modelos;
- o agente não deve substituir uma comparação objetiva por texto longo;
- quando um número vier do cenário, DPP Final, RAG ou cálculo determinístico, essa origem deve ser identificável;
- a conversa deve reduzir trabalho manual e investigação repetitiva, não criar uma nova camada de complexidade.

### Critério de decisão para novos componentes

Antes de desenhar uma nova tela ou componente, perguntar:

```text
Um usuário acostumado com Excel/Power BI entende em poucos segundos:
1. o que está vendo?
2. de onde veio?
3. como comparar?
4. onde investigar?
5. o que o ORION automatizou?
```

Se a resposta for não, simplificar a interface antes de acrescentar novos elementos visuais.
