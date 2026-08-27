import type {
  DamageEvent,
  DamageEventMode,
  FollowUpSkillRule,
  Skill,
  SkillCategoryId,
  SkillDamageType,
  SkillSubcategory,
  SkillTypeId,
} from '@/types/calculator'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import { loadCustomModes } from '@/utils/customDamageEventModes'
import { resolveIsFollowUp } from '@/utils/buffEffect'
import {
  skillTypeFromLegacyCategory,
  skillTypeFromLegacyPublicSubcategory,
} from '@/utils/skillTypes'

const CUSTOM_KEY = 'zzz-hp-skill-library-custom'
const MODES_MIGRATED_KEY = 'zzz-hp-skill-library-modes-migrated'
const FOLLOWUP_TYPE_BAKED_KEY = 'zzz-hp-followup-type-baked'

// ===================== 自定义招式（浏览器，全局一份） =====================

function normalizeSkill(raw: Record<string, unknown>): Skill | null {
  const id = String(raw.id ?? '').trim()
  if (!id) return null
  const damageType = String(raw.damageType ?? 'direct') as SkillDamageType
  const isAnomaly = damageType !== 'direct'
  const skillTypes = Array.isArray(raw.skillTypes)
    ? raw.skillTypes.map((item) => String(item) as SkillTypeId)
    : []
  const anchor = raw.buffAnchorId
  return {
    id,
    name: String(raw.name ?? '').trim() || '未命名招式',
    agentId: String(raw.agentId ?? ''),
    source: 'custom',
    damageType,
    skillTypes: isAnomaly ? [] : skillTypes,
    buffAnchorId: anchor == null || anchor === '' ? null : String(anchor),
    baseMult: Number(raw.baseMult) || 0,
    baseMultFactor: Number.isFinite(Number(raw.baseMultFactor))
      ? Number(raw.baseMultFactor)
      : undefined,
    settlementMult: Number.isFinite(Number(raw.settlementMult))
      ? Number(raw.settlementMult)
      : undefined,
    element: raw.element == null || raw.element === '' ? '' : String(raw.element),
  }
}

export function loadCustomSkills(): Skill[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(normalizeSkill)
      .filter((item): item is Skill => item !== null)
  } catch {
    return []
  }
}

export function saveCustomSkills(list: Skill[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    /* 配额超限时静默，与方案库一致 */
  }
}

/** 导出/导入用。`raw` 不是数组时返回 null（调用方应中止，不要清空本地库）。 */
export function parseCustomSkillList(raw: unknown): Skill[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(normalizeSkill)
    .filter((item): item is Skill => item !== null)
}

export function replaceCustomSkills(list: Skill[]): Skill[] {
  saveCustomSkills(list)
  return list
}

