import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import InfoHint from './InfoHint'

const INFO_TARGETS = [
  {
    key: 'dashboard-overview',
    selector: '.dashboard-header h2',
    info: {
      title: 'Visão Geral do cenário ORION',
      what: 'Organiza a leitura operacional do cenário inicial calculado pelo ORION e, quando disponível, sua comparação com o DPP Final.',
      source: 'Cenário mensal gerado pelo motor Python e resumo do DPP Final carregado no pacote.',
      purpose: 'Dar ao analista uma visão única do mês sem misturar dados automáticos com decisões humanas.',
    },
  },
  {
    key: 'current-scenario',
    selector: '.dashboard-context-strip .dashboard-context-label',
    info: {
      title: 'Cenário atual',
      what: 'Identifica o mês e confirma que os indicadores seguintes pertencem ao cenário inicial do ORION.',
      source: 'Campo reference_month do cenário mensal registrado após a geração determinística.',
      purpose: 'Evitar leitura de indicadores fora do mês ou confusão entre Cenário ORION e DPP Final.',
    },
  },
  {
    key: 'monthly-package',
    selector: '.bulk-file-picker-head h3',
    info: {
      title: 'Pacote compartilhado do DPP',
      what: 'Mostra quais arquivos mensais foram reconhecidos, quais são obrigatórios e se o pacote está completo.',
      source: 'Arquivos selecionados pelo usuário e mantidos no workspace local/IndexedDB; o frontend classifica DPP anterior, DPP Final, STK SAP, Explosão, OPEN, PGD e WIU.',
      purpose: 'Garantir que Dashboard e Testes trabalhem sobre o mesmo conjunto de fontes e permitir identificar rapidamente qualquer arquivo ausente.',
    },
  },
  {
    key: 'orion-export',
    selector: '.dashboard-scenario-export > div > strong',
    info: {
      title: 'Excel do cenário ORION',
      what: 'Gera uma planilha com os valores calculados pelo Cenário ORION mantendo o formato conhecido do DPP.',
      source: 'Dados do cenário registrados pelo motor Python. O DPP do mês anterior é usado somente como molde de layout, estilos, folhas e estrutura.',
      purpose: 'Permitir revisar, compartilhar ou arquivar a versão automática do ORION sem incorporar valores do DPP Final consolidado.',
    },
  },
  {
    key: 'dpp-state',
    selector: '.dpp-state-panel .panel-header h3',
    info: {
      title: 'Estado do DPP',
      what: 'Coloca lado a lado o Cenário ORION antes da análise humana e o DPP Final depois da consolidação do analista.',
      source: 'ORION: cenário mensal calculado em Python. DPP Final: arquivo consolidado do mês lido pelo endpoint de resumo do Dashboard.',
      purpose: 'Separar claramente cálculo automático e resultado humano e mostrar o estado geral de PGD, REAL, críticos, OPCs e modelos ativos.',
    },
  },
  {
    key: 'dpp-evolution',
    selector: '.dpp-evolution-panel .panel-header h3',
    info: {
      title: 'Evolução do DPP',
      what: 'Mostra as variações entre o Cenário ORION e o DPP Final para materiais críticos, OPCs, REAL e modelos ativos.',
      source: 'Diferença entre os resumos do cenário inicial calculado pelo ORION e do DPP Final consolidado.',
      purpose: 'Evidenciar o que mudou durante a investigação e consolidação humana, sem exigir comparação manual de planilhas.',
    },
  },
  {
    key: 'indicator-comparison',
    selector: '.dashboard-kpi-comparison .dashboard-comparison-heading h3',
    info: {
      title: 'Cenário ORION × DPP Final',
      what: 'Compara os mesmos indicadores operacionais nos dois cenários: PGD, REAL, gap, modelos sem restrição, risco, críticos, PGD exposto e críticos compartilhados.',
      source: 'ORION: models, materials e summary do cenário Python. DPP Final: indicadores recalculados a partir do arquivo consolidado do mês.',
      purpose: 'Mostrar onde as decisões humanas alteraram o plano e quais riscos permaneceram ou foram reduzidos.',
    },
  },
  {
    key: 'model-health',
    selector: '.dashboard-health-panel .panel-header h3',
    info: {
      title: 'Situação dos modelos',
      what: 'Classifica os modelos ativos do Cenário ORION entre sem restrição detectada e com pelo menos um material crítico.',
      source: 'REAL inicial por modelo, matriz de consumo Material × Modelo e materiais de UM = UN com SALDO negativo calculado pelo Python.',
      purpose: 'Indicar rapidamente quantos modelos precisam de investigação material. A porcentagem mede modelos sem restrição, não percentual de unidades produzíveis.',
    },
  },
  {
    key: 'bottlenecks',
    selector: '.dashboard-risk-grid > .dashboard-table-panel:first-child .panel-header h3',
    info: {
      title: 'Principais gargalos',
      what: 'Lista os materiais críticos com os maiores déficits de SALDO do Cenário ORION.',
      source: 'Materiais classificados como INVESTIGAR pelo motor Python, ordenados do SALDO mais negativo para o menos negativo; modelos afetados vêm da matriz de consumo e do REAL ativo.',
      purpose: 'Priorizar a investigação começando pelos materiais com maior impacto potencial sobre o plano.',
    },
  },
  {
    key: 'risk-models',
    selector: '.dashboard-risk-grid > .dashboard-table-panel:nth-child(2) .panel-header h3',
    info: {
      title: 'Modelos com maior risco',
      what: 'Ordena modelos ativos pela quantidade de materiais críticos associados e mostra o pior déficit ligado a cada modelo.',
      source: 'REAL inicial, matriz Material × Modelo e materiais críticos calculados no Cenário ORION.',
      purpose: 'Direcionar a análise para os modelos mais expostos a restrições antes de investigar detalhes material por material.',
    },
  },
  {
    key: 'construction-state',
    selector: '.dashboard-operational-panel .panel-header h3',
    info: {
      title: 'Estado da construção do DPP',
      what: 'Resume a consolidação da base: materiais, modelos, itens novos do WIU, históricos preservados e relações de OPC.',
      source: 'Processamento mensal do DPP anterior combinado com WIU, STK SAP, Explosão, PGD e relações históricas de OPC.',
      purpose: 'Dar rastreabilidade ao que entrou, permaneceu ou foi herdado durante a construção automática do cenário.',
    },
  },
  {
    key: 'final-model-plan',
    selector: '.final-model-plan-heading > div:first-child h3',
    info: {
      title: 'Plano consolidado por modelo',
      what: 'Mostra para cada modelo o KIT disponível PGD, o REAL consolidado e o ajuste REAL − PGD feito no DPP Final.',
      source: 'Linhas KIT Disponivel PGD e REAL lidas diretamente da aba DPP do arquivo final/consolidado carregado no pacote.',
      purpose: 'Identificar exatamente quais modelos foram reduzidos, aumentados ou mantidos após a análise do analista.',
    },
  },
]

