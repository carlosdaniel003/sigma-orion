# Motor determinístico do ORION

> Esta base descreve o comportamento atualmente implementado e validado no Python. Ela deve ser usada pelo chat como fonte de verdade para perguntas sobre regras, fórmulas, campos e comparação do DPP.

## Arquitetura — quem calcula e quem interpreta

O Python é a fonte de verdade para cálculos, regras, comparações e classificações determinísticas do ORION.

A LLM não deve recalcular NEC, STK TTL, SALDO, Amount nem decidir se uma divergência matemática existe. Quando uma LLM for conectada, ela deverá interpretar fatos já calculados pelo Python e usar o RAG para recuperar contexto.

Fluxo lógico:

`arquivos do mês → regras Python → Cenário ORION → projeção canônica DPP → Dashboard / Comparativos / Excel / Agente`

Fonte técnica: `backend/app/services/dpp_monthly_service.py` e `backend/app/services/dpp_projection_service.py`.

## Fontes mensais usadas para gerar o Cenário ORION

A geração mensal recebe como fontes obrigatórias:

- DPP do mês anterior, usado como base histórica;
- WIU;
- Explosão de Placas;
- STK SAP;
- PGD;
- mês de referência.

OPEN é uma entrada opcional quando disponível.

O DPP Final do mês corrente não é usado para construir o cenário inicial. Ele é usado depois como referência histórica consolidada para comparação e validação.

Fonte técnica: rota `/api/dpp/monthly/generate/jobs` e `backend/app/services/dpp_monthly_service.py`.

## NEC — fórmula e origem

NEC significa necessidade do material.

Fórmula:

`NEC = Σ(REAL do modelo × consumo do material naquele modelo)`

O cálculo é executado para cada material. Para cada modelo relacionado ao material, o Python multiplica o REAL daquele modelo pelo consumo do material na matriz Material × Modelo e soma todos os resultados.

Implementação canônica: `calculate_nec(material, real_lookup)` em `backend/app/services/dpp_projection_service.py`.

## STK TTL — fórmula e componentes

STK TTL é o estoque total considerado pelo ORION para o material.

Fórmula:

`STK TTL = STK SAP efetivo + EXPLOSÃO + STK OP`

Os três componentes canônicos usados pelo Python são `stock_sap_effective`, `explosion` e `stock_op`. Valores ausentes são tratados como zero no cálculo.

Implementação canônica: `calculate_stock_total(material)` em `backend/app/services/dpp_projection_service.py`.

## SALDO — fórmula

Fórmula:

`SALDO = STK TTL - NEC`

O SALDO mede o estoque total calculado depois de descontar a necessidade calculada.

Implementação canônica: `calculate_balance(stock_total, nec)` em `backend/app/services/dpp_projection_service.py`.

## Amount — fórmula

Fórmula:

`Amount = Preço × SALDO`

Amount é um campo monetário derivado. A diferença de Amount pode ser explicada por mudança no Preço, no SALDO ou em ambos.

## Material crítico — regra atual

Um material é crítico no motor atual quando as duas condições são verdadeiras:

1. a unidade de medida é `UN`;
2. o SALDO é negativo além da tolerância operacional.

Regra equivalente:

`crítico = (UM == UN) e (SALDO < -0,0001)`

A tolerância absoluta atual é `1e-4`.

Implementação: `is_critical_material(unit, balance)` e `critical_rule_metadata()` em `backend/app/services/dpp_projection_service.py`.

Saldo negativo por si só não deve ser convertido automaticamente em ordem de compra. O item deve ser investigado no contexto do processo.

## Tolerância numérica

Comparações numéricas do DPP usam tolerância absoluta `1e-4` e tolerância relativa `1e-9` nas validações gerais.

Na comparação de colunas entre Cenário ORION e DPP Final, uma coluna numérica é divergente quando a diferença ultrapassa a tolerância operacional de `1e-4`.

Fonte técnica: `VALIDATION_ABS_TOL` e `VALIDATION_REL_TOL` em `backend/app/services/dpp_service.py`.

## CHECK — como é comparado

CHECK representa os modelos associados ao material.

A ordem textual dos modelos não altera o significado. O Python separa os nomes, normaliza e ordena os tokens antes de comparar.

Por isso:

`TV 50 / TV 50 INNOLUX`

é equivalente a:

`TV 50 INNOLUX / TV 50`

CHECK só é divergente quando os conjuntos/listas normalizados de modelos são diferentes, e não quando houve apenas reordenação textual.

Fonte técnica: comparação `unordered_tokens` em `backend/app/services/dpp_projection_service.py`.

## OPC — semântica de comparação

OPC registra materiais opcionais descobertos ou consolidados durante o processo mensal.

