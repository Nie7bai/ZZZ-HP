/**
 * 探针：导入弹窗「刷新后第一次打开配置为空」。
 *
 * 复刻 `UnifiedPresetPicker.vue` 里两个 watch 的结构与注册顺序（真实代码见 `watch(open)`
 * 与 `watch(() => selected.value.agentId)`），用真实 Vue runtime 跑，观察打开时回填的
 * 草稿会不会被随后的「换角色」watch 覆盖。
 *
 * 修复前（2026-09-12 之前）输出：
 *   ❌ 第一次打开（刷新后）：词条 0 条 | 主属性 critDmg/externalAtkPercent | 面板攻击 1000
 *   ✅ 第二次打开（关掉再打开）：词条 56 条 | 主属性 critDmg/atkPercent | 面板攻击 2915.56
 * 即「刷新后第一次打开是空的，关掉再打开才正常」。
 *
 * 运行：npx vite-node scripts/probe-preset-picker-first-open.mjs
 */
import { nextTick, reactive, ref, watch } from 'vue'
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  createExternalPanelFromAgentBase,
} from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import { panelOfSource } from '../src/utils/agentPanelSources.ts'
import { shouldResetDraftsOnAgentChange } from '../src/utils/presetPickerDraftReset.ts'
import { createDefaultSkillTalentLevels, fillSkillTalentLevels } from '../src/utils/skillTalentLevels.ts'

