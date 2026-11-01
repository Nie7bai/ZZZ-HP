/**
 * 「计算过程」按身份分块的 DOM 回归（内存 DOM，不启动服务）。
 *
 * 覆盖三件事：
 * 1. 异常类：提供者 / 触发者 / 共用 三块的分块、成员与顺序；
 * 2. 结果行（暴击/期望/不暴击伤害）与三块分开，仍单独成行；
 * 3. 直伤不分组：关掉 groupByActor 时不应出现「共用 · 敌方与环境」。
 */
import assert from 'node:assert/strict'
import { disposeStatsDomHarness, mountCalculatorComponent } from './_skillFlowStatsDomHarness.mjs'
import { buildEventValueTips } from '../src/utils/eventDamageSourceTips.ts'
import { resolveSkillFlowCalculationDetail } from '../src/utils/skillFlowCalculation.ts'

const { r5Fixture } = await import('./_eventElementHarness.mjs')

let passed = 0
function check(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}

function resolveCalc(damageType) {
  const fixture = r5Fixture('ordinary', damageType)
  return resolveSkillFlowCalculationDetail(fixture.context, null, fixture.hits[0])
}

function summaryOf(calc) {
  return {
    perHit: calc.evaluation.perHit,
    count: calc.evaluation.hit.count,
    total: calc.evaluation.total,
  }
}

/** 某一区块里的格子标签（.zone-display-label） */
function labelsIn(node) {
  return [...node.querySelectorAll('.zone-display-label')].map((el) => el.textContent.trim())
}

const anomalyCalc = resolveCalc('anomalyRelease')
const directCalc = resolveCalc('direct')

const anomalyView = await mountCalculatorComponent('FlowZoneCalculation', {
  calculation: anomalyCalc,
  summary: summaryOf(anomalyCalc),
  groupByActor: true,
  producerLabel: anomalyCalc.evaluation.producerAgentLabel,
  triggerLabel: anomalyCalc.evaluation.defenseTriggerAgentLabel,
})
const directView = await mountCalculatorComponent('FlowZoneCalculation', {
  calculation: directCalc,
  summary: summaryOf(directCalc),
  groupByActor: false,
})

const sections = anomalyView.all('.zone-box')
const headers = sections.map((section) => section.querySelector('.zone-box-name')?.textContent.trim())

check('异常类按身份分成三块，标题带角色名', () => {
  assert.equal(sections.length, 3, headers.join(' / '))
  assert.equal(headers[0], anomalyCalc.evaluation.producerAgentLabel)
  assert.equal(headers[1], anomalyCalc.evaluation.defenseTriggerAgentLabel)
  assert.equal(headers[2], '共用 · 敌方与环境')
  assert.ok(headers[0].startsWith('异常强度提供者 · '), headers[0])
  assert.ok(headers[1].startsWith('异常类触发者 · '), headers[1])
})

check('提供者块只放提供者侧乘区', () => {
  const labels = labelsIn(sections[0])
  for (const label of ['面板攻击力', '精通区', '等级区', '增伤区']) {
    assert.ok(labels.includes(label), `${label}: ${labels.join('/')}`)
  }
  for (const label of ['易伤区', '防御区', '异放倍率区']) {
    assert.ok(!labels.includes(label), `不应出现在提供者块：${label}`)
  }
})

check('触发者块放易伤与倍率/暴击，不放基础乘区', () => {
  const labels = labelsIn(sections[1])
  for (const label of ['抗性区', '易伤区', '异放增伤区', '异放倍率区']) {
    assert.ok(labels.includes(label), `${label}: ${labels.join('/')}`)
  }
  assert.ok(!labels.includes('面板攻击力'), labels.join('/'))
})

check('共用块只有敌方与环境相关的乘区', () => {
  assert.deepEqual(labelsIn(sections[2]), ['防御区'])
})

check('结果行不混进三块，单独成行', () => {
  const resultGrid = anomalyView.one('.zone-result-grid')
  assert.ok(resultGrid, '应有结果格')
  const resultLabels = labelsIn(resultGrid)
  assert.ok(resultLabels.includes('期望伤害'), resultLabels.join('/'))
  for (const section of sections) {
    assert.ok(!labelsIn(section).includes('期望伤害'), '三块里不应有结果行')
  }
})

check('分组模式下不再渲染旧的两栏拆分', () => {
  assert.equal(anomalyView.one('.zone-split'), null)
})

check('计算合计仍挂在最后', () => {
  assert.ok(anomalyView.text().includes('计算合计'), anomalyView.text().slice(0, 200))
})

check('直伤不分组：没有「共用 · 敌方与环境」这一块', () => {
  assert.equal(directCalc.evaluation.kind, 'direct')
  assert.equal(directView.one('.zone-box--mixed'), null)
  const texts = directView.all('.zone-box-name').map((el) => el.textContent.trim())
  assert.ok(!texts.includes('共用 · 敌方与环境'), texts.join(' / '))
})

/** 防御区来源弹层的读法：穿透率与穿透值同组，组标题写明是谁的局外面板 */
const anomalyTips = buildEventValueTips(anomalyCalc)
const defenseGroups = anomalyTips.defenseMultiplier

check('局外面板组标题带归属名，穿透值收进该组', () => {
  const label = anomalyCalc.evaluation.producerAgentLabel
  const panelGroup = defenseGroups.find((group) => group.label === `局外面板（${label}）`)
  assert.ok(panelGroup, defenseGroups.map((group) => group.label).join(' / '))
  assert.ok(
    panelGroup.items.some((item) => item.startsWith('穿透值')),
    panelGroup.items.join(' / '),
  )
  assert.ok(
    !defenseGroups.some(
      (group) =>
        group.label !== panelGroup.label &&
        group.label !== '加减过程' &&
        group.items.some((item) => item.startsWith('穿透值')),
    ),
    '穿透值不应再落在别组的来源行里',
  )
})

check('加减过程里穿透率与穿透值相邻', () => {
  const process = defenseGroups.find((group) => group.label === '加减过程')
  assert.ok(process, defenseGroups.map((group) => group.label).join(' / '))
  const penRateIndex = process.items.findIndex((item) => item.startsWith('穿透率'))
  const penIndex = process.items.findIndex((item) => item.startsWith('穿透值'))
  assert.ok(penRateIndex >= 0 && penIndex === penRateIndex + 1, process.items.join(' / '))
})

anomalyView.unmount()
directView.unmount()
await disposeStatsDomHarness()

console.log(`\n${passed} passed, 0 failed`)
