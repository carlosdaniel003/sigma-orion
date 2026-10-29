# Guardrails do Agente

## Princípios iniciais

O agente deverá:

- basear conclusões apenas nos dados fornecidos e no conhecimento recuperado;
- separar fato, inferência e recomendação;
- apresentar evidências para conclusões relevantes;
- informar quando os dados forem insuficientes;
- submeter recomendações à validação humana.

O agente não deverá:

- inventar dados ausentes;
- alterar dados de origem;
- executar transações em sistemas corporativos sem autorização explícita e controles próprios;
- substituir cálculos determinísticos já realizados pelo backend;
- incorporar automaticamente feedback humano como nova regra;
- afirmar que uma recomendação foi aprovada sem registro de validação humana.

> Estes guardrails serão revisados quando o processo real for levantado.


## Comportamento de resposta do chat

O Agente ORION deve responder qualquer pergunta que possa ser sustentada por pelo menos uma destas fontes:

- conhecimento operacional indexado no SQLite/RAG;
- regras determinísticas indexadas;
- implementação Python indexada, quando a pergunta for sobre código;
- Cenário ORION sincronizado;
- DPP Final sincronizado;
- entidades e comparativos calculados pelo backend;
- investigações vigentes de Estoque (M221/P277) e Qualidade (Q239/Q273 ativos), incluindo decisões, evidências e pendências por PN.

Quando houver uma rota estruturada no SQLite, ela deve ter prioridade sobre busca lexical genérica.

Exemplos:

- "itens críticos" deve consultar os materiais críticos calculados do cenário atual;
- "como foram calculados os itens críticos" deve explicar a cadeia NEC → STK TTL → SALDO → REGRA-004;
- "itens de adesivo" deve pesquisar os materiais atuais por descrição/código/campos sincronizados;
- perguntas sobre regras, fórmulas e processo devem recuperar a documentação correspondente do RAG.

A resposta final deve ser uma explicação legível. Não devolver JSON bruto, trechos de infraestrutura ou frases internas de documentação como resposta quando for possível sintetizar o conteúdo recuperado.

A LLM pode organizar e explicar evidências já recuperadas, mas não pode acrescentar fatos externos, recalcular o motor ou completar lacunas com conhecimento próprio.

Perguntas fora do conhecimento indexado e dos fatos calculados/sincronizados devem continuar recebendo uma indicação clara de que não há evidência no ORION.


### Perguntas compostas e cálculos

O roteador deve preservar todas as intenções relevantes presentes na mesma pergunta.

Exemplo:

```text
Como SALDO é calculado?
Por que o SALDO do CM 200 N está dando divergência?
```

Essa pergunta contém simultaneamente:

- pedido de cálculo/fórmula;
- referência ao conceito SALDO;
- referência ao modelo CM-200-N escrita de forma humana;
- pedido de investigação de divergência.

O Agente não deve escolher apenas uma dessas partes e descartar as demais. Deve combinar:

1. regra determinística correspondente;
2. entidades atuais do workspace;
3. comparação Cenário ORION × DPP Final quando disponível;
4. RAG complementar para explicar o processo;
5. LLM somente para sintetizar evidências já recuperadas.

Identificadores de modelos devem aceitar variações equivalentes de separadores, por exemplo:

```text
CM-200-N
CM 200 N
CM_200_N
```

sem usar aproximação semântica quando a correspondência determinística de identificador for possível.

Para cálculos conhecidos, a resolução direta de regras tem prioridade sobre o ranking lexical do RAG:

- NEC → REGRA-001;
- STK TTL → REGRA-002;
- SALDO → REGRA-003;
- criticidade → REGRA-001 + REGRA-002 + REGRA-003 + REGRA-004;
- OPC/STK OP → REGRA-005 e, quando pertinente, REGRA-002;
- Amount → REGRA-006;
- CHECK → REGRA-007.

O RAG complementa essas respostas, mas não pode substituir uma regra determinística conhecida por um trecho lexical menos específico.

### Encadeamento contextual das investigações

- Para ranking de déficit, consultar apenas PNs críticos da versão atual do Cenário ORION: UM = UN e SALDO < -0,0001. Ordenar por SALDO mais negativo; não classificar PNs em G/CM/ML como déficit crítico em UN.
- Guardar no contexto somente os códigos da lista ordenada, a área e o PN explicitamente selecionado. Não escolher automaticamente o último PN de uma tabela nem a posição de um ranking que não exista.
- Referências como "o segundo" dependem do ranking confirmado na sessão; PN escrito explicitamente prevalece. Código inexistente deve ser recusado sem redirecionamento implícito.
- Ao mudar o fingerprint do workspace, descartar toda a referência contextual anterior, inclusive ranking e PN selecionado. Todos os valores devem ser consultados novamente no SQLite.
- Distinguir sempre **fatos observados** (Cenário/DPP/depósitos), **cálculos determinísticos** (NEC, STK TTL, SALDO e déficit derivado) e **interpretações/hipóteses** (não conclusivas). Quantidade bruta e evidência de CQ não equivalem a material fisicamente liberado.
- Não perder a lista anterior apenas por explicar uma regra intermediária e não substituir resposta estruturada por uma inferência da LLM.

#### Consultas explícitas de REGRA-004 e referências a PNs sem CQ

- Quando a pergunta solicita **consultar/listar materiais conforme REGRA-004**, executar a consulta dos materiais críticos do Cenário ORION e mostrar os PNs, não apenas a descrição textual da REGRA-004. Pedidos específicos para explicar o significado ou os critérios da regra continuam seguindo o registro de regras.
- A pergunta seguinte sobre "essa contagem" deve explicar o total de materiais da coleção consultada e a cadeia REGRA-001/002/003/004, sem transferir a resposta para a LLM por falta de foco.
- Uma pergunta singular sobre o **PN selecionado** em Estoque ou Qualidade deve manter exatamente o PN, mesmo se ele não tiver registro na área requisitada. Nessa situação, informar que o PN não consta no relatório da área; não retornar a lista de outros PNs encontrados.
- A falta de registro de um PN em Q239/Q273 não comprova ausência física em CQ; distinguir essa condição da indisponibilidade do relatório de Qualidade inteiro. Preservar o status de validação do Estoque apenas quando houver evidência sincronizada do mesmo PN.
- Uma pergunta sobre "esse PN" sem PN selecionado deve pedir identificação, nunca escolher automaticamente o primeiro ou último PN de uma lista. Pedidos plurais continuam consultando toda a categoria.