export function createCustomSkillId(): string {
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function upsertCustomSkill(skill: Skill): Skill[] {
  const list = loadCustomSkills()
  const index = list.findIndex((item) => item.id === skill.id)
  if (index >= 0) list[index] = { ...skill, source: 'custom' }
  else list.push({ ...skill, source: 'custom' })
  saveCustomSkills(list)
  return list
}

export function removeCustomSkill(id: string): Skill[] {
  const list = loadCustomSkills().filter((item) => item.id !== id)
  saveCustomSkills(list)
  return list
}

// ===================== 旧全局事件模式 → 自定义招式（一次性） =====================

/** 一条事件只有一个 kind，故基础倍率只可能来自其中一个字段 */
function readBaseMult(event: DamageEvent): { baseMult: number; baseMultFactor?: number } {
  const o = event.multOverrides
  if (!o) return { baseMult: 0 }
  const pick = (
    value: number | null | undefined,
    factor?: number | null,
  ): { baseMult: number; baseMultFactor?: number } => ({
    baseMult: Number.isFinite(Number(value)) ? Number(value) : 0,
    baseMultFactor: Number.isFinite(Number(factor)) ? Number(factor) : undefined,
  })
  switch (event.kind) {
    case 'direct':
      return pick(o.directDmgMult, o.directDmgMultFactor)
    case 'anomaly':
      return pick(o.anomalyMult, o.anomalyMultFactor)
    case 'anomalyRelease':
      return pick(o.anomalyReleaseMult, o.anomalyReleaseMultFactor)
    case 'disorder':
      return pick(o.disorderZoneMult ?? o.disorderBaseMult, o.disorderBaseMultFactor)
    case 'turbulence':
      return pick(o.turbulenceZoneMult ?? o.turbulenceBaseMult, o.turbulenceBaseMultFactor)
    case 'radiance':
      return pick(o.radianceMult, o.radianceMultFactor)
    default:
      return { baseMult: 0 }
  }
}

/**
 * 一条旧事件 → 一条招式。
 *
 * 编排信息（count / staggerPhase / critMode）与结算参数（triggerAgentId / skillBound）
 * 一律丢弃：新架构里它们分别属于流程与准备阶段，迁移不产出这两者。
 */
function eventToSkill(
  event: DamageEvent,
  mode: DamageEventMode,
  subcategories: SkillSubcategory[],
  followUpRules: FollowUpSkillRule[],
): Skill {
  const isDirect = event.kind === 'direct'
  // 异常类不带招式类型；增益锚点可保留旧小类 id，便于招式限定 Buff 命中
  const rawAnchorId = event.skillSubcategoryId ?? null
  const publicType = isDirect ? skillTypeFromLegacyPublicSubcategory(rawAnchorId) : null
  const skillTypes: SkillTypeId[] = []
  if (isDirect) {
    if (publicType) skillTypes.push(publicType)
    else skillTypes.push(skillTypeFromLegacyCategory(event.categoryId))
  }
  const anchorId = publicType ? null : rawAnchorId
  const agentId = event.ownerAgentId?.trim() || mode.agentId || ''
  if (
    isDirect &&
    resolveIsFollowUp({
      agentId,
      categoryId: event.categoryId,
      subcategoryId: anchorId,
      skillSubcategories: subcategories,
      followUpSkillRules: followUpRules,
    }) &&
    !skillTypes.includes('followUp')
  ) {
    skillTypes.push('followUp')
  }

  const nameSubId = event.skillSubcategoryId
  const sub = nameSubId ? subcategories.find((item) => item.id === nameSubId) : null
  const kindLabel =
    DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
  const { baseMult, baseMultFactor } = readBaseMult(event)

  return {
    id: `skill-mig-${event.id}`,
    name: sub?.name?.trim() || kindLabel,
    agentId,
    source: 'custom',
    damageType: event.kind,
    skillTypes,
    buffAnchorId: anchorId,
    baseMult,
    baseMultFactor,
    settlementMult:
      isDirect && Number.isFinite(Number(event.multOverrides?.settlementDmgMult))
        ? Number(event.multOverrides?.settlementDmgMult)
        : undefined,
    element: '',
  }
}

function dedupeKey(skill: Skill): string {
  return [
    skill.agentId,
    skill.damageType,
    skill.buffAnchorId ?? '',
    skill.baseMult,
    skill.baseMultFactor ?? '',
    skill.settlementMult ?? '',
    [...skill.skillTypes].sort().join('+'),
  ].join('|')
}

export function isLegacyModeMigrationDone(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(MODES_MIGRATED_KEY) === '1'
}

/**
 * 一次性迁移：旧全局事件模式库 → 全局自定义招式库。
 *
 * 全局 → 全局，**不触碰任何方案**：流程统一留空，由用户在新界面重排。
 * 旧模式库保留只读，不删不改，便于回滚与人工查对。
 */
export function migrateLegacyModesToSkills(options: {
  subcategories: SkillSubcategory[]
  followUpSkillRules?: FollowUpSkillRule[]
  force?: boolean
}): { added: number; merged: number } {
  if (typeof localStorage === 'undefined') return { added: 0, merged: 0 }
  if (!options.force && isLegacyModeMigrationDone()) return { added: 0, merged: 0 }

  const existing = loadCustomSkills()
  const seen = new Map(existing.map((item) => [dedupeKey(item), item]))
  let added = 0
  let merged = 0
  const rules = options.followUpSkillRules ?? []

  for (const mode of loadCustomModes()) {
    for (const event of mode.events) {
      const skill = eventToSkill(event, mode, options.subcategories, rules)
      const key = dedupeKey(skill)
      if (seen.has(key)) {
        merged++
        continue
      }
      seen.set(key, skill)
      existing.push(skill)
      added++
    }
  }

  uniquifyNewSkillNames(existing, added)
  saveCustomSkills(existing)
  localStorage.setItem(MODES_MIGRATED_KEY, '1')
  return { added, merged }
}

/** 只给本次新写入的招式加序号，不改用户已经在库里的名字 */
function uniquifyNewSkillNames(all: Skill[], addedCount: number): void {
  if (addedCount <= 0) return
  const added = all.slice(-addedCount)
  const used = new Set(all.slice(0, all.length - addedCount).map((item) => item.name))
  for (const skill of added) {
    const base = skill.name
    if (!used.has(base)) {
      used.add(base)
      continue
    }
    let n = 2
    while (used.has(`${base} ${n}`)) n += 1
    skill.name = `${base} ${n}`
    used.add(skill.name)
  }
}

function categoryForFollowUpBake(skill: Skill, subs: SkillSubcategory[]): SkillCategoryId {
  const anchor = skill.buffAnchorId?.trim()
  if (anchor) {
    const sub = subs.find((item) => item.id === anchor)
    if (sub?.categoryId) return sub.categoryId
  }
  for (const type of skill.skillTypes) {
    if (type === 'followUp') continue
    if (type === 'dash' || type === 'dodgeCounter') return 'dodge'
    if (type === 'specialBasic' || type === 'specialEnhanced') return 'special'
    if (
      type === 'basic' ||
      type === 'dodge' ||
      type === 'assist' ||
      type === 'special' ||
      type === 'chain' ||
      type === 'ultimate'
    ) {
      return type
    }
  }
  return 'basic'
}

/** 一次性：旧规则推定的追加，写进招式类型。之后只看勾选，结算不再推定。 */
export function bakeFollowUpSkillTypesOnce(
  subcategories: SkillSubcategory[],
  followUpRules: FollowUpSkillRule[],
): Skill[] {
  const list = loadCustomSkills()
  if (typeof localStorage === 'undefined') return list
  if (localStorage.getItem(FOLLOWUP_TYPE_BAKED_KEY) === '1') return list

  let changed = false
  const next = list.map((skill) => {
    if (skill.damageType !== 'direct' || skill.skillTypes.includes('followUp')) return skill
    const hit = resolveIsFollowUp({
      agentId: skill.agentId,
      categoryId: categoryForFollowUpBake(skill, subcategories),
      subcategoryId: skill.buffAnchorId,
      skillSubcategories: subcategories,
      followUpSkillRules: followUpRules,
    })
    if (!hit) return skill
    changed = true
    const skillTypes: SkillTypeId[] = [...skill.skillTypes, 'followUp']
    return { ...skill, skillTypes }
  })
  localStorage.setItem(FOLLOWUP_TYPE_BAKED_KEY, '1')
  if (changed) saveCustomSkills(next)
  return next
}