function sameHosts(current, next) {
  if (current.length !== next.length) return false
  return current.every((item, index) => item.key === next[index].key && item.host === next[index].host)
}

function DashboardInfoLayer() {
  const [hosts, setHosts] = useState([])

  useEffect(() => {
    const root = document.querySelector('.dpp-dashboard-view')
    if (!root) return undefined

    let frame = 0

    function sync() {
      const next = []

      for (const target of INFO_TARGETS) {
        const anchor = root.querySelector(target.selector)
        if (!anchor) continue

        let host = anchor.querySelector(`:scope > .dashboard-info-host[data-info-key="${target.key}"]`)
        if (!host) {
          host = document.createElement('span')
          host.className = 'dashboard-info-host'
          host.dataset.infoKey = target.key
          anchor.appendChild(host)
        }

        next.push({ key: target.key, host, info: target.info })
      }

      setHosts((current) => (sameHosts(current, next) ? current : next))
    }

    function scheduleSync() {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(sync)
    }

    sync()
    const observer = new MutationObserver(scheduleSync)
    observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      root.querySelectorAll('.dashboard-info-host[data-info-key]').forEach((host) => host.remove())
    }
  }, [])

  return hosts.map(({ key, host, info }) => createPortal(
    <InfoHint {...info} align="left" />,
    host,
    key,
  ))
}

export default DashboardInfoLayer
