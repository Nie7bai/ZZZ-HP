import type {
  AnomalyDamageSubKind,
  DamageCalcKind,
  DamageEventCritMode,
  DamageEventMultOverrides,
  Skill,
  SkillCalcContext,
  SkillGroup,
  SkillMatchCoord,
  SkillSubcategory,
  StaggerPhase,
} from '@/types/calculator'
import type {
  FlowEntry,
  PreparedGroupMemberAgents,
  PreparedSkill,
  PreparedSkillExtraMods,
  SchemeSlot,
} from '@/types/damageCalcHistory'
import type { DamageCalcInput, DamageCalcResult } from '@/utils/damageCalc'
import { computeDamageResult } from '@/utils/damageCalc'
import {
  DAMAGE_EVENT_KIND_OPTIONS,
  disorderLabelFromResult,
  getTurbulenceParticipationFailureReason,
  mapEventKindToCalc,
  pickEventDamage,
  resolveFlowHitCritMode,
} from '@/utils/damageEvent'
import {
  canAgentBeAnomalyProducerForKind,
  findLuminousAgentInTeam,
  isLegacyAnomalyEventKind,
  isLuminousAgent,
} from '@/utils/remielUtils'
import {
  findMemberAgents,
  findMemberOverride,
  skillGroupMemberKey,
  sortSkillGroupMembers,
} from '@/utils/skillGroup'
import { buildSkillMatchCoords, skillTypesIncludeFollowUp } from '@/utils/skillTypes'
import {
  resolveEffectiveBaseMult,
  type SkillTalentLevels,
} from '@/utils/skillTalentLevels'

export function newLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createEmptySchemeSlot(): SchemeSlot {
  return { prepared: [], flow: [] }
}

export function ensureSchemeSlots(
  slots: SchemeSlot[] | null | undefined,
  count = 3,
): SchemeSlot[] {
  const next = (slots ?? []).map((slot) => ({
    prepared: [...(slot.prepared ?? [])],
    flow: [...(slot.flow ?? [])],
  }))
  while (next.length < count) next.push(createEmptySchemeSlot())
  return next.slice(0, count)
}

export function schemeSlotsHaveContent(slots?: SchemeSlot[] | null): boolean {
  return (slots ?? []).some(
    (slot) => (slot.prepared?.length ?? 0) > 0 || (slot.flow?.length ?? 0) > 0,
  )
}

/** 异常类伤害（含属性异常/异放/紊乱/乱流/耀变）都要选双代理人 */
export function skillNeedsDualAgents(damageType: Skill['damageType']): boolean {
  return mapEventKindToCalc(damageType).damageKind === 'anomaly'
}

export function defaultAnomalyAgents(
  damageType: Skill['damageType'],
  ownerAgentId: string,
): { anomalyPowerAgentId: string | null; triggerAgentId: string | null } {
  if (!skillNeedsDualAgents(damageType)) {
    return { anomalyPowerAgentId: null, triggerAgentId: null }
  }
  // 异常类：强度提供者与触发者均默认当前流程角色，倍率走角色原有面板/招式值
  return { anomalyPowerAgentId: ownerAgentId, triggerAgentId: ownerAgentId }
}

/** 为组内异常段生成默认双代理人（加入准备时） */
export function buildDefaultMemberAgents(
  group: SkillGroup,
  ownerAgentId: string,
  findSkill: (id: string) => Skill | null | undefined,
): PreparedGroupMemberAgents[] {
  const rows: PreparedGroupMemberAgents[] = []
  for (const member of sortSkillGroupMembers(group.members)) {
    const skill = findSkill(member.skillId)
    if (!skill || !skillNeedsDualAgents(skill.damageType)) continue
    const defaults = defaultAnomalyAgents(skill.damageType, ownerAgentId)
    rows.push({
      memberKey: skillGroupMemberKey(member),
      skillId: member.skillId,
      anomalyPowerAgentId: defaults.anomalyPowerAgentId,
      triggerAgentId: defaults.triggerAgentId,
    })
  }
  return rows
}

/**
 * 一次结算单元：流程里的一条，连同它引用的招式与准备阶段参数，全部解开摊平。
 *
 * 这是新架构下伤害计算的唯一输入。主计算页与最优词条分配吃同一份，
 * 因此「准备阶段改的倍率」「流程里的次数与失衡状态」对两者一致生效。
 */
