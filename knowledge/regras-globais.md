# Regras Globais do Processo

> Registrar somente regras obtidas do processo real e validadas pelo motor determinístico, pela análise do DPP e/ou por especialista. A descrição técnica detalhada está em `motor-deterministico.md`.

## REGRA-001 — Cálculo da necessidade (NEC)

**Objetivo:** calcular a necessidade de cada material com base na quantidade REAL dos modelos e no consumo do material em cada modelo.

**Entradas:** REAL por modelo e matriz Material × Modelo.

**Regra:**

`NEC = Σ(REAL do modelo × consumo do material no modelo)`

**Implementação:** `calculate_nec()` em `dpp_projection_service.py`.

## REGRA-002 — Cálculo do estoque total (STK TTL)

**Entradas:** STK SAP efetivo, EXPLOSÃO e STK OP.

**Regra:**

`STK TTL = STK SAP efetivo + EXPLOSÃO + STK OP`

Valores ausentes são tratados como zero no cálculo determinístico.

**Implementação:** `calculate_stock_total()` em `dpp_projection_service.py`.

## REGRA-003 — Cálculo do SALDO

**Regra:**

`SALDO = STK TTL - NEC`

**Implementação:** `calculate_balance()` em `dpp_projection_service.py`.

## REGRA-004 — Material crítico

Um material é crítico quando:

- `UM == UN`;
- `SALDO < -0,0001`.

Saldo negativo não deve ser transformado automaticamente em ordem ou recomendação de compra. A condição sinaliza investigação operacional.

**Implementação:** `is_critical_material()` em `dpp_projection_service.py`.

## REGRA-005 — Material opcional (OPC)

OPC representa material opcional associado ao item. O estoque opcional consolidado entra em `STK OP` e participa do STK TTL.

Na comparação ORION × DPP Final, OPC é `reference_final`: o DPP Final é a referência mais recente para associações de OPC encontradas/corrigidas durante o fechamento, e diferenças de OPC não são classificadas automaticamente como divergência do ORION.

## REGRA-006 — Amount

**Regra:**

`Amount = Preço × SALDO`

Amount é um campo derivado e pode mudar por alteração no Preço, no SALDO ou em ambos.

## REGRA-007 — CHECK

CHECK representa os modelos associados ao material. A ordem textual não altera o significado.

Os valores são comparados como tokens normalizados e ordenados. Reordenação não é divergência; mudança real no conjunto de modelos é divergência.

## REGRA-008 — COMENTS

COMENTS é anotação contextual do analista para o DPP daquele mês. Não é cálculo determinístico e não participa da contagem de divergências ORION × DPP Final.

## REGRA-009 — Tolerância numérica

A tolerância absoluta atual para comparação numérica é `1e-4`. A validação geral também usa tolerância relativa `1e-9`.

## REGRA-010 — Cenário ORION e DPP Final

O Cenário ORION é reconstruído de forma independente a partir das fontes mensais e das regras Python.

O DPP Final é o histórico consolidado do mês e é usado para comparação/validação. Diferença entre os dois não significa automaticamente bug.

Não copiar valores do DPP Final para o cenário inicial apenas para forçar igualdade.

## REGRA-011 — Fontes do cenário mensal

A geração mensal usa:

- DPP do mês anterior;
- WIU;
- Explosão;
- STK SAP;
- PGD;
- mês de referência;
- OPEN, quando disponível, como entrada opcional.

O DPP Final do mês corrente entra depois, na etapa de comparação e validação.

## REGRA-012 — Separação de responsabilidades

O princípio do ORION é:

`Python calcula → RAG recupera conhecimento → LLM interpreta → humano valida e decide`

A LLM não substitui o motor determinístico e não deve inventar fatos, valores ou causas ausentes.

## REGRA-013 — Gap consolidado após Estoque e Qualidade

O gap físico de PN crítico inicia em max(0, -SALDO original). Apenas quantidade disponível validada fora do DPP em M221/P277 e liberação validada fora do DPP em Q239/Q273 reduzem essa falta física, sempre limitada ao saldo residual do mesmo PN.

- gap físico após Estoque = max(0, déficit inicial - disponibilidade adicional confirmada em Estoque).
- gap físico após Qualidade = max(0, gap físico após Estoque - liberação adicional confirmada no CQ).
- falta sem explicação = max(0, déficit inicial - disponibilidade adicional - indisponibilidade justificada - liberação CQ adicional - reprovação CQ justificada - refugo CQ justificado).
- Justificativas não tornam material disponível; a investigação posterior de Scrap não participa do cálculo.
- O cálculo considera todos os PNs do DPP, sem somar unidades diferentes. Materiais de UM fora de UN permanecem sem recuperação automática.
- SALDO original e planilha mensal não são automaticamente substituídos pela projeção.

## REGRA-014 — Aplicação autorizada do gap ao DPP

- A prévia de gap é leitura; não altera cenário ou arquivo.
- Só aplicar a recuperação validada de Estoque e CQ quando **nenhum registro encontrado estiver pendente de validação** e o analista confirmar expressamente o resumo.
- Confirmação prévia e operação final utilizam o mesmo STK/fingerprint, cenário e versões efetivas das revisões. Divergências entre os dois momentos bloqueiam a aplicação; não reaplicar duas vezes.
- PNs sem depósitos conhecidos permanecem não resolvidos e sem ajuste, exigindo ciência explícita na janela quando existir falta não explicada.
- Gerar nova identidade de cenário; persistir cenário original e novo; preservar o SALDO anterior e a origem das decisões.
- A disponibilidade confirmada e não contabilizada reduz o déficit físico ao entrar em STK TTL como componente adicional ORION. Em seguida, SALDO e Amount são recalculados pelo motor. Não somar justificativa como disponibilidade; não modificar valor bruto do STK SAP.
- Excel canônico da versão aprovada acrescenta aba técnica oculta de validações e referencia-a na fórmula de STK TTL. Fórmulas de SALDO e Amount continuam auditáveis e a aba DPP não muda de layout.
- Não aplicar investigação posterior de Scrap nem alterar NEC e REAL.
