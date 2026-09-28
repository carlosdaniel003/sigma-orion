# Módulos do Dashboard e Testes do DPP

> Fonte única de verdade para os botões `i` do Dashboard do DPP e dos Testes do DPP. Este documento também é indexado no SQLite/FTS5/BM25 e pode ser recuperado pelo Agente ORION.
>
> Estas descrições **não criam novas regras de cálculo**. Em caso de conflito, `motor-deterministico.md`, `regras-globais.md` e a implementação Python são a fonte de verdade determinística.
>
> Cada módulo deve manter exatamente três informações para o usuário: **O que mostra**, **Origem** e **Finalidade**.

## dashboard.overview — Dashboard do DPP

**O que mostra:** Contextualiza o mês e o Cenário ORION que estão ativos no Dashboard. Quando o cenário já foi gerado, a página passa a mostrar os indicadores calculados antes das intervenções e decisões humanas do fechamento.

**Origem:** Workspace mensal do navegador, Cenário ORION retornado pelo motor Python e, quando disponível, análise do DPP Final do mesmo pacote. A geração segue REGRA-010, REGRA-011 e REGRA-012.

**Finalidade:** Ser o ponto de entrada para leitura do mês. O Cenário ORION e o DPP Final exibidos aqui também são sincronizados como entidades do workspace no SQLite/RAG usado pelo Agente ORION; o Agente interpreta esses fatos, mas não recalcula o DPP.

## dashboard.package — Pacote compartilhado do DPP

**O que mostra:** Quais arquivos mensais foram reconhecidos, quais entradas obrigatórias estão presentes e quais arquivos permanecem opcionais ou ausentes.

**Origem:** Arquivos selecionados pelo usuário e persistidos no workspace/IndexedDB. A classificação identifica DPP anterior, DPP Final, STK SAP, Explosão, OPEN, PGD e WIU. A geração usa as fontes definidas na REGRA-011; OPEN é opcional e não altera estoque.

**Finalidade:** Garantir que Dashboard e Testes usem o mesmo pacote e o mesmo mês. Os arquivos brutos não são enviados como conhecimento ao Agente ORION; o Agente recebe os fatos calculados do Cenário ORION, o DPP Final analisado e o estado do workspace derivados desse pacote.

## dashboard.export — Excel do cenário ORION

**O que mostra:** A ação de gerar e baixar um Excel que representa o Cenário ORION atual usando a estrutura visual conhecida do DPP.

**Origem:** Cenário ORION registrado pelo motor Python. O DPP do mês anterior é usado somente como molde de workbook, folhas, estilos e estrutura; o DPP Final não fornece valores para o Excel ORION.

**Finalidade:** Permitir revisão e compartilhamento do cenário automático em um formato familiar ao usuário de Excel, mantendo fidelidade com os mesmos fatos usados pelo Dashboard. O arquivo exportado não cria um novo cenário nem altera o contexto do Agente ORION.

## dashboard.evolution — Evolução do DPP

**O que mostra:** Compara Materiais críticos, OPCs, REAL e Modelos ativos entre o Cenário ORION e o DPP Final e apresenta a diferença Final − ORION.

**Origem:** Cenário ORION calculado em Python e resumo/material/modelos extraídos do DPP Final. Material crítico segue REGRA-004. OPC segue REGRA-005 e possui semântica de referência final na comparação.

**Finalidade:** Evidenciar o que mudou entre o cenário automático e o fechamento real. As diferenças orientam drill-downs de investigação e podem ser consultadas pelo Agente ORION porque cenário e final são sincronizados no workspace RAG.

## dashboard.agent_bridge — Papel do Agente ORION

**O que mostra:** Explica a separação atual de responsabilidades entre motor Python, banco/RAG, Agente ORION e validação humana.

**Origem:** Arquitetura operacional definida pela REGRA-012 e pelos guardrails: Python calcula, SQLite/FTS5/BM25 organiza e recupera fatos/conhecimento, a LLM interpreta quando necessário e o humano valida e decide.

**Finalidade:** Deixar claro que o Agente ORION já é uma camada de apoio à investigação, não um substituto do cálculo determinístico. Ele consulta o workspace sincronizado e apresenta evidências; decisões e alterações continuam sob responsabilidade humana.

## dashboard.scenario_comparison — ORION × DPP Final

**O que mostra:** Compara indicadores equivalentes do Cenário ORION e do DPP Final, incluindo PGD, REAL, gap, cobertura material, modelos em risco, materiais críticos, PGD exposto e críticos compartilhados.

**Origem:** Cenário ORION calculado pelo motor Python e análise do DPP Final. Material crítico usa REGRA-004. A diferença entre cenário e final é interpretada conforme REGRA-010: diferença não significa automaticamente erro do ORION.

**Finalidade:** Identificar rapidamente em qual indicador existe diferença e abrir a investigação do detalhe. Os fatos de cenário/final e o resumo comparativo fazem parte do workspace sincronizado com o Agente ORION.

## dashboard.planning — Aderência do planejamento