export interface ResolvedHit {
  /** 取流程条目 id，方便回指 UI */
  id: string
  skill: Skill
  /** 流程归属角色；直伤取其面板。异常类只用于伤害归属，减防/无视取 triggerAgentId */
  ownerAgentId: string
  /** 异常强度提供者，留空则本条不计算 */
  anomalyPowerAgentId: string | null
  /** 异常类触发者，留空则本条不计算 */
  triggerAgentId: string | null
  count: number
  staggerPhase: StaggerPhase
  critMode: DamageEventCritMode
  damageKind: DamageCalcKind
  anomalySubKind: AnomalyDamageSubKind
  /** 招式类型翻译成的旧 Buff 坐标，命中任意一个即生效；空数组 = 不吃招式限定 Buff */
  coords: SkillMatchCoord[]
  isFollowUp: boolean
  /** 招式倍率 + 准备阶段增量，已并入旧的覆写结构 */
  multOverrides: DamageEventMultOverrides | null
  /** 准备阶段的属性增量（增伤/暴击等），加算并入对应乘区 */
  panelMods: PreparedSkillExtraMods | null
  /** 本击结算用的有效基础倍率%（nanoka 按技能等级重算后） */
  effectiveBaseMult: number
  /** 映射到的五大类等级；无法映射则为 null */
  skillTalentLevel: number | null
}

/** 每种伤害类型的倍率写到哪两个覆写字段 */
const MULT_FIELDS: Record<
  Skill['damageType'],
  { mult: keyof DamageEventMultOverrides; factor: keyof DamageEventMultOverrides }
> = {
  direct: { mult: 'directDmgMult', factor: 'directDmgMultFactor' },
  sharpen: { mult: 'directDmgMult', factor: 'directDmgMultFactor' },
  anomaly: { mult: 'anomalyMult', factor: 'anomalyMultFactor' },
  anomalyRelease: { mult: 'anomalyReleaseMult', factor: 'anomalyReleaseMultFactor' },
  disorder: { mult: 'disorderZoneMult', factor: 'disorderBaseMultFactor' },
  turbulence: { mult: 'turbulenceZoneMult', factor: 'turbulenceBaseMultFactor' },
  radiance: { mult: 'radianceMult', factor: 'radianceMultFactor' },
}

function buildMultOverrides(
  skill: Skill,
  extraMods: PreparedSkillExtraMods | null | undefined,
  effectiveBaseMult: number,
): DamageEventMultOverrides | null {
  const fields = MULT_FIELDS[skill.damageType]
  const overrides: DamageEventMultOverrides = {}

  // 倍率 0 沿用旧语义：未设置，回落面板 / 招式小类默认值
  const base = Number(effectiveBaseMult) || 0
  const extraBase = Number(extraMods?.baseMult) || 0
  const total = base + extraBase
  if (total !== 0) overrides[fields.mult] = total

  const factor = Number(skill.baseMultFactor)
  if (Number.isFinite(factor) && factor !== 100) overrides[fields.factor] = factor

  if (skill.damageType === 'direct') {
    const settlement = (Number(skill.settlementMult) || 0) + (Number(extraMods?.settlementMult) || 0)
    if (settlement !== 0) overrides.settlementDmgMult = settlement
  }

  return Object.keys(overrides).length > 0 ? overrides : null
}

function hasPanelMods(extraMods: PreparedSkillExtraMods | null | undefined): boolean {
  if (!extraMods) return false
  return [extraMods.dmgBonus, extraMods.critRate, extraMods.critDmg].some(
    (value) => Number(value) !== 0 && value != null,
  )
}

export interface ResolveFlowOptions {
  /** 按下标对齐 teamSlots */
  slots: SchemeSlot[]
  teamSlots: Array<{ agentId: string; rank?: number }>
  findSkill: (skillId: string) => Skill | null
  findSkillGroup?: (groupId: string) => SkillGroup | null
  skillSubcategories?: SkillSubcategory[] | null
  /** 每人五大类技能等级；缺省按 L12，并按该槽影画上下限钳制 */
  skillTalentLevelsByAgent?: Record<string, SkillTalentLevels | Partial<SkillTalentLevels> | null>
}

/** 招式被删后，引用它的准备阶段条目会解析失败，此处记下来给 UI 提示 */
export interface ResolveFlowResult {
  hits: ResolvedHit[]
  missingSkillIds: string[]
}

function resolveOne(
  entry: FlowEntry,
  prepared: PreparedSkill,
  skill: Skill,
  ownerAgentId: string,
  options: ResolveFlowOptions,
  overrides?: {
    count?: number
    staggerPhase?: StaggerPhase
    critMode?: DamageEventCritMode
    hitId?: string
    anomalyPowerAgentId?: string | null
    triggerAgentId?: string | null
  },
): ResolvedHit {
  const { damageKind, anomalySubKind } = mapEventKindToCalc(skill.damageType)
  const anchorId = skill.buffAnchorId?.trim() || null
  const anchorCategory = anchorId
    ? (options.skillSubcategories?.find((item) => item.id === anchorId)?.categoryId ?? null)
    : null

  const coords = buildSkillMatchCoords({
    skillTypes: skill.skillTypes,
    buffAnchorId: anchorId,
    buffAnchorCategory: anchorCategory,
  })

  const defaults = defaultAnomalyAgents(skill.damageType, ownerAgentId)
  const stagger = overrides?.staggerPhase ?? entry.staggerPhase
  const crit = overrides?.critMode ?? entry.critMode
  const count =
    overrides?.count != null
      ? Math.max(0, Number(overrides.count) || 0)
      : Math.max(0, Number(entry.count) || 0)
  const powerRaw =
    overrides && 'anomalyPowerAgentId' in overrides
      ? overrides.anomalyPowerAgentId
      : prepared.anomalyPowerAgentId
  const triggerRaw =
    overrides && 'triggerAgentId' in overrides
      ? overrides.triggerAgentId
      : prepared.triggerAgentId
  const levels = options.skillTalentLevelsByAgent?.[ownerAgentId]
  const ownerRank =
    options.teamSlots.find((slot) => slot.agentId === ownerAgentId)?.rank ?? 0
  const { baseMult: effectiveBaseMult, talentLevel } = resolveEffectiveBaseMult(
    skill,
    levels,
    ownerRank,
  )
  return {
    id: overrides?.hitId ?? entry.id,
    skill,
    ownerAgentId,
    anomalyPowerAgentId: powerRaw?.trim() || defaults.anomalyPowerAgentId,
    triggerAgentId: triggerRaw?.trim() || defaults.triggerAgentId,
    count,
    staggerPhase: stagger,
    critMode: resolveFlowHitCritMode(skill.damageType, crit),
    damageKind,
    anomalySubKind,
    coords,
    isFollowUp: skillTypesIncludeFollowUp(skill.skillTypes),
    multOverrides: buildMultOverrides(skill, prepared.extraMods, effectiveBaseMult),
    panelMods: hasPanelMods(prepared.extraMods) ? (prepared.extraMods ?? null) : null,
    effectiveBaseMult,
    skillTalentLevel: talentLevel,
  }
}

/**
 * 展开方案的三条流程为一份扁平结算列表。
 *
 * 技能组流程行在内部按 members 展开为多段 ResolvedHit（UI 仍一行）。
 */
export function resolveFlow(options: ResolveFlowOptions): ResolveFlowResult {
  const hits: ResolvedHit[] = []
  const missing = new Set<string>()

  options.slots.forEach((slot, index) => {
    if (!slot) return
    const ownerAgentId = options.teamSlots[index]?.agentId ?? ''
    if (!ownerAgentId) return
    const preparedById = new Map(slot.prepared.map((item) => [item.id, item]))

    for (const entry of slot.flow) {
      const prepared = preparedById.get(entry.preparedId)
      if (!prepared) continue

      const groupId = prepared.skillGroupId?.trim() || ''
      if (groupId) {
        const group = options.findSkillGroup?.(groupId) ?? null
        if (!group) {
          missing.add(groupId)
          continue
        }
        const members = sortSkillGroupMembers(group.members)
        const groupMult = Math.max(0, Number(entry.count) || 0)
        members.forEach((member, memberIndex) => {
          const skill = options.findSkill(member.skillId)
          if (!skill) {
            missing.add(member.skillId)
            return
          }
          const ov = findMemberOverride(entry.memberOverrides, member)
          const ma = findMemberAgents(prepared.memberAgents, member)
          const segmentCount = Math.max(0, Number(ov?.count ?? member.count) || 0) * groupMult
          // 组内异常段：优先成员双代理人，缺省再回落准备条目 / 当前角色默认
          const power =
            ma?.anomalyPowerAgentId?.trim() || prepared.anomalyPowerAgentId?.trim() || null
          const trigger = ma?.triggerAgentId?.trim() || prepared.triggerAgentId?.trim() || null
          hits.push(
            resolveOne(entry, prepared, skill, ownerAgentId, options, {
              count: segmentCount,
              staggerPhase: ov?.staggerPhase ?? entry.staggerPhase,
              critMode: entry.critMode,
              hitId: `${entry.id}#${memberIndex}:${member.skillId}`,
              ...(power ? { anomalyPowerAgentId: power } : {}),
              ...(trigger ? { triggerAgentId: trigger } : {}),
            }),
          )
        })
        continue
      }

      const skillId = prepared.skillId?.trim() || ''
      if (!skillId) continue
      const skill = options.findSkill(skillId)
      if (!skill) {
        missing.add(skillId)
        continue
      }
      hits.push(resolveOne(entry, prepared, skill, ownerAgentId, options))
    }
  })

  return { hits, missingSkillIds: [...missing] }
}

function previewFlowEntry(id: string, ownerAgentId: string, preparedId: string): FlowEntry {
  return {
    id,
    ownerAgentId,
    preparedId,
    count: 1,
    staggerPhase: 'normal',
    critMode: 'expected',
  }
}

/**
 * 准备招式主行预览：不进流程也算出单次伤害。
 * 次数=1、非失衡（失衡易伤区 = 100% + 全局常驻失衡易伤）。hit.id = 准备条目 id。不计入流程总伤。
 */
export function resolveSkillPreviews(options: ResolveFlowOptions): ResolvedHit[] {
  const hits: ResolvedHit[] = []

  options.slots.forEach((slot, index) => {
    if (!slot) return
    const ownerAgentId = options.teamSlots[index]?.agentId ?? ''
    if (!ownerAgentId) return

    for (const prepared of slot.prepared) {
      const groupId = prepared.skillGroupId?.trim() || ''
      if (groupId) {
        const group = options.findSkillGroup?.(groupId) ?? null
        if (!group) continue
        const members = sortSkillGroupMembers(group.members)
        members.forEach((member, memberIndex) => {
          const skill = options.findSkill(member.skillId)
          if (!skill) return
          const ma = findMemberAgents(prepared.memberAgents, member)
          const power =
            ma?.anomalyPowerAgentId?.trim() || prepared.anomalyPowerAgentId?.trim() || null
          const trigger = ma?.triggerAgentId?.trim() || prepared.triggerAgentId?.trim() || null
          hits.push(
            resolveOne(
              previewFlowEntry(prepared.id, ownerAgentId, prepared.id),
              prepared,
              skill,
              ownerAgentId,
              options,
              {
                count: Math.max(0, Number(member.count) || 0),
                hitId: `${prepared.id}#preview:${memberIndex}:${member.skillId}`,
                ...(power ? { anomalyPowerAgentId: power } : {}),
                ...(trigger ? { triggerAgentId: trigger } : {}),
              },
            ),
          )
        })
        continue
      }
      const skillId = prepared.skillId?.trim() || ''
      if (!skillId) continue
      const skill = options.findSkill(skillId)
      if (!skill) continue
      hits.push(
        resolveOne(
          previewFlowEntry(prepared.id, ownerAgentId, prepared.id),
          prepared,
          skill,
          ownerAgentId,
          options,
        ),
      )
    }
  })

  return hits
}

/** 准备阶段的增伤/暴击加算并入局内面板 */
export function applyHitPanelMods(
  panel: import('@/types/calculatorPanel').PanelStats,
  mods: PreparedSkillExtraMods | null | undefined,
): import('@/types/calculatorPanel').PanelStats {
  if (!mods) return panel
  const next = { ...panel }
  if (Number(mods.dmgBonus)) next.dmgBonus += Number(mods.dmgBonus)
  if (Number(mods.critRate)) next.critRate += Number(mods.critRate)
  if (Number(mods.critDmg)) next.critDmg += Number(mods.critDmg)
  return next
}

/**
 * 局内通用面板：只吃通用 Buff。
 * `coords: []` 让招式限定（如普攻 +20% 增伤）不进面板；异常子类限定也不进。
 * 那些只在 `buildSkillContextFromHit` 结算对应招式时生效。
 */
export function buildGenericPanelSkillContext(options?: {
  element?: string
  staggerPhase?: StaggerPhase
  damageKind?: DamageCalcKind
}): SkillCalcContext {
  return {
    damageKind: options?.damageKind ?? 'direct',
    categoryId: 'basic',
    subcategoryId: null,
    coords: [],
    element: options?.element,
    staggerPhase: options?.staggerPhase,
    isFollowUp: false,
  }
}

/** 结算某一条时喂给 Buff 匹配的上下文 */
export function buildSkillContextFromHit(
  hit: ResolvedHit,
  element: string | undefined,
): SkillCalcContext {
  return {
    damageKind: hit.damageKind,
    // categoryId / subcategoryId 仅为兼容旧签名，实际匹配一律走 coords
    categoryId: hit.coords[0]?.category ?? 'basic',
    subcategoryId: hit.coords[0]?.subcategoryId ?? null,
    coords: hit.coords,
    element,
    staggerPhase: hit.staggerPhase,
    isFollowUp: hit.isFollowUp,
    anomalySubKind: hit.anomalySubKind,
  }
}

export interface HitLine {
  hit: ResolvedHit
  perHit: number
  total: number
  displayName: string
  /** 伤害类型标签，紊乱会带上极性后缀 */
  label: string
  result: DamageCalcResult
}

/**
 * 汇总一份结算列表。主计算与最优词条分配都走这里，
 * 保证准备阶段的倍率与流程的次数在两边一致生效（§15）。
 */
export function summarizeHits(
  hits: ResolvedHit[],
  buildInput: (hit: ResolvedHit) => DamageCalcInput | null,
  resolveOwnerName?: (hit: ResolvedHit) => string | undefined,
): { lines: HitLine[]; grandTotal: number } {
  const lines: HitLine[] = []
  let grandTotal = 0
  for (const hit of hits) {
    try {
      const input = buildInput(hit)
      if (!input) continue
      const result = computeDamageResult(input)
      const perHit = pickEventDamage(result, hit.skill.damageType, hit.critMode)
      const total = perHit * hit.count
      const kindLabel =
        DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === hit.skill.damageType)?.label ??
        hit.skill.damageType
      const suffix =
        hit.skill.damageType === 'disorder' ? `（${disorderLabelFromResult(result)}）` : ''
      const ownerName = resolveOwnerName?.(hit)
      lines.push({
        hit,
        perHit,
        total,
        label: `${kindLabel}${suffix}`,
        displayName: `${ownerName ? `${ownerName} · ` : ''}${hit.skill.name}${suffix}`,
        result,
      })
      grandTotal += total
    } catch (error) {
      console.error('[summarizeHits] skip hit due to calc error', hit.skill?.name, error)
    }
  }
  return { lines, grandTotal }
}

export interface HitParticipationContext {
  teamSlots: Array<{ agentId: string }>
  agents: Array<{ id: string; element: string; name?: string; profession?: string | null }>
}

/**
 * 本条能否参与计算；返回原因字符串，null 表示可算。
 *
 * 与旧 `getDamageEventSkipReason` 的差别：产生角色不再有「计算时再选」的兜底，
 * 两个代理人任一留空即不出伤（§11.5）。
 */
export function getHitSkipReason(
  hit: ResolvedHit,
  ctx: HitParticipationContext,
): string | null {
  if (hit.count <= 0) return '次数为 0'
  if (hit.damageKind !== 'anomaly') return null

  const ownerAgent = ctx.agents.find((item) => item.id === hit.ownerAgentId)
  const damageType = hit.skill.damageType

  if (damageType === 'radiance') {
    if (!findLuminousAgentInTeam(ctx.teamSlots, ctx.agents)) {
      return '队伍需编入蕾米埃尔（流明）才可计算耀变'
    }
    if (!isLuminousAgent(ownerAgent)) return '耀变招式须放在蕾米埃尔的流程里'
  } else if (isLuminousAgent(ownerAgent) && isLegacyAnomalyEventKind(damageType)) {
    return '蕾米埃尔产生的旧四类异常不参与计算（请改用耀变）'
  }

  if (!hit.anomalyPowerAgentId) return '未选异常强度提供者'
  if (!hit.triggerAgentId) return '未选异常类触发者'

  const teamAgentIds = new Set(ctx.teamSlots.map((slot) => slot.agentId).filter(Boolean))
  if (!teamAgentIds.has(hit.anomalyPowerAgentId)) {
    return '异常强度提供者不在当前队伍（换人后不会自动改成新角色）'
  }
  if (!teamAgentIds.has(hit.triggerAgentId)) {
    return '异常类触发者不在当前队伍（换人后不会自动改成新角色）'
  }

  const provider = ctx.agents.find((item) => item.id === hit.anomalyPowerAgentId)
  if (!canAgentBeAnomalyProducerForKind(provider, damageType)) {
    return '异常强度提供者须为队内代理人'
  }
  if (damageType !== 'radiance' && isLuminousAgent(provider)) {
    return '旧四类异常的强度提供者不能为蕾米埃尔（流明）'
  }

  if (damageType === 'radiance') {
    const trigger = ctx.agents.find((item) => item.id === hit.triggerAgentId)
    if (!isLuminousAgent(trigger)) {
      return '耀变仅当异常类触发者为蕾米埃尔时才能生效'
    }
  }

  if (damageType === 'turbulence') {
    return getTurbulenceParticipationFailureReason(
      ctx,
      hit.ownerAgentId,
      hit.anomalyPowerAgentId,
      hit.triggerAgentId,
    )
  }

  return null
}
