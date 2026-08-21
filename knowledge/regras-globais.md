# Regras Globais do Processo

> Registrar somente regras obtidas do processo real e validadas por análise do DPP e/ou especialista.

## REGRA-001 — Cálculo da necessidade (NEC)

**Objetivo:** calcular a necessidade de cada material com base na quantidade REAL dos modelos e no consumo do material em cada modelo.

**Quando aplicar:** para cada linha de material do DPP.

**Entradas necessárias:**

- quantidade REAL de cada modelo;
- consumo do material em cada modelo na matriz do DPP.

**Resultado esperado:**

`NEC = soma(REAL do modelo × consumo do material no modelo)`

**Exceções:** nenhuma confirmada até o momento.

**Fonte:** fórmula existente no DPP preenchido e levantamento do processo.

---

## REGRA-002 — Cálculo do estoque total (STK TTL)

**Objetivo:** calcular o estoque total considerado para o material dentro do DPP.

**Entradas necessárias:**

- STK base da data do DPP;
- EXPLOSÃO;
- STK OP.

**Resultado esperado:**

`STK TTL = STK base + EXPLOSÃO + STK OP`

Células vazias são tratadas como zero no cálculo determinístico.

**Fonte:** fórmula existente no DPP preenchido.

---

## REGRA-003 — Cálculo do saldo

**Objetivo:** medir a diferença entre o estoque total considerado e a necessidade calculada.

**Entradas necessárias:**

- STK TTL;
- NEC.

**Resultado esperado:**

`SALDO = STK TTL - NEC`

**Fonte:** fórmula existente no DPP preenchido.

---

## REGRA-004 — Interpretação inicial de saldo negativo

**Objetivo:** impedir que uma divergência matemática seja interpretada automaticamente como necessidade de compra.

**Quando aplicar:** quando `SALDO < 0`.

**Resultado esperado:**

Classificar o item inicialmente como `INVESTIGAR`.

Saldo negativo indica que, com os valores atualmente consolidados no DPP, a necessidade é maior que o estoque considerado. Isso pode decorrer de diferentes situações administrativas ou de apontamento e deve ser investigado antes de qualquer conclusão de compra.

**Regra de segurança:** o ORION não deve transformar automaticamente o valor negativo em ordem ou recomendação de compra.

**Fonte:** levantamento do processo com a analista.

---

## REGRA-005 — Material opcional (OPC)

**Objetivo:** considerar estoque de um material opcional quando o DPP informar um código OPC.

**Entradas necessárias:**

- código OPC;
- STK OP já consolidado no DPP.

**Resultado esperado:**

O código em `OPC` representa um material opcional e o valor em `STK OP` é somado ao estoque total conforme a REGRA-002.

**Fonte:** confirmação do processo + fórmula do DPP.

---

## REGRA-006 — Amount

**Objetivo:** reproduzir o campo informativo de valor do DPP.

**Entradas necessárias:**

- Preço;
- SALDO.

**Resultado esperado:**

`Amount = Preço × SALDO`

Esse campo é informativo e não é prioridade da análise atual.

**Fonte:** fórmula do DPP + levantamento do processo.

---

## REGRA-007 — Escopo atual do ORION

Nesta etapa, o ORION trabalha **somente sobre o DPP já preenchido**.

Informações de WIU, EXPLOSÃO, PGD, BOM e outras fontes externas podem chegar ao DPP por fórmulas, mas ainda não serão reconstruídas pelo ORION a partir de seus arquivos de origem.

O objetivo atual é:

1. ler a estrutura do DPP;
2. identificar modelos, códigos e quantidades REAL/KIT;
3. recalcular NEC em Python;
4. recalcular STK TTL em Python;
5. recalcular SALDO em Python;
6. recalcular Amount quando houver preço;
7. comparar os resultados do Python com os valores já presentes no DPP;
8. listar saldos negativos como itens a investigar.

A integração direta das planilhas de origem será implementada somente depois que o comportamento do DPP estiver reproduzido de forma confiável.
