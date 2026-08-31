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