Na comparação com o Cenário ORION, OPC usa o modo `reference_final`. Isso significa que o DPP Final é tratado como a referência mais recente para essa informação, pois pode incorporar correções, inclusões e associações descobertas durante a análise do mês.

Uma diferença de OPC, sozinha, não entra na contagem de divergências do ORION.

Fonte técnica: `scenario_column_spec()` em `backend/app/services/dpp_projection_service.py` e `_column_rule()` em `backend/app/services/dpp_dashboard_service.py`.

## COMENTS / comentários — semântica de comparação

COMENTS é uma anotação do analista para o DPP daquele mês.

O campo é contextual. Não é um cálculo do ORION e não participa da contagem de divergências entre Cenário ORION e DPP Final.

Comentários de meses diferentes não devem ser tratados como uma cadeia cumulativa de "último valor vence". Cada comentário pertence ao contexto do DPP daquele mês.

Fonte técnica: modo `contextual` em `backend/app/services/dpp_projection_service.py` e `backend/app/services/dpp_dashboard_service.py`.

## Cenário ORION versus DPP Final

O Cenário ORION e o DPP Final têm papéis diferentes.

Cenário ORION: resultado produzido de forma independente pelas regras determinísticas e pelas fontes mensais disponíveis ao sistema.

DPP Final: resultado histórico consolidado do processo real daquele mês, podendo conter decisões, correções e intervenções realizadas durante o fechamento.

Portanto, uma diferença entre os dois não significa automaticamente um bug. Ela pode representar uma diferença real entre o cenário reconstruído e o histórico final.

O DPP Final é usado para validar, comparar e explicar diferenças; ele não deve ser copiado para dentro do cenário inicial apenas para fazer os números coincidirem.

## Divergência de NEC — rastreamento causal

Quando NEC diverge, o ORION pode investigar a causa através das duas entradas da fórmula: REAL e consumo Material × Modelo.

A decomposição usada é:

`ΔNEC = efeito das mudanças de REAL + efeito das mudanças de consumo`

A explicação só deve atribuir a causa quando a decomposição matemática fecha dentro da tolerância. Caso contrário, o sistema deve usar uma explicação genérica em vez de inventar uma causa.

Fonte técnica: `backend/app/services/dpp_nec_divergence_service.py`.

## Divergências derivadas — STK TTL, SALDO e Amount

STK TTL é rastreado até seus componentes: STK SAP efetivo, EXPLOSÃO e STK OP.

SALDO é rastreado pela identidade:

`ΔSALDO = ΔSTK TTL - ΔNEC`

Amount é rastreado pela relação:

`Amount = Preço × SALDO`

Quando possível, o ORION propaga a explicação para a causa anterior. Exemplo: Amount pode divergir porque SALDO mudou; SALDO pode ter mudado porque NEC mudou; NEC pode ter mudado por alterações de REAL e/ou consumo.

Fonte técnica: `backend/app/services/dpp_derived_divergence_service.py`.

## Projeção canônica do DPP

Dashboard, comparação de colunas e Excel ORION devem partir do mesmo Cenário ORION e da mesma projeção canônica, evitando cálculos paralelos com regras diferentes.

A projeção canônica normaliza materiais, campos comparáveis, regras de comparação e totais.

Fonte técnica: `build_orion_projection()` em `backend/app/services/dpp_projection_service.py`.

## Comparação de colunas

Os modos atuais são:

- `compare`: participa da comparação e pode gerar divergência;
- `reference_final`: informação em que o DPP Final é referência operacional, como OPC;
- `contextual`: informação de contexto, como COMENTS;
- `unsupported`: coluna sem regra de comparação implementada.

Campos numéricos usam tolerância. WIU é comparado por presença. CHECK é comparado como lista sem importância de ordem. Material, descrição, UM e Grupo Origem usam comparação textual normalizada.

## Excel ORION — fidelidade

O Excel gerado não é uma planilha independente do Dashboard. Ele deve representar o mesmo Cenário ORION.

Antes do download existem barreiras de fidelidade para impedir que o arquivo final perca materiais ou fórmulas essenciais. O processo valida a extensão física dos materiais e restaura/audita fórmulas determinísticas como NEC, STK TTL, SALDO e Amount.

Fontes técnicas: `backend/app/services/dpp_export_material_fidelity_service.py` e `backend/app/services/dpp_export_formula_fidelity_service.py`.

## Princípio de segurança do motor

O ORION deve preservar esta separação:

`Python calcula → RAG recupera conhecimento → LLM interpreta → humano valida e decide`

Uma futura LLM não deve substituir o motor Python, alterar fatos calculados para fazer o resultado coincidir com o DPP Final nem afirmar uma causa que o motor não conseguiu demonstrar matematicamente.
