import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingInvestigationItems, qualityPendingItems } from '../src/pending-investigation-items.js'
import { currentInvestigationReports } from '../src/current-investigation-reports.js'
import { buildStockInvestigationReportKey } from '../src/dpp-workspace-state.js'

const stock = {
  materials: [
    { material:'A', description:'Peça A', negative_balance:10, candidates:[
      { candidate_id:'a1', depot:'M221' }, { candidate_id:'a2', depot:'P277' },
      { candidate_id:'a3', depot:'M221', validation:{id:3} },
    ] },
    { material:'B', negative_balance:4, candidates:[{candidate_id:'b1', depot:'M221', validation:{id:4}}] },
  ],
  workflow:{forward_to_quality:[{material:'A'}]},
}
const quality = {materials:[
  {material:'C', description:'Peça C', active_depot:'Q239', candidates:[{candidate_id:'c1',depot:'Q239'}]},
  {material:'D', active_depot:'Q273', candidates:[{candidate_id:'d1',depot:'Q273',validation:{id:1}}]},
]}

test('fila mostra PNs únicos e apenas depósitos com candidatos pendentes', () => {
  assert.deepEqual(pendingInvestigationItems(stock,'stock'), [
    {pn:'A',description:'Peça A',depots:['M221','P277']},
  ])
  assert.deepEqual(pendingInvestigationItems(quality,'quality'), [
    {pn:'C',description:'Peça C',depots:['Q239']},
  ])
})

test('sem consulta não é zero; qualidade sem encaminhamentos comprovados é zero', () => {
  assert.equal(pendingInvestigationItems(null,'stock'),null)
  assert.equal(qualityPendingItems(null,null),null)
  assert.equal(qualityPendingItems(stock,null),null)
  assert.deepEqual(qualityPendingItems({workflow:{forward_to_quality:[]}},null),[])
})

test('seleção de relatórios rejeita pacote e revisão obsoletos', () => {
  const scenario={scenario_id:'scenarioA',reference_month:'2026-07',models:[],materials:[]}
  const stockFile={name:'STK.xlsx',size:11,lastModified:7}
  const dppState={bundle:{signature:'bundle-1'}}
  const packageKey='bundle-1|STK.xlsx:11:7'
  const stockKey=buildStockInvestigationReportKey(packageKey,scenario)
  const revisions=stock.materials.flatMap(m=>m.candidates.map(c=>c.candidate_id+':'+(c.validation?.id||0))).join(';')
  const args={
    dppState,workspaceReady:true,stockFile,scenario,
    stockInvestigation:{packageKey,reportKey:stockKey,result:stock},
    qualityInvestigation:{reportKey:stockKey+'|quality-4.2-v2|'+revisions,result:quality},
  }
  const current=currentInvestigationReports(args)
  assert.equal(current.stock,stock)
  assert.equal(current.quality,quality)
  assert.equal(currentInvestigationReports({...args,dppState:{bundle:{signature:'bundle-2'}}}).stock,null)
  assert.equal(currentInvestigationReports({...args,qualityInvestigation:{reportKey:'obsolete',result:quality}}).quality,null)
})