**O que mostra:** Compara o total de KIT disponível PGD com o REAL atual do Cenário ORION e apresenta a relação REAL/PGD e o gap entre os dois.

**Origem:** Modelos do Cenário ORION. O KIT PGD vem do PGD mensal mapeado deterministicamente; o REAL inicial do cenário parte do KIT PGD e pode ser recalculado/ajustado pelo fluxo operacional. O solver automático de REAL ainda não está habilitado.

**Finalidade:** Mostrar a aderência do planejamento antes da análise de restrições materiais. Os valores de modelo do cenário são sincronizados com o Agente ORION e podem ser usados em consultas, mas o Agente não altera o REAL por conta própria.

## dashboard.quality — Qualidade dos dados

**O que mostra:** Verifica se as fontes obrigatórias do cenário estão carregadas, se existem mapeamentos PGD pendentes e qual motor está realizando os cálculos NEC/SALDO.

**Origem:** Metadados de fontes e resumo do Cenário ORION produzido pelo pipeline mensal. NEC e SALDO seguem REGRA-001 e REGRA-003; as fontes do cenário seguem REGRA-011.

**Finalidade:** Indicar se existe base mínima para confiar na leitura do cenário antes de investigar resultados. Serve como contexto operacional para o analista; não substitui os testes de reconstrução nem é, por si só, um veredito do Agente ORION.

## dashboard.guide — Como ler o cenário inicial

**O que mostra:** Organiza a leitura do Dashboard em três perguntas: referência de produção, REAL planejado e restrições materiais.

**Origem:** Conceitos do processo descritos no glossário e regras determinísticas do ORION: PGD/KIT, REAL, NEC, STK TTL, SALDO e material crítico.

**Finalidade:** Ajudar usuários acostumados com Excel/Power BI a migrar para o fluxo do sistema sem perder o modelo mental do DPP. É orientação de leitura; não produz dados, cálculos nem evidências novas para o Agente ORION.

## dashboard.final_model_plan — Plano consolidado por modelo

**O que mostra:** Compara por modelo o KIT disponível PGD e o REAL do Cenário ORION com os mesmos campos lidos do DPP Final, exibindo diferenças Final − ORION.

**Origem:** Modelos do Cenário ORION, mapeamento determinístico do PGD e linhas KIT disponível PGD/REAL do DPP Final. Diferenças numéricas usam tolerância operacional de 1e-4, conforme REGRA-009.

**Finalidade:** Localizar exatamente quais modelos e quais campos ainda diferem do fechamento real e abrir o detalhe da divergência. Modelos de cenário e final são entidades sincronizadas no SQLite/RAG do Agente ORION.

## dashboard.column_comparison — Comparativo completo das colunas do DPP

**O que mostra:** Compara as colunas suportadas da aba DPP respeitando a semântica de cada campo: comparação determinística, referência final, contextual ou sem regra implementada.

**Origem:** Projeção canônica do Cenário ORION e DPP Final analisado. CHECK segue REGRA-007; OPC segue REGRA-005; COMENTS segue REGRA-008; números usam REGRA-009.

**Finalidade:** Separar divergência real de diferença esperada do processo e permitir drill-down por coluna/material. O resumo e as colunas do comparativo são sincronizados como entidades do workspace e podem fundamentar respostas do Agente ORION.

## tests.overview — Testes do DPP

**O que mostra:** Reconstrói um mês conhecido com o motor determinístico e compara o resultado contra o DPP consolidado esperado daquele mês.

**Origem:** DPP anterior, WIU, Explosão, STK SAP, PGD, mês de referência e OPEN opcional; o DPP Final conhecido atua como gabarito. As fórmulas e classificações seguem o motor Python e as regras globais.

**Finalidade:** Validar regressão e fidelidade do motor antes de confiar nele operacionalmente. O resultado do teste atualmente não é sincronizado como evidência runtime do Agente ORION; o Agente conhece as regras, mas não recebe automaticamente este relatório de teste.

## tests.preparation — Preparação do teste

**O que mostra:** Reúne o mês de referência e o pacote que será usado para reconstruir e comparar o DPP.

**Origem:** Mês selecionado/detectado no pacote e arquivos persistidos no workspace compartilhado entre Dashboard e Testes.

**Finalidade:** Garantir que todas as entradas pertençam ao mesmo contexto mensal antes da execução. Esta preparação controla o teste; não altera as regras determinísticas nem o workspace de fatos do Agente ORION.

## tests.month — Mês que será reconstruído

**O que mostra:** Define o período mensal que o teste tentará reproduzir.

**Origem:** Valor escolhido pelo usuário ou mês detectado pelo classificador do pacote.

**Finalidade:** Alinhar PGD, WIU, estoques, explosão, DPP anterior e DPP esperado no mesmo período. O mês também é parte da identidade do workspace DPP usado pelo sistema.

## tests.shared_package — Pacote compartilhado

**O que mostra:** Confirma que Testes reutiliza o conjunto de arquivos já mantido no workspace do DPP.

**Origem:** Estado do DppWorkspaceContext persistido no navegador/IndexedDB.

**Finalidade:** Evitar seleção duplicada e impedir que Dashboard e Testes analisem pacotes diferentes. O Agente ORION recebe o estado e os fatos derivados do workspace, não os arquivos brutos.

## tests.package — Arquivos usados no teste

**O que mostra:** Lista DPP anterior, DPP Final esperado, STK SAP, Explosão, PGD, WIU e OPEN opcional reconhecidos para a reconstrução.

**Origem:** Arquivos selecionados pelo usuário e classificados pelo frontend conforme a função de cada planilha.

**Finalidade:** Permitir auditoria visual das entradas antes do teste e identificar ausência de fonte obrigatória. Esses arquivos alimentam o endpoint de teste; o relatório resultante não é atualmente enviado ao Agente ORION.

## tests.execution — Execução do teste

**O que mostra:** Informa se existe resultado válido para o pacote atual, se o teste está em processamento e permite solicitar uma nova execução.

**Origem:** Assinatura do pacote, resultado de teste armazenado no workspace do frontend e endpoint `POST /api/dpp/monthly/test`.

**Finalidade:** Evitar processamento repetido e permitir revalidação explícita quando necessário. Executar novamente recalcula o relatório de teste, sem alterar o Cenário ORION operacional já sincronizado com o Agente.

## tests.verdict — Resultado do teste

**O que mostra:** Resume se restaram divergências atribuídas ao motor depois de separar intervenções humanas e correções conhecidas do legado.

**Origem:** Resultado do serviço de reconstrução/comparação campo a campo em `dpp_test_service.py`, usando tolerâncias e regras determinísticas vigentes.

**Finalidade:** Dar um veredito de regressão do motor e indicar se o detalhamento precisa ser investigado. Este veredito é evidência de teste de engenharia e ainda não é sincronizado automaticamente ao chat do Agente ORION.

## tests.controlled_real — REAL controlado

**O que mostra:** Explica que, no teste, o REAL do DPP esperado é aplicado à reconstrução para isolar os cálculos derivados.

**Origem:** Linha REAL do DPP Final usado como gabarito do mês conhecido.

**Finalidade:** Validar NEC, STK TTL, SALDO e demais campos derivados sem atribuir ao solver de REAL uma capacidade que ainda não existe. Isso preserva a separação de responsabilidades definida pela REGRA-012.

## tests.validation_summary — Resumo das validações

**O que mostra:** Exibe iguais/comparados para Materiais, Matriz, KIT PGD, STK SAP, Explosão, NEC e SALDO, com contagens de intervenções e legado quando aplicável.

**Origem:** Contadores produzidos pelo serviço de teste após comparar o cenário reconstruído com o DPP esperado.

**Finalidade:** Direcionar rapidamente o analista ao grupo com diferença antes de abrir a tabela detalhada. É resumo do teste, não uma métrica runtime atualmente consumida pelo Agente ORION.

## tests.field_comparison — Comparação campo a campo

**O que mostra:** Para cada grupo validado, apresenta total comparado, iguais, intervenções humanas, correções de legado, divergências ORION e resultado.

**Origem:** Comparação detalhada produzida em `dpp_test_service.py` sobre os campos suportados pelo motor.

**Finalidade:** Dar rastreabilidade quantitativa ao veredito e apontar qual regra precisa ser revisada. Não substitui a comparação operacional Dashboard ORION × DPP Final e não é sincronizada automaticamente ao Agente.

## tests.orion_differences — Divergências do ORION

**O que mostra:** Lista somente diferenças classificadas como atribuíveis ao motor determinístico após excluir diferenças humanas e correções de legado.

**Origem:** Amostras de mismatch classificadas pelo serviço de teste conforme as regras e tolerâncias atuais.

**Finalidade:** Direcionar correção de leitura de fonte, mapeamento ou cálculo no Python. Essas divergências são para validação de engenharia; o Agente ORION não deve tratá-las como fatos do mês atual sem que sejam explicitamente sincronizadas no futuro.

## tests.human_interventions — Intervenções humanas

**O que mostra:** Separa diferenças do DPP consolidado que foram classificadas como decisões humanas, especialmente alterações relacionadas a OPC.

**Origem:** Comparação entre base histórica, cenário reconstruído e DPP esperado, usando a classificação conservadora do serviço de teste e a semântica de OPC da REGRA-005.

**Finalidade:** Evitar registrar uma decisão humana legítima como defeito do motor. O bloco documenta o teste; não autoriza o Agente ORION a reproduzir automaticamente a decisão humana.

## tests.legacy_corrections — Correções do legado

**O que mostra:** Separa diferenças em que o ORION mantém uma fonte ou cálculo determinístico considerado correto em vez de reproduzir uma falha histórica conhecida do Excel.

**Origem:** Classificações de legado implementadas no serviço de teste e conhecimento validado do processo.

**Finalidade:** Distinguir uma correção/melhoria do motor de uma regressão. O Agente ORION pode explicar a regra registrada no conhecimento, mas não deve inventar novas exceções de legado a partir deste resultado.
