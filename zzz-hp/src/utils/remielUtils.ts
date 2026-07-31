import type { DamageEventKind } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { multFactorPercentToRatio } from '@/utils/multFactorPercent'

/** 流明属性：当前仅蕾米埃尔 */
export const LUMINOUS_ELEMENT = '流明'

export function isLuminousElement(element: string | null | undefined): boolean {
  return element === LUMINOUS_ELEMENT
}

export function isLuminousAgent(
  agent: { element?: string | null } | null | undefined,
): boolean {
  return isLuminousElement(agent?.element ?? null)
}

/** 旧四类异常事件（非耀变） */
export function isLegacyAnomalyEventKind(kind: DamageEventKind): boolean {
  return kind === 'anomaly' || kind === 'disorder' || kind === 'turbulence' || kind === 'anomalyRelease'
}

/**
 * 直伤 Buff 匹配：流明角色取下一槽位等价属性（1→2→3→1；中间空槽顺延）。
 */
export function resolveLuminousEquivalentElement(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
  luminousSlotIndex: number,
): string | undefined {
  const order = [
    (luminousSlotIndex + 1) % teamSlots.length,
    (luminousSlotIndex + 2) % teamSlots.length,
  ]
  for (const index of order) {
    const slot = teamSlots[index]
    if (!slot?.agentId) continue
    const agent = agents.find((item) => item.id === slot.agentId)
    const element = agent?.element?.trim()
    if (element && !isLuminousElement(element)) return element
  }
  return undefined
}

export function findLuminousSlotIndex(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
): number | null {
  for (let index = 0; index < teamSlots.length; index += 1) {
    const agent = agents.find((item) => item.id === teamSlots[index]?.agentId)
    if (isLuminousAgent(agent)) return index
  }
  return null
}

export function findLuminousAgentInTeam(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
): { id: string; element: string; slotIndex: number } | null {
  for (let index = 0; index < teamSlots.length; index += 1) {
    const agentId = teamSlots[index]?.agentId
    if (!agentId) continue
    const agent = agents.find((item) => item.id === agentId)
    if (isLuminousAgent(agent)) {
      return { id: agent!.id, element: agent!.element, slotIndex: index }
    }
  }
  return null
}

/** 产生角色候选：旧四类不可选流明；耀变异常产生角色可为全队（含蕾米埃尔） */
export function canAgentBeAnomalyProducerForKind(
  agent: { element?: string | null } | null | undefined,
  kind: DamageEventKind,
): boolean {
  if (!agent) return false
  if (kind === 'radiance') return true
  if (isLuminousAgent(agent)) return false
  return isLegacyAnomalyEventKind(kind)
}

export function computeMutationZone(
  panel: Pick<PanelStats, 'mutationCoeff' | 'mutationCoeffFactor'>,
): number {
  const ratio = multFactorPercentToRatio(panel.mutationCoeffFactor) || 1
  return Math.max(0, 1 + panel.mutationCoeff / 100) * ratio
}

export function computeRadianceMultZone(
  panel: Pick<PanelStats, 'radianceMult' | 'radianceMultFactor'>,
): number {
  const ratio = multFactorPercentToRatio(panel.radianceMultFactor) || 1
  return Math.max(0, panel.radianceMult / 100) * ratio
}

export function computeSpecialMultZone(
  panel: Pick<PanelStats, 'specialMult' | 'specialMultFactor'>,
): number {
  const ratio = multFactorPercentToRatio(panel.specialMultFactor) || 1
  return Math.max(0, (panel.specialMult ?? 100) / 100) * ratio
}

export interface RemielSelfRadianceCalcInput {
  agentLevel: number
  inCombatAtk: number
  inCombatMastery: number
  mutationZone: number
  penRate: number
  pen: number
  resPen: number
  radianceResPen: number
  /** 下一位非流明队友属性，用于敌方抗性基准 */
  resistanceElement: string | null
  isMb: boolean
}

function clampRemielLevel(level: number): number {
  return Math.min(60, Math.max(1, Math.round(level)))
}

/** 特殊等级区 = 1 + 0.025 × 等级 */
export function computeRemielSelfRadianceSpecialLevelZone(level: number): number {
  return 1 + 0.025 * clampRemielLevel(level)
}

/** @deprecated 使用 computeRemielSelfRadianceSpecialLevelZone */
export function computeRemielSelfRadianceLevelZone(level: number): number {
  return computeRemielSelfRadianceSpecialLevelZone(level)
}

/** 标准等级区 = 1 + (等级 - 1) / 59 */
export function computeRemielSelfRadianceStandardLevelZone(level: number): number {
  const safeLevel = clampRemielLevel(level)
  return 1 + (safeLevel - 1) / 59
}

/** 蕾米埃尔异常基础 = 局内攻 × 局内精通区 × 特殊等级区 × 异化系数 × 标准等级区 */
export function computeRemielSelfAnomalyBase(
  input: Pick<
    RemielSelfRadianceCalcInput,
    'inCombatAtk' | 'inCombatMastery' | 'mutationZone' | 'agentLevel'
  >,
): number {
  const atk = Math.max(0, input.inCombatAtk)
  const masteryZone = Math.max(0, input.inCombatMastery) / 100
  const specialLevelZone = computeRemielSelfRadianceSpecialLevelZone(input.agentLevel)
  const levelZone = computeRemielSelfRadianceStandardLevelZone(input.agentLevel)
  const mutationZone = Math.max(0, input.mutationZone)
  return atk * masteryZone * specialLevelZone * mutationZone * levelZone
}

export function resolveWengineMasteryForSlot(
  teamSlots: Array<{ wengineId?: string }>,
  wengines: Array<{ id: string; advancedStats: { mastery: number } }>,
  slotIndex: number,
): number {
  const wengineId = teamSlots[slotIndex]?.wengineId
  if (!wengineId || wengineId === 'none') return 0
  return wengines.find((item) => item.id === wengineId)?.advancedStats.mastery ?? 0
}

export function isRemielSelfRadianceTrigger(
  triggerAgentId: string | null | undefined,
  remielId: string | null | undefined,
): boolean {
  return Boolean(remielId && triggerAgentId && triggerAgentId === remielId)
}

/**
 * Buff 属性限定：流明不参与元素白名单匹配（「全部属性」仍生效）。
 */
export function effectMatchesElementForCalc(
  elementFilter: 'all' | string[] | undefined,
  element: string | undefined,
): boolean {
  if (!elementFilter || elementFilter === 'all') return true
  if (!element) return false
  if (isLuminousElement(element)) return false
  return elementFilter.includes(element)
}
