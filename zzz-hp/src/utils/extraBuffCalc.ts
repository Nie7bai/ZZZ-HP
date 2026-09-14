import type {
  BuffApplySituation,
  BuffEffect,
  BuffScope,
  BuffSkillTarget,
  BuffStatModifiers,
  SkillCalcContext,
  StaggerPhase,
} from '@/types/calculator'
import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import {
  countTeamProfession,
  createEmptyBuffEffect,
  effectMatchesContext,
  effectMatchesTeamProfessionGate,
  resolveEffectsToMods,
} from '@/utils/buffEffect'
import { createEmptyBuffStatModifiers, mergeBuffStatModifiers } from '@/utils/calculatorUi'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

export type { ExtraBuffGain }

export type ExtraBuffApplySlot = number | 'team'

/**
 * 额外 Buff 作用对象：全队，或固定槽位 0/1/2。
 * 旧数据 `applyTarget: 'self'`（跟编辑中角色走）视为角色1，避免切编辑者带动流程伤害。
 */
export function resolveExtraGainApplySlot(
  gain: Pick<ExtraBuffGain, 'applySlot' | 'applyTarget'>,
): ExtraBuffApplySlot {
  if (gain.applySlot === 'team' || gain.applyTarget === 'team') return 'team'
  if (
    typeof gain.applySlot === 'number' &&
    Number.isInteger(gain.applySlot) &&
    gain.applySlot >= 0 &&
    gain.applySlot <= 2
  ) {
    return gain.applySlot
  }
  return 0
}

export function extraGainAppliesToSlot(
  gain: Pick<ExtraBuffGain, 'applySlot' | 'applyTarget'>,
  slotIndex: number,
): boolean {
  const applySlot = resolveExtraGainApplySlot(gain)
  return applySlot === 'team' || applySlot === slotIndex
}

export function normalizeExtraGain<T extends ExtraBuffGain>(gain: T): T {
  const applySlot = resolveExtraGainApplySlot(gain)
  return {
    ...gain,
    applySlot,
    applyTarget: applySlot === 'team' ? 'team' : 'self',
  }
}

export function extraGainApplySlotLabel(
  gain: Pick<ExtraBuffGain, 'applySlot' | 'applyTarget'>,
  teamSlots: Array<{ agentId?: string | null }>,
  agents: Array<{ id: string; name: string }>,
): string {
  const applySlot = resolveExtraGainApplySlot(gain)
  if (applySlot === 'team') return '全队'
  const slot = teamSlots[applySlot]
  if (!slot) return `角色${applySlot + 1}`
  return teamSlotDisplayLabel(slot, applySlot, agents)
}

export function extraGainToEffect(gain: ExtraBuffGain): BuffEffect {
  const applySlot = resolveExtraGainApplySlot(gain)
  return createEmptyBuffEffect({
    id: gain.id,
    scope: gain.scope ?? 'general',
    applyTarget: applySlot === 'team' ? 'team' : 'self',
    applySituation: gain.applySituation ?? 'global',
    applyProfession: gain.applyProfession ?? null,
    teamProfession: gain.teamProfession ?? null,
    teamProfessionValues: gain.teamProfessionValues ?? null,
    teamProfessionMinCount: gain.teamProfessionMinCount ?? null,
    skillTargets: normalizeExtraGainSkillTargets(gain),
    skillCategory: gain.skillCategory,
    skillSubcategoryId: gain.skillSubcategoryId,
    appliesToAnomaly: gain.appliesToAnomaly,
    kind: 'fixed',
    stat: gain.stat,
    value: gain.value,
    enabledDefault: true,
  })
}

export function extraGainMatchesEvent(
  gain: ExtraBuffGain,
  skillCtx: SkillCalcContext,
): boolean {
  return effectMatchesContext(extraGainToEffect(gain), skillCtx)
}

export function extraGainMatchesProfession(
  gain: Pick<{ applyProfession?: string | null }, 'applyProfession'>,
  beneficiaryProfession: string | null | undefined,
): boolean {
  const required = gain.applyProfession?.trim()
  if (!required) return true
  const profession = String(beneficiaryProfession ?? '').trim()
  return profession === required
}

export function extraGainMatchesTeamProfessionGate(
  gain: Pick<
    ExtraBuffGain,
    'teamProfession' | 'teamProfessionValues' | 'teamProfessionMinCount' | 'value'
  >,
  teamSlots: Array<{ agentId?: string | null }>,
  agents: Array<{ id: string; profession?: string | null }>,
): boolean {
  const required = gain.teamProfession?.trim()
  if (!required) return true
  const count = countTeamProfession(teamSlots, agents, required)
  return effectMatchesTeamProfessionGate(gain, count)
}