// --- 模拟 props（与组件同名字段）---
const props = {
  agents: [
    { id: 'agentA', name: '角色A', basePanel: { ...createEmptyAgentBasePanel(), atk: 1000 } },
    { id: 'agentB', name: '角色B', basePanel: { ...createEmptyAgentBasePanel(), atk: 1200 } },
  ],
  teamSlots: [
    { agentId: 'agentA', rank: 1, wengineId: 'w1', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
  ],
  activeSlot: 0,
  /** 槽位里存着的两份面板（被测的「配置」） */
  slotPanels: {
    agentA: {
      importedPanel: { ...createDefaultExternalPanel(), atk: 2915.56, critDmg: 98, mastery: 230 },
      affixCounts: { ...createEmptyAffixCounts(), hpFlat: 4, hpPercent: 11, atkFlat: 4, atkPercent: 25, critDmg: 10, mastery: 2 },
      affixDriveDiscMainStats: { slot4MainStat: 'critDmg', slot5MainStat: 'atkPercent', slot6MainStat: 'hpPercent' },
      active: 'imported',
    },
  },
  skillTalentLevelsByAgent: {
    agentA: { basic: 11, dodge: 11, assist: 11, special: 11, chainUltimate: 11 },
  },
}

// --- 组件状态（同名复刻）---
const open = ref(false)
const selected = ref({ agentId: '', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceId: 'none', fourPieceId: 'none' })
const draftExternalPanel = reactive(createDefaultExternalPanel())
const draftAffixCounts = reactive(createEmptyAffixCounts())
const draftAffixMains = reactive(createDefaultAffixDriveDiscMainStats())
const draftSkillTalentLevels = reactive(createDefaultSkillTalentLevels())

/** 与组件 L196 `resetDraftPanelFromSlot` 同构 */
function resetDraftPanelFromSlot() {
  const slot = props.teamSlots[props.activeSlot]
  const agentId = selected.value.agentId || slot?.agentId || ''
  const agent = props.agents.find((item) => item.id === agentId)
  const sources = agentId ? props.slotPanels?.[agentId] : undefined
  Object.assign(draftAffixCounts, createEmptyAffixCounts(), sources?.affixCounts)
  Object.assign(draftAffixMains, createDefaultAffixDriveDiscMainStats(), sources?.affixDriveDiscMainStats)
  Object.assign(
    draftSkillTalentLevels,
    createDefaultSkillTalentLevels(selected.value.rank),
    fillSkillTalentLevels(agentId ? props.skillTalentLevelsByAgent?.[agentId] : null, selected.value.rank || slot?.rank || 0),
  )
  const saved = panelOfSource(sources, 'imported')
  if (saved) {
    Object.assign(draftExternalPanel, createDefaultExternalPanel(), saved)
  } else if (agent) {
    Object.assign(draftExternalPanel, createExternalPanelFromAgentBase(agent.basePanel))
  } else {
    Object.assign(draftExternalPanel, createDefaultExternalPanel())
  }
}

// --- 组件里两个 watch，保持注册顺序 ---
/** 打开弹窗时按槽位回填的角色 id（与组件同名） */
let agentIdRestoredOnOpen = null

watch(open, (isOpen) => {
  if (!isOpen) {
    agentIdRestoredOnOpen = null
    return
  }
  const slot = props.teamSlots[props.activeSlot]
  if (!slot) return
  selected.value = {
    agentId: slot.agentId || '',
    rank: slot.rank,
    wengineId: slot.wengineId,
    wengineRefine: slot.wengineRefine,
    twoPieceId: slot.twoPieceDriveDiscId,
    fourPieceId: slot.fourPieceDriveDiscId,
  }
  agentIdRestoredOnOpen = selected.value.agentId || null
  resetDraftPanelFromSlot()
})

watch(
  () => selected.value.agentId,
  (newId, oldId) => {
    const restoredOnOpen = agentIdRestoredOnOpen
    agentIdRestoredOnOpen = null
    if (
      !shouldResetDraftsOnAgentChange({
        isOpen: open.value,
        oldAgentId: oldId,
        newAgentId: newId,
        agentIdRestoredOnOpen: restoredOnOpen,
      })
    ) {
      return
    }
    const agent = props.agents.find((item) => item.id === newId)
    if (agent) {
      Object.assign(draftExternalPanel, createExternalPanelFromAgentBase(agent.basePanel))
    } else {
      Object.assign(draftExternalPanel, createDefaultExternalPanel())
    }
    Object.assign(draftAffixCounts, createEmptyAffixCounts())
    Object.assign(draftAffixMains, createDefaultAffixDriveDiscMainStats())
    Object.assign(
      draftSkillTalentLevels,
      createDefaultSkillTalentLevels(selected.value.rank),
      fillSkillTalentLevels(props.skillTalentLevelsByAgent?.[newId], selected.value.rank),
    )
  },
)

/** 槽位里存着的那份：词条 56 条（4+11+4+25+10+2）、主属性 critDmg/atkPercent、面板攻击 2915.56、技能等级 11 */
const EXPECTED = { counts: 56, majors: 'critDmg/atkPercent', panelAtk: 2915.56, skill: 11 }

function snapshot(label) {
  const counts = Object.values(draftAffixCounts).reduce((sum, n) => sum + Number(n || 0), 0)
  const majors = `${draftAffixMains.slot4MainStat}/${draftAffixMains.slot5MainStat}`
  const panelAtk = Math.round(draftExternalPanel.atk * 100) / 100
  const skill = Number(draftSkillTalentLevels.basic)
  const ok =
    counts === EXPECTED.counts &&
    majors === EXPECTED.majors &&
    panelAtk === EXPECTED.panelAtk &&
    skill === EXPECTED.skill
  console.log(
    `${ok ? '✅' : '❌'} ${label}：词条 ${counts} 条 | 主属性 ${majors} | 面板攻击 ${panelAtk} | 技能等级 ${skill}`,
  )
  return ok
}

console.log(
  `槽位里存着：词条 ${EXPECTED.counts} 条 | 主属性 ${EXPECTED.majors} | 面板攻击 ${EXPECTED.panelAtk} | 技能等级 ${EXPECTED.skill}\n`,
)

// ① 刷新后第一次打开
open.value = true
await nextTick()
const firstOk = snapshot('第一次打开（刷新后）')

// ② 关掉再打开
open.value = false
await nextTick()
open.value = true
await nextTick()
const secondOk = snapshot('第二次打开（关掉再打开）')

// ③ 用户换角色 → 应当重置草稿（既有行为，不能被修复破坏）
selected.value.agentId = 'agentB'
await nextTick()
const switchedCounts = Object.values(draftAffixCounts).reduce((sum, n) => sum + Number(n || 0), 0)
const switchOk = switchedCounts === 0 && Math.round(draftExternalPanel.atk) === 1200
console.log(`${switchOk ? '✅' : '❌'} 用户换到角色B：词条 ${switchedCounts} 条 | 面板攻击 ${Math.round(draftExternalPanel.atk)}（应回落角色B基础面板）`)

console.log('')
if (!firstOk && secondOk) {
  console.log('→ 复现：第一次打开被覆盖，第二次正常（与所有者报告一致）')
} else if (firstOk && secondOk) {
  console.log('→ 第一次打开已正常（修复生效）')
} else {
  console.log('→ 未复现出报告的现象，需重新排查')
}
process.exit(firstOk && secondOk && switchOk ? 0 : 1)
