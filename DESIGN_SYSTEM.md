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

A referência de maturidade é a densidade e disciplina de ferramentas profissionais de engenharia, IDEs e software corporativo moderno. Não copiar a identidade de nenhum produto específico.

## 4. Padrões proibidos

Evitar padrões típicos de “vibe code” e interfaces geradas por IA:

- excesso de cards;
- cards dentro de cards sem necessidade;
- border-radius de 16–24 px aplicado indiscriminadamente;
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
- microcopy genérica de template;
- animação contínua sem função;
- cores de identidade aplicadas a tudo;
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

- Azul `#46D9FF`: informação, análise ORION, interação e seleção no tema escuro.
- Verde `#27F29A`: OK, disponível, concluído, confirmado.
- Amarelo `#F5C451`: atenção, investigação, risco não confirmado.
- Vermelho `#FF5D6C`: problema confirmado, erro, déficit crítico.
- Cinza: neutro, sem informação, ainda não analisado.

Azul e verde são identidade, mas não devem colorir tudo. Meta visual aproximada: **80% neutro / 15% identidade / 5% estado**.

## 7. Radius

```css
--radius-xs: 3px;
--radius-sm: 5px;
--radius-md: 8px;
--radius-lg: 10px;
```

Regras:

- inputs e botões: `5px`;
- tabelas, agrupamentos e seções: `5–8px`;
- elementos especiais: máximo habitual de `10px`;
- cápsula (`999px`) somente para status/chip cujo formato semântico justifique;
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

- radius pequeno;
- sem sombra grande;
- padding compacto;
- conteúdo específico do domínio;
- não aninhar outro card sem necessidade.

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

## 13. Ícones e marca

Usar ícones apenas quando ajudam a reconhecer ou executar uma ação.

Permitidos:

- navegação compacta;
- tema claro/escuro;
- ação cujo símbolo é universal;
- marca ORION;
- status excepcional quando texto sozinho não basta.

Evitar ícone + título + subtítulo + badge + seta simultaneamente.

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

## 14. Movimento

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

## 15. Performance visual

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

## 16. Conteúdo é parte do design

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

## 17. Regras específicas do Dashboard DPP

- Nunca misturar Cenário ORION e DPP Final sem identificar claramente a origem.
- Métrica precisa informar o que mede; não usar nomes que sugiram capacidade produtiva quando o cálculo mede proporção de modelos.
- `Cobertura material` atual mede modelos ativos sem material UN negativo; comunicar isso explicitamente.
- Comparações devem mostrar valor, origem e contexto.
- O plano por modelo deve priorizar alterações no REAL e diferenças contra KIT disponível PGD.
- Gargalos devem mostrar material, déficit, modelos afetados e OPC quando disponível.
- Não repetir a mesma métrica em múltiplos componentes sem oferecer uma leitura adicional.
- Ações de exportação/download devem aparecer como controle contextual ou faixa operacional compacta, não como um card isolado. O texto deve deixar explícito qual cenário será exportado e qual arquivo/layout serve apenas como modelo visual.

## 18. Checklist obrigatório antes de alterar frontend

Antes de implementar:

- [ ] Li este `DESIGN_SYSTEM.md`.
- [ ] Sei qual pergunta operacional o componente responde.
- [ ] Verifiquei se a informação já existe em outro componente.
- [ ] Avaliei seção/tabela/divisor antes de criar card.
- [ ] Não criei cor nova sem necessidade.
- [ ] Não criei radius novo.
- [ ] Não criei sombra grande.
- [ ] Mantive densidade média-alta.
- [ ] Usei microcopy do domínio.
- [ ] Mantive tema claro e escuro.
- [ ] Mantive `prefers-reduced-motion`.
- [ ] Evitei impacto desnecessário de renderização.

Depois de implementar:

- [ ] O resultado continua legível sem cor.
- [ ] A cor tem significado.
- [ ] O componente não parece uma landing page.
- [ ] Não existe redundância de informação.
- [ ] O estado ORION vs Final está explícito.
- [ ] Se uma nova regra visual foi aprovada, atualizei este documento.

## 19. Protocolo de manutenção

Este documento é parte do código do produto.

Para qualquer mudança visual futura:

1. consultar `DESIGN_SYSTEM.md` antes de editar o frontend;
2. reutilizar os tokens existentes;
3. justificar qualquer exceção;
4. atualizar este arquivo quando a linguagem visual evoluir;
5. manter a implementação compatível com os dois temas;
6. não reintroduzir estilos legados de 16–24 px, grandes sombras, glassmorphism ou cards excessivos.

A consistência do sistema tem prioridade sobre criatividade isolada em uma única tela.