export function resolveExtraGainValue(
  gain: ExtraBuffGain,
  teamSlots?: Array<{ agentId?: string | null }>,
  agents?: Array<{ id: string; profession?: string | null }>,
): number | null {
  if (gain.teamProfession?.trim() && teamSlots && agents) {
    if (!extraGainMatchesTeamProfessionGate(gain, teamSlots, agents)) return null
  }
  return gain.value
}

export type ExtraGainMergeOptions = {
  /** 当前正在汇总面板的槽位 */
  slotIndex: number
  /** 当前正在汇总面板的 agentId */
  slotAgentId: string
  staggerPhase: StaggerPhase
  resolveAgentProfession?: (agentId: string) => string | undefined
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: Array<{ id: string; profession?: string | null; name?: string }>
}

/**
 * 旧摊平：直接写 BuffStatModifiers。阶段 6 双跑对照用，生产走 `mergeExtraModsForEvent`。
 */
export function mergeExtraModsForEventDirect(
  gains: ExtraBuffGain[],
  skillCtx: SkillCalcContext,
  options: ExtraGainMergeOptions,
): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()
  for (const gain of gains) {
    const situation: BuffApplySituation = gain.applySituation ?? 'global'
    if (situation === 'stagger' && options.staggerPhase !== 'stagger') continue
    if (situation === 'non_stagger' && options.staggerPhase !== 'normal') continue
    if (!extraGainMatchesEvent(gain, skillCtx)) continue
    if (!extraGainAppliesToSlot(gain, options.slotIndex)) continue

    const beneficiaryProfession = options.resolveAgentProfession?.(options.slotAgentId)
    if (!extraGainMatchesProfession(gain, beneficiaryProfession)) continue

    const amount = resolveExtraGainValue(gain, options.teamSlots, options.agents)
    if (amount == null) continue

    const next = createEmptyBuffStatModifiers()
    next[gain.stat] = amount
    total = mergeBuffStatModifiers(total, next)
  }
  return total
}

/**
 * 额外增益走 BuffEffect 适配器再 `resolveEffectsToMods`。
 *
 * 勾选表强制全开：角色 Buff 的 `isEffectEnabled` 会把「有队内职业人数条件、未进勾选」
 * 默认关掉；额外增益没有勾选 UI，不能吃那条规则。
 */
export function mergeExtraModsViaEffects(
  gains: ExtraBuffGain[],
  skillCtx: SkillCalcContext,
  options: ExtraGainMergeOptions,
): BuffStatModifiers {
  const effects: BuffEffect[] = []
  for (const gain of gains) {
    const situation: BuffApplySituation = gain.applySituation ?? 'global'
    if (situation === 'stagger' && options.staggerPhase !== 'stagger') continue
    if (situation === 'non_stagger' && options.staggerPhase !== 'normal') continue
    if (!extraGainAppliesToSlot(gain, options.slotIndex)) continue
    effects.push(extraGainToEffect(gain))
  }
  if (!effects.length) return createEmptyBuffStatModifiers()
  const enabledIds = Object.fromEntries(effects.map((effect) => [effect.id, true]))
  const teamSlots = options.teamSlots
  const agents = options.agents
  return resolveEffectsToMods(effects, {
    applyTargets: ['self', 'team'],
    ctx: skillCtx,
    selection: { enabledIds },
    beneficiaryProfession: options.resolveAgentProfession?.(options.slotAgentId) ?? null,
    resolveTeamProfessionCount:
      teamSlots && agents
        ? (profession) => countTeamProfession(teamSlots, agents, profession)
        : undefined,
  })
}

export function mergeExtraModsForEvent(
  gains: ExtraBuffGain[],
  skillCtx: SkillCalcContext,
  options: ExtraGainMergeOptions,
): BuffStatModifiers {
  return mergeExtraModsViaEffects(gains, skillCtx, options)
}

export function scopeLabel(scope: BuffScope | undefined): string {
  const map: Record<BuffScope, string> = {
    general: '通用',
    skill: '招式',
    anomaly: '异常',
    disorder: '紊乱',
    turbulence: '乱流',
    anomalyRelease: '异放',
    radiance: '耀变',
    mutation: '异化系数',
  }
  return map[scope ?? 'general']
}

export function normalizeExtraGainSkillTargets(gain: ExtraBuffGain): BuffSkillTarget[] | undefined {
  if (gain.skillCategory) {
    return [
      {
        category: gain.skillCategory,
        subcategoryId: gain.skillSubcategoryId ?? null,
      },
    ]
  }
  return undefined
}
