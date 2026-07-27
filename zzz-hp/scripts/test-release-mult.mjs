/**
 * 运行时验证：异放倍率按产生角色属性筛选主 C 异放倍率增益
 * 运行：node --import tsx scripts/test-release-mult.mjs
 */
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { createEmptySelfTeamBuffs } from '../src/utils/calculatorUi.ts'
import { resolveMainCAnomalyReleaseMultFields } from '../src/utils/panelBuffCalc.ts'

const mainAgentId = 'main-ether'
const external = createDefaultExternalPanel()
external.anomalyReleaseMult = 50

const fireBuff = {
  id: 'buff-fire',
  scope: 'anomalyRelease',
  applyTarget: 'self',
  elementFilter: ['火'],
  kind: 'fixed',
  stat: 'anomalyReleaseMult',
  value: 20,
}

const physBuff = {
  id: 'buff-phys',
  scope: 'anomalyRelease',
  applyTarget: 'self',
  elementFilter: ['物理'],
  kind: 'fixed',
  stat: 'anomalyReleaseMult',
  value: 30,
}

const agent = {
  id: mainAgentId,
  name: '测试主C',
  element: '以太',
  profession: '异常',
  avatar_image: null,
  basePanel: {},
  mindscapeBuffs: [
    {
      ...createEmptySelfTeamBuffs(),
      effects: [fireBuff, physBuff],
    },
  ],
}

const ctx = {
  teamSlots: [{ agentId: mainAgentId, rank: 0, wengineId: 'none', wengineRefine: 1, isMainC: true, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }],
  agents: [agent],
  wengines: [],
  bangboo: { id: 'none', name: '无', effects: [], refinementEffects: [] },
  bangbooRefine: 1,
  mainSlotIndex: 0,
  driveDiscs: [],
  buffSelection: { enabledIds: {}, stacksByEffectId: {}, convertInputs: {} },
}

const fireResult = resolveMainCAnomalyReleaseMultFields(external, ctx, '火')
const physResult = resolveMainCAnomalyReleaseMultFields(external, ctx, '物理')

let failed = false
if (fireResult.anomalyReleaseMult !== 70) {
  console.error(`FAIL 火触发: 期望 70，实际 ${fireResult.anomalyReleaseMult}`)
  failed = true
} else {
  console.log(`PASS 火触发: 异放倍率% = ${fireResult.anomalyReleaseMult}`)
}

if (physResult.anomalyReleaseMult !== 80) {
  console.error(`FAIL 物理触发: 期望 80，实际 ${physResult.anomalyReleaseMult}`)
  failed = true
} else {
  console.log(`PASS 物理触发: 异放倍率% = ${physResult.anomalyReleaseMult}`)
}

process.exit(failed ? 1 : 0)
