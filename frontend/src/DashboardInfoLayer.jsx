import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import InfoHint from './InfoHint'

const INFO_TARGETS = [
  {
    key: 'dashboard-overview',
    selector: '.dashboard-header h2',
    info: {
      title: 'Visão Geral do cenário ORION',
      what: 'Organiza a leitura operacional do cenário inicial calculado pelo ORION e identifica diretamente o mês que está sendo analisado.',
      source: 'Cenário mensal gerado pelo motor Python e resumo do DPP Final carregado no pacote.',
      purpose: 'Dar ao analista uma visão única do mês sem misturar dados automáticos com decisões humanas.',
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
    key: 'dpp-evolution',
    selector: '.dpp-evolution-panel .panel-header h3',
    info: {
      title: 'Evolução do DPP',
      what: 'Mostra as variações entre o Cenário ORION e o DPP Final para materiais críticos, OPCs, REAL e modelos ativos.',
      source: 'Diferença entre os resumos do cenário inicial calculado pelo ORION e do DPP Final consolidado. O DPP Final é localizado no pacote mensal e lido pelo endpoint de resumo do Dashboard.',
      purpose: 'Evidenciar o que mudou durante a investigação e consolidação humana, sem exigir comparação manual de planilhas.',
    },
  },
  {
    key: 'scenario-comparison',
    selector: '.dashboard-scenario-comparison .panel-header h3',
    info: {
      title: 'ORION × DPP Final',
      what: 'Compara os mesmos indicadores operacionais nas duas versões do cenário e destaca diferenças de valor e, quando possível, diferenças por modelo ou material.',
      source: 'Cenário mensal calculado pelo motor Python comparado com o resumo e as identidades de modelos/materiais lidas diretamente da aba DPP do arquivo final consolidado.',
      purpose: 'Responder se o ORION está reproduzindo o DPP Final e indicar em quais indicadores ainda existem divergências para investigação.',
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