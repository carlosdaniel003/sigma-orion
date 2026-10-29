# Glossário

> Registrar somente definições confirmadas pelo processo. Termos externos ainda não levantados permanecem marcados como pendentes.

| Termo | Significado no ORION | Fonte/Validação |
|---|---|---|
| DPP | Planilha principal usada para analisar necessidade de materiais, estoques, saldo e divergências do plano de produção. | Levantamento do processo + DPP preenchido |
| PN | Identificador do item/material (Part Number) usado nas consultas por código do DPP. No ORION, corresponde ao código na coluna Material e nos relatórios de investigação. | Coluna Material do DPP + relatórios de Estoque e Qualidade |
| PGD | Fonte mensal de planejamento por modelo, usada para obter o KIT Disponível PGD. A expansão literal da sigla PGD não foi confirmada no levantamento do processo. | Mapeamento PGD do cenário + dashboard.planning |
| PCP | No uso industrial geral, Planejamento e Controle da Produção. As responsabilidades específicas do setor no processo do ORION ainda não foram documentadas. | Uso industrial geral; aplicação local a confirmar |
| PCPM | Sigla ainda sem definição confirmada no processo do ORION. Seu significado e suas responsabilidades devem ser validados com a equipe. | A confirmar |
| Material | Código identificador do material. | DPP preenchido |
| Descrição | Nome/descrição do material. | DPP preenchido |
| UM | Unidade de medida do material, por exemplo CM, G, ML ou UN. | Levantamento do processo + DPP preenchido |
| Grupo Origem | Indica a origem do material, como local ou importado. | Levantamento do processo + DPP preenchido |
| KIT Disponível PGD | Quantidade planejada/necessária de produção por modelo usada como referência superior da análise. | Levantamento do processo + DPP preenchido |
| REAL | Quantidade de produção utilizada no cálculo de necessidade. Durante a análise pode ser ajustada para localizar aproximadamente até onde os materiais conseguem atender. | Levantamento do processo + DPP preenchido |
| NEC | Necessidade calculada de cada material a partir do REAL dos modelos e do consumo do material em cada modelo. | Levantamento do processo + fórmula do DPP |
| OPC | Código de material opcional que pode atender o material da linha. | Confirmado no levantamento do processo |
| STK OP | Estoque considerado do material opcional informado em OPC. | DPP preenchido / fórmula do processo |
| STK TTL | Estoque total considerado pelo DPP para o material. | Fórmula do DPP |
| SALDO | Resultado de STK TTL menos NEC. Saldo negativo representa uma divergência a investigar, não uma ordem automática de compra. | Levantamento do processo + fórmula do DPP |
| Check | Lista de modelos em que o material aparece com consumo na matriz do DPP. | Fórmula do DPP |
| WIU | Lista de modelos associada ao material trazida para o DPP. A distinção operacional completa entre WIU e Check ainda será confirmada. | Levantamento do processo + DPP preenchido |
| EXPLOSÃO | Informação trazida de uma fonte externa para o DPP por fórmula e considerada no estoque total. | Levantamento do processo + DPP preenchido |
| Preço | Valor informativo do material; não é atualmente o foco principal da análise da analista. | Levantamento do processo |
| Amount | Valor calculado a partir de Preço e SALDO. | Fórmula do DPP |
| Comentários | Campo usado pela analista para registrar observações sobre inconsistências e tratamentos. | Levantamento do processo |
| BOM | Entrada externa usada na montagem/análise do DPP; significado operacional detalhado ainda a confirmar. | A confirmar |
| Open PO | No uso geral de suprimentos, pedido de compra em aberto (Open Purchase Order). A interpretação específica desta informação no DPP e sua eventual participação nas regras do ORION ainda não foram validadas. | Terminologia geral; aplicação ao DPP a confirmar |
| Estoque AG | A confirmar no contexto do processo. | A confirmar |
| PGD Realizado | A confirmar no contexto do processo. | A confirmar |
| Lista de Opcionais | Fonte/estrutura relacionada a materiais opcionais; funcionamento completo ainda a confirmar. | A confirmar |
