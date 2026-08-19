/**
 * 运行时验证：异常强度提供者基础伤害来源的身份规则、核心缺省兼容性与最优路径接线
 *
 * 面板组件的生产接线由 test-anomaly-provider-panel.mjs 覆盖。
 * 运行：npm run test:anomaly-provider-source
 */

import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
} from '../src/types/calculatorPanel.ts'
import {
  computeDamageResult,
  resolveAnomalyPowerBaseDamageSource,
} from '../src/utils/damageCalc.ts'
import {
  buildOptimalEvalContext,
  evaluateOptimalEventDetail,
} from '../src/utils/optimalAffixAlloc.ts'

let failed = 0

function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${expected}\n      实际 ${actual}`}`,
  )
}

const ownerPanel = createDefaultExternalPanel()
ownerPanel.hp = 20_000
ownerPanel.atk = 3_000
ownerPanel.def = 2_468
ownerPanel.mastery = 100
ownerPanel.anomalyMult = 100

const providerPanel = createDefaultExternalPanel()
providerPanel.hp = 10_000
providerPanel.atk = 4_321
providerPanel.def = 6_543
providerPanel.mastery = 100
providerPanel.anomalyMult = 100

const sharedInput = {
  finalPanel: ownerPanel,
  triggerFinalPanel: providerPanel,
  piercePower: 9_000,
  triggerPiercePower: 7_777,
  baseDamageSource: 'pierce',
  isMbMainAgent: true,
  triggerIsMb: false,
  enemyInput: {
    defense: 0,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
    level: 60,
  },
  combatVulnerable: 0,
  combatStaggerVulnerable: 0,
  combatSpecial: 0,
  staggerPhase: 'normal',
  anomalySubKind: 'anomaly',
  ownerAgentLevel: 60,
  triggerAgentLevel: 60,
}

const distinctNonMbSource = resolveAnomalyPowerBaseDamageSource({
  ownerAgentId: 'owner',
  anomalyPowerAgentId: 'provider',
  ownerBaseDamageSource: 'pierce',
  anomalyPowerAgentIsMb: false,
})
const sameOwnerDefSource = resolveAnomalyPowerBaseDamageSource({
  ownerAgentId: 'owner',
  anomalyPowerAgentId: 'owner',
  ownerBaseDamageSource: 'def',
  anomalyPowerAgentIsMb: false,
})
const sameOwnerPierceSource = resolveAnomalyPowerBaseDamageSource({
  ownerAgentId: 'owner',
  anomalyPowerAgentId: 'owner',
  ownerBaseDamageSource: 'pierce',
  anomalyPowerAgentIsMb: false,
})
const missingProviderSource = resolveAnomalyPowerBaseDamageSource({
  ownerAgentId: 'owner',
  anomalyPowerAgentId: null,
  ownerBaseDamageSource: 'def',
  anomalyPowerAgentIsMb: false,
})
const distinctMbSource = resolveAnomalyPowerBaseDamageSource({
  ownerAgentId: 'owner',
  anomalyPowerAgentId: 'mb-provider',
  ownerBaseDamageSource: 'def',
  anomalyPowerAgentIsMb: true,
})

check('异角色非命破提供者使用攻击力', distinctNonMbSource, 'atk')
check('同角色提供者沿用持有者来源', sameOwnerDefSource, 'def')
check('同角色提供者保留贯穿力来源', sameOwnerPierceSource, 'pierce')
check('未选择提供者时沿用持有者来源', missingProviderSource, 'def')
check('异角色命破提供者使用贯穿力', distinctMbSource, 'pierce')

const resolvedSourceResult = computeDamageResult({
  ...sharedInput,
  triggerBaseDamageSource: distinctNonMbSource,
})
const explicitAtkResult = computeDamageResult({
  ...sharedInput,
  triggerBaseDamageSource: 'atk',
})

check('解析后的非命破来源为攻击力', resolvedSourceResult.baseDamageSource, 'atk')
check('解析后的非命破基础伤害取提供者攻击力', resolvedSourceResult.baseDamage, 4_321)
check(
  '解析后的非命破异常基础与显式攻击力输入一致',
  resolvedSourceResult.anomalyBaseExpected,
  explicitAtkResult.anomalyBaseExpected,
)

const sameOwnerResult = computeDamageResult({
  ...sharedInput,
  finalPanel: ownerPanel,
  triggerFinalPanel: ownerPanel,
  baseDamageSource: 'def',
  triggerBaseDamageSource: sameOwnerDefSource,
  triggerIsMb: false,
})
check('同角色防御来源不会被改成攻击力', sameOwnerResult.baseDamage, ownerPanel.def)

const coreFallbackDefResult = computeDamageResult({
  ...sharedInput,
  finalPanel: ownerPanel,
  triggerFinalPanel: ownerPanel,
  baseDamageSource: 'def',
  triggerBaseDamageSource: undefined,
  triggerIsMb: false,
})
check('核心缺省仍沿用持有者防御来源', coreFallbackDefResult.baseDamage, ownerPanel.def)

const coreFallbackPierceResult = computeDamageResult({
  ...sharedInput,
  triggerBaseDamageSource: undefined,
  triggerIsMb: false,
})
check('核心缺省仍沿用持有者贯穿来源', coreFallbackPierceResult.baseDamage, 7_777)

const distinctMbResult = computeDamageResult({
  ...sharedInput,
  baseDamageSource: 'def',
  triggerBaseDamageSource: distinctMbSource,
  triggerIsMb: true,
})
check('异角色命破提供者使用自身贯穿力', distinctMbResult.baseDamage, 7_777)

const ownerAgentId = 'owner-mb'
const providerAgentId = 'provider-non-mb'
const makeSlot = (agentId, isMainC) => ({
  agentId,
  rank: 0,
  wengineId: 'none',
  wengineRefine: 1,
  isMainC,
  twoPieceDriveDiscId: 'none',
  fourPieceDriveDiscId: 'none',
})
const makeAgent = (id, name, profession, element) => ({
  id,
  name,
  profession,
  element,
  supportNeeds: [],
  avatar_image: null,
  note: '',
  basePanel: { anomalyControl: 0, energyRegen: 0 },
  mindscapeNotes: [],
  mindscapeBuffs: [],
})
const teamSlots = [makeSlot(ownerAgentId, true), makeSlot(providerAgentId, false)]
const agents = [
  makeAgent(ownerAgentId, '命破持有者', '命破', '物理'),
  makeAgent(providerAgentId, '非命破提供者', '异常', '火'),
]
const bangboo = {
  id: 'none',
  name: '无',
  avatar_image: null,
  effects: [],
  refinementEffects: [],
}
const hit = {
  id: 'hit-anomaly-provider-wiring',
  skill: {
    id: 'skill-anomaly-provider-wiring',
    name: '异常接线回归',
    agentId: ownerAgentId,
    source: 'custom',
    damageType: 'anomaly',
    skillTypes: [],
    buffAnchorId: null,
    baseMult: 100,
    baseMultFactor: 100,
  },
  ownerAgentId,
  anomalyPowerAgentId: providerAgentId,
  triggerAgentId: providerAgentId,
  count: 1,
  staggerPhase: 'normal',
  critMode: 'noCrit',
  damageKind: 'anomaly',
  anomalySubKind: 'anomaly',
  coords: [],
  isFollowUp: false,
  multOverrides: null,
  panelMods: null,
}
const optimalContext = buildOptimalEvalContext({
  isMb: true,
  teamSlots,
  agents,
  wengines: [],
  bangboo,
  bangbooRefine: 1,
  driveDiscs: [],
  mainSlotIndex: 0,
  driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
  enemyInput: sharedInput.enemyInput,
  baseDamageSource: 'pierce',
  anomalySlotPanels: { [providerAgentId]: providerPanel },
  hits: [hit],
})
const optimalDetail = evaluateOptimalEventDetail(optimalContext, ownerPanel, hit)
check('最优路径返回事件明细', Boolean(optimalDetail), true)
if (optimalDetail) {
  check('最优路径异角色非命破提供者使用攻击力', optimalDetail.result.baseDamageSource, 'atk')
  check('最优路径使用提供者攻击力数值', optimalDetail.result.baseDamage, 4_321)
}

const sameOwnerHit = {
  ...hit,
  id: 'hit-same-owner-source-wiring',
  skill: {
    ...hit.skill,
    id: 'skill-same-owner-source-wiring',
    agentId: providerAgentId,
  },
  ownerAgentId: providerAgentId,
  anomalyPowerAgentId: providerAgentId,
  triggerAgentId: providerAgentId,
}
const sameOwnerContext = buildOptimalEvalContext({
  isMb: false,
  teamSlots: [makeSlot(providerAgentId, true)],
  agents: [makeAgent(providerAgentId, '同角色提供者', '异常', '火')],
  wengines: [],
  bangboo,
  bangbooRefine: 1,
  driveDiscs: [],
  mainSlotIndex: 0,
  driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
  enemyInput: sharedInput.enemyInput,
  baseDamageSource: 'def',
  hits: [sameOwnerHit],
})
const sameOwnerDetail = evaluateOptimalEventDetail(sameOwnerContext, providerPanel, sameOwnerHit)
check('最优路径返回同角色事件明细', Boolean(sameOwnerDetail), true)
if (sameOwnerDetail) {
  check('最优路径同角色沿用防御来源', sameOwnerDetail.result.baseDamageSource, 'def')
  check('最优路径同角色使用防御数值', sameOwnerDetail.result.baseDamage, 6_543)
}

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
