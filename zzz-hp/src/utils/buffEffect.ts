import type {
  AgentMindscapeRankBuffs,
  BuffApplySituation,
  BuffApplyTarget,
  BuffDamageType,
  BuffEffect,
  BuffEffectBlock,
  BuffEffectConvert,
  BuffEffectKind,
  BuffScope,
  BuffSkillTarget,
  BuffSkillTargetId,
  BuffStatKey,
  BuffStatModifiers,
  CharacterAttrKey,
  ConvertFromKey,
  CustomBuffStatKey,
  FollowUpSkillRule,
  SkillCalcContext,
  SkillMatchCoord,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { CONVERT_FROM_OPTIONS } from '@/types/calculator'
import {
  ATTRIBUTE_ANOMALY_FIELD_RENAMES,
  migrateAttributeAnomalyNamingDeep,
} from '@/utils/attributeAnomalyMigration'
import {
  anomalyTypeOfStat,
  damageTypeLabel,
  damageTypesOf,
  effectHasGenericConditions,
  normalizeEffectConditionsForStat,
  normalizeGroupId,
} from '@/utils/buffDamageTypes'
import { isLuminousElement } from '@/utils/remielUtils'
import {
  isSkillConvertFromKey,
  SKILL_CONVERT_FROM_TO_TALENT_KEY,
  type SkillTalentLevels,
} from '@/utils/skillTalentLevels'
import { formatCalcDecimal, roundCalc } from '@/utils/calcNumberFormat'
import { normalizeBuffMultFactorDelta } from '@/utils/multFactorPercent'
// 只作类型导入：记录类型定义在 panelBuffCalc.ts，运行时不得反向依赖（Spec §2.2 第 2 项）
import type {
  BuffEffectApplyStatus,
  EffectParameterInputs,
  ResolvedEffectParameters,
  ResolvedEffectRecord,
} from '@/utils/panelBuffCalc'

const BUFF_STAT_KEYS: BuffStatKey[] = [
  'hp',
  'inCombatHpPercent',
  'inCombatAtkPercent',
  'inCombatDefPercent',
  'externalHpPercent',
  'externalAtkPercent',
  'externalDefPercent',
  'atk',
  'def',
  'dmgBonus',
  'critRate',
  'critDmg',
  'penRate',
  'reduceDefense',
  'resPen',
  'mastery',
  'anomalyControl',
  'anomalyControlPercent',
  'energyRegen',
  'energyRegenFlat',
  'pierce',
  'pierceDmgBonus',
  'sharpenDmgBonus',
  'sharpenCritDmgBonus',
  'dmgPenalty',
  'vulnerable',
  'directVulnerable',
  'anomalyVulnerable',
  'dmgReduction',
  'directDmgReduction',
  'anomalyDmgReduction',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
  'special',
  'attributeAnomalyCritRate',
  'attributeAnomalyCritDmg',
  // 各异常子类自己的暴击：与后端 BUFF_STAT_KEYS 对齐；缺了会让面板的 turbulence/radiance/disorder 暴击字段变成 NaN
  'turbulenceCritRate',
  'turbulenceCritDmg',
  'radianceCritRate',
  'radianceCritDmg',
  'disorderCritRate',
  'disorderCritDmg',
  'attributeAnomalyDmgBonus',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  'anomalyReleaseMult',
  'directDmgMult',
  'settlementDmgMult',
  'attributeAnomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'radianceMult',
  'radianceDmgBonus',
  'radianceResPen',
  'specialMult',
  'mutationCoeff',
  'skillDmgBonus',
  'skillMultiplierBonus',
  'directDmgMultFactor',
  'attributeAnomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
  'radianceMultFactor',
  'specialMultFactor',
  'mutationCoeffFactor',
]

const SKILL_CATEGORIES: SkillCategoryId[] = [
  'basic',
  'dodge',
  'assist',
  'special',
  'chain',
  'ultimate',
]

const BUFF_SKILL_TARGETS: BuffSkillTargetId[] = [...SKILL_CATEGORIES, 'follow_up']

const CHARACTER_ATTRS: CharacterAttrKey[] = [
  'hp',
  'atk',
  'critRate',
  'critDmg',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'impact',
  'def',
  'pierce',
  'level',
]

/** 旧转模 from 字段映射到新 CharacterAttrKey + panelSource */
const LEGACY_CONVERT_FROM: Record<
  string,
  { from: CharacterAttrKey; panelSource: 'external' | 'final' }
> = {
  externalHp: { from: 'hp', panelSource: 'external' },
  inCombatHp: { from: 'hp', panelSource: 'final' },
  externalAtk: { from: 'atk', panelSource: 'external' },
  inCombatAtk: { from: 'atk', panelSource: 'final' },
  externalDef: { from: 'def', panelSource: 'external' },
  inCombatDef: { from: 'def', panelSource: 'final' },
}

function readNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const BUFF_MULT_FACTOR_KEYS: BuffStatKey[] = [
  'directDmgMultFactor',
  'attributeAnomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
  'radianceMultFactor',
  'specialMultFactor',
  'mutationCoeffFactor',
]


function isBuffMultFactorKey(key: string): boolean {
  return (BUFF_MULT_FACTOR_KEYS as string[]).includes(key)
}

/**
 * 自定义乘区增益键：`custom:` + 字母开头、字母/数字/下划线/点/连字符，slug ≤64。
 * 与后端 `zzz-hp-backend/src/utils/calculatorBuffFields.js` 的 `isCustomBuffStatKey` 同源。
 */
const CUSTOM_BUFF_STAT_KEY_PATTERN = /^custom:[A-Za-z][A-Za-z0-9_.-]{0,63}$/

/** 是否为乘区定义登记的 `custom:<key>` 自定义增益键（内置键恒为 false） */
export function isCustomBuffStatKey(
  stat: string | null | undefined,
): stat is CustomBuffStatKey {
  return typeof stat === 'string' && CUSTOM_BUFF_STAT_KEY_PATTERN.test(stat)
}

/** `custom:<key>` → `<key>`；非 custom / 格式非法返回 null */
export function customBuffStatFieldOf(stat: string | null | undefined): string | null {
  return isCustomBuffStatKey(stat) ? stat.slice('custom:'.length) : null
}

function emptyMods(): BuffStatModifiers {
  const mods = {} as BuffStatModifiers
  for (const key of BUFF_STAT_KEYS) {
  // 倍率修正增益填写百分点增量，空合成为 0
    mods[key] = 0
  }
  return mods
}

function newEffectId() {
  return `eff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 标准化人数启用档：下标 0/1/2 = 恰好 1/2/3 人；非 null 表示该档启用。不把 value 回填进各档。 */
export function normalizeTeamProfessionValues(
  raw: unknown,
  teamProfession?: string | null,
  legacyMinCount?: number | null,
  _legacyValue?: number | null,
): Array<number | null> | null {
  if (teamProfession == null || String(teamProfession).trim() === '') return null
  const values: Array<number | null> = [null, null, null]
  if (Array.isArray(raw)) {
    for (let i = 0; i < 3; i += 1) {
      const item = raw[i]
      if (item == null || item === '') {
        values[i] = null
        continue
      }
      const n = Number(item)
      values[i] = Number.isFinite(n) ? n : null
    }
    // 已有勾选档 → 直接用；全空时再回退旧 minCount，避免 [null,null,null] 吞掉兼容数据
    if (values.some((v) => v != null)) return values
  }
  // 旧 ≥N 门槛：仅启用 minCount 这一档（按恰好 N 人兼容）
  if (legacyMinCount != null && Number.isFinite(Number(legacyMinCount))) {
    const min = Math.min(3, Math.max(1, Math.round(Number(legacyMinCount) || 1)))
    values[min - 1] = 0
    return values
  }
  return values
}

export function createEmptyBuffEffect(
  overrides: Partial<Omit<BuffEffect, 'scope'>> & { scope?: BuffScope | BuffScope[] } = {},
): BuffEffect {
  const skillTargets = normalizeSkillTargets(
    overrides.skillTargets,
    overrides.skillCategory,
    overrides.skillSubcategoryId,
  )
  const primary = skillTargets[0]
  const stat = overrides.stat ?? 'dmgBonus'
  const effect: BuffEffect = {
    id: overrides.id ?? newEffectId(),
    origin: overrides.origin ?? '',
    applyTarget: overrides.applyTarget ?? 'self',
    applySituation: overrides.applySituation ?? 'global',
    applyProfession:
      overrides.applyProfession == null || String(overrides.applyProfession).trim() === ''
        ? null
        : String(overrides.applyProfession).trim(),
    teamProfession:
      overrides.teamProfession == null || String(overrides.teamProfession).trim() === ''
        ? null
        : String(overrides.teamProfession).trim(),
    teamProfessionValues: normalizeTeamProfessionValues(
      overrides.teamProfessionValues,
      overrides.teamProfession,
      overrides.teamProfessionMinCount,
      overrides.value,
    ),
    teamProfessionMinCount:
      overrides.teamProfession == null || String(overrides.teamProfession).trim() === ''
        ? null
        : overrides.teamProfessionMinCount == null
          ? null
          : Math.min(
              3,
              Math.max(1, Math.round(Number(overrides.teamProfessionMinCount) || 1)),
            ),
    skillTargets: skillTargets.length ? skillTargets : undefined,
    skillCategory: primary?.category ?? overrides.skillCategory,
    skillSubcategoryId: primary?.subcategoryId ?? overrides.skillSubcategoryId ?? null,
    elementFilter: overrides.elementFilter ?? 'all',
    kind: overrides.kind ?? 'fixed',
    stat,
    value: overrides.value ?? 0,
    stackable: overrides.stackable ?? false,
    maxStacks: overrides.maxStacks ?? 1,
    valuePerStack: overrides.valuePerStack ?? 0,
    defaultStacks: overrides.defaultStacks ?? 1,
    convert: overrides.convert,
    enabledDefault: overrides.enabledDefault ?? true,
    note: overrides.note ?? '',
    extraGain: overrides.extraGain,
  }
  const conditions = normalizeEffectConditionsForStat(overrides.conditions, overrides.scope, stat)
  if (conditions) effect.conditions = conditions
  const groupId = normalizeGroupId(overrides.groupId)
  if (groupId) effect.groupId = groupId
  return effect
}

/** 读取效果的招式目标列表（兼容旧单字段） */
export function getEffectSkillTargets(effect: BuffEffect): BuffSkillTarget[] {
  return normalizeSkillTargets(
    effect.skillTargets,
    effect.skillCategory,
    effect.skillSubcategoryId,
  )
}

/** 写入招式目标列表，并同步旧字段为首项 */
export function setEffectSkillTargets(effect: BuffEffect, targets: BuffSkillTarget[]) {
  const normalized = normalizeSkillTargets(targets)
  effect.skillTargets = normalized.length ? normalized : undefined
  effect.skillCategory = normalized[0]?.category
  effect.skillSubcategoryId = normalized[0]?.subcategoryId ?? null
}

function normalizeSkillTargets(
  targets?: BuffSkillTarget[] | null,
  legacyCategory?: BuffSkillTargetId | null,
  legacySubId?: string | null,
): BuffSkillTarget[] {
  if (Array.isArray(targets) && targets.length) {
    const result: BuffSkillTarget[] = []
    for (const item of targets) {
      const category = normalizeSkillCategory(item?.category)
      if (!category) continue
      const subcategoryId =
        item.subcategoryId == null || item.subcategoryId === ''
          ? null
          : String(item.subcategoryId)
      result.push({ category, subcategoryId })
    }
    return result
  }
  const category = normalizeSkillCategory(legacyCategory)
  if (!category) return []
  return [
    {
      category,
      subcategoryId:
        legacySubId == null || legacySubId === '' ? null : String(legacySubId),
    },
  ]
}

/** 旧扁平 mods → fixed effects */
export function flatModsToEffects(
  mods: BuffStatModifiers,
  applyTarget: BuffApplyTarget,
  scope: BuffScope | BuffScope[] = 'general',
  idPrefix = '',
): BuffEffect[] {
  const effects: BuffEffect[] = []
  for (const key of BUFF_STAT_KEYS) {
    const value = mods[key]
    if (isBuffMultFactorKey(key)) {
      if (!Number.isFinite(value) || Math.abs(value) < 1e-12) continue
    } else if (!value) {
      continue
    }
    effects.push(
      createEmptyBuffEffect({
        id: idPrefix ? `${idPrefix}-${applyTarget}-${key}` : undefined,
        scope,
        applyTarget,
        kind: 'fixed',
        // 扁平 mods 中的 factor 已是「合成后的修正区」；还原为单条 effect 时直接用该值
        stat: key,
        value,
        enabledDefault: true,
      }),
    )
  }
  // 自定义乘区增益键：`custom[key]` → `custom:<key>` 效果（与后端 flatModsToEffects 同口径）
  for (const [key, raw] of Object.entries(mods.custom ?? {})) {
    const amount = Number(raw)
    const stat = `custom:${key}`
    if (!Number.isFinite(amount) || !amount || !isCustomBuffStatKey(stat)) continue
    effects.push(
      createEmptyBuffEffect({
        id: idPrefix ? `${idPrefix}-${applyTarget}-${key}` : undefined,
        scope,
        applyTarget,
        kind: 'fixed',
        stat,
        value: amount,
        enabledDefault: true,
      }),
    )
  }
  return effects
}

/** 收集/结算时生成全局唯一实例 ID，避免不同来源同 id 互相捆绑 */
export function effectInstanceId(
  sourceKey: string,
  blockId: string,
  effectId: string,
) {
  return `${sourceKey}::${blockId}::${effectId}`
}

export function cloneEffectInstance(
  effect: BuffEffect,
  sourceKey: string,
  blockId: string,
): BuffEffect {
  return {
    ...effect,
    id: effectInstanceId(sourceKey, blockId, effect.id),
    skillTargets: effect.skillTargets?.map((item) => ({ ...item })),
    elementFilter: Array.isArray(effect.elementFilter)
      ? [...effect.elementFilter]
      : effect.elementFilter,
    convert: effect.convert ? { ...effect.convert } : undefined,
    conditions: effect.conditions?.damageTypes
      ? { damageTypes: [...effect.conditions.damageTypes] }
      : undefined,
  }
}

export function effectsToFlatMods(
  effects: BuffEffect[],
  applyTarget?: BuffApplyTarget,
): BuffStatModifiers {
  let total = emptyMods()
  for (const effect of effects) {
    if (applyTarget && effect.applyTarget !== applyTarget) continue
    // 旧口径：只有「通用」效果进扁平增量表；带伤害类型 / 招式条件的不进。
    if (!effectHasGenericConditions(effect)) continue
    const amount = resolveEffectBaseValue(effect, effect.defaultStacks ?? 1)
    if (isBuffMultFactorKey(effect.stat)) {
      if (!Number.isFinite(amount) || Math.abs(amount) < 1e-12) continue
      total = addStat(total, effect.stat, amount)
      continue
    }
    if (!amount) continue
    total = addStat(total, effect.stat, amount)
  }
  return total
}

export function addStat(
  mods: BuffStatModifiers,
  stat: BuffStatKey | CustomBuffStatKey,
  amount: number,
): BuffStatModifiers {
  const customField = customBuffStatFieldOf(stat)
  if (customField) {
    // 自定义乘区：写 `custom[key]`（百分点加总），缺失时初始化
    const custom = { ...(mods.custom ?? {}) }
    const customBase = Number(custom[customField])
    custom[customField] = (Number.isFinite(customBase) ? customBase : 0) + amount
    return { ...mods, custom }
  }
  // 同上：缺键不能当 undefined 用，否则 `undefined + n` 是 NaN
  const base = Number(mods[stat as BuffStatKey])
  return { ...mods, [stat]: (Number.isFinite(base) ? base : 0) + amount }
}

export function resolveEffectBaseValue(effect: BuffEffect, stacks: number): number {
  if (effect.kind === 'stacked' || effect.stackable) {
    const per = effect.valuePerStack ?? effect.value ?? 0
    const max = Math.max(1, effect.maxStacks ?? 1)
    const used = Math.min(max, Math.max(0, stacks))
    return per * used
  }
  if (effect.kind === 'convert') {
    return 0
  }
  return effect.value ?? 0
}

export function resolveConvertValue(
  effect: BuffEffect,
  attrValues: Partial<Record<CharacterAttrKey, number>>,
  overrideBase?: number | null,
  panelSourceValues?: {
    external?: Partial<Record<CharacterAttrKey, number>>
    final?: Partial<Record<CharacterAttrKey, number>>
  },
  /** 技能等级转模来源：来源角色的五大类技能等级 */
  skillTalentLevels?: Partial<SkillTalentLevels> | null,
): number {
  return resolveConvertValueDetail(effect, attrValues, overrideBase, panelSourceValues, skillTalentLevels).amount
}

/**
 * `resolveConvertValue` 的明细版：同时给出**实际采用的基数与它的来历**。
 *
 * 为什么要有它：配置预览与实际贡献都要求「基数 = 求值真用的那个值」，而这个值此前只能
 * 在返回值里看到折算结果，界面只能自己再猜一遍基数（C3）。这里不改变任何数值分支，
 * 只把已有的选择顺序如实标出来（计算链路收敛 Spec §3.2 第 2 项）。
 */
export function resolveConvertValueDetail(
  effect: BuffEffect,
  attrValues: Partial<Record<CharacterAttrKey, number>>,
  overrideBase?: number | null,
  panelSourceValues?: {
    external?: Partial<Record<CharacterAttrKey, number>>
    final?: Partial<Record<CharacterAttrKey, number>>
  },
  skillTalentLevels?: Partial<SkillTalentLevels> | null,
): { amount: number; base: number; source: 'manual' | 'external' | 'final' | 'skillLevel' | 'default'; stage: 'manual' | 'external' | 'preConvert' | 'skillLevel' } {
  if (effect.kind !== 'convert' || !effect.convert) {
    return { amount: 0, base: 0, source: 'default', stage: 'manual' }
  }
  const source = effect.convert.panelSource ?? 'external'
  let from: number
  let baseSource: 'manual' | 'external' | 'final' | 'skillLevel' | 'default' = 'default'
  let stage: 'manual' | 'external' | 'preConvert' | 'skillLevel' = 'manual'
  const manualBase =
    overrideBase != null && Number.isFinite(overrideBase)
      ? overrideBase
      : effect.convert.defaultBase != null && Number.isFinite(effect.convert.defaultBase)
        ? effect.convert.defaultBase
        : null
  if (isSkillConvertFromKey(effect.convert.from)) {
    // 技能等级来源：等级表取来源角色对应大类等级；manual 仍用输入/默认基础值
    if (source === 'manual') {
      from = manualBase ?? 0
      baseSource = manualBase == null ? 'default' : 'manual'
      stage = 'manual'
    } else {
      const talentKey = SKILL_CONVERT_FROM_TO_TALENT_KEY[effect.convert.from]
      from = skillTalentLevels?.[talentKey] ?? 0
      baseSource = 'skillLevel'
      stage = 'skillLevel'
    }
  } else if (source === 'manual') {
    // 自行设置：不读面板，优先用计算页输入，其次配置的 defaultBase
    from = manualBase ?? 0
    baseSource = manualBase == null ? 'default' : 'manual'
    stage = 'manual'
  } else {
    const sourceMap =
      panelSourceValues?.[source] ??
      (source === 'final' ? panelSourceValues?.final : panelSourceValues?.external) ??
      attrValues
    from =
      overrideBase != null && Number.isFinite(overrideBase)
        ? overrideBase
        : (sourceMap[effect.convert.from] ?? attrValues[effect.convert.from] ?? 0)
    if (overrideBase != null && Number.isFinite(overrideBase)) {
      baseSource = 'manual'
      stage = 'manual'
    } else {
      baseSource = source === 'final' ? 'final' : 'external'
      // `final` 这一档在面板阶段里读的是**非转模快照**，不能标成同轮转模之后
      stage = source === 'final' ? 'preConvert' : 'external'
    }
  }
  const initialBase =
    effect.convert.initialBase != null && Number.isFinite(effect.convert.initialBase)
      ? effect.convert.initialBase
      : 0
  const convertible = Math.max(0, from - initialBase)
  let amount = (convertible * effect.convert.ratioPercent) / 100
  if (effect.convert.cap != null && Number.isFinite(effect.convert.cap)) {
    const magnitudeCap = Math.abs(effect.convert.cap)
    amount = Math.max(-magnitudeCap, Math.min(amount, magnitudeCap))
  }
  // 转模结果统一到 4 位小数，与界面展示一致
  return { amount: roundCalc(amount), base: from, source: baseSource, stage }
}

/**
 * 共享效果参数解析（计算链路收敛 Spec §2.2 第 1 项）。
 *
 * 只解析「这条效果的有效层数 / 有效基数 / 配置折算值」，**不判定启用、不产出实际贡献、
 * 不改任何数据**。正式求值在通过条件后调用它；配置预览（选择器、行级弹窗、组配置）也调它，
 * 因此两者看到的是同一个基数与同一个折算值。
 */
export function resolveBuffEffectParameters(
  effect: BuffEffect,
  inputs: EffectParameterInputs,
): ResolvedEffectParameters {
  const stacks = inputs.stacks ?? effect.defaultStacks ?? 1
  if (effect.kind === 'convert' && effect.convert) {
    const detail = resolveConvertValueDetail(
      effect,
      inputs.attrValues ?? {},
      inputs.overrideBase ?? null,
      inputs.panelSourceValues,
      inputs.skillTalentLevels,
    )
    return {
      amount: detail.amount,
      stacks,
      convertBase: {
        from: effect.convert.from,
        value: detail.base,
        source: detail.source,
        stage: detail.stage,
      },
    }
  }
  return { amount: resolveEffectBaseValue(effect, stacks), stacks }
}

/** 当前结算上下文的第二级伤害类型 */
function contextDamageType(ctx: SkillCalcContext): BuffDamageType | null {
  if (ctx.damageKind === 'anomaly') return ctx.anomalySubKind ?? 'attributeAnomaly'
  return ctx.directSubKind ?? 'normal'
}

/** 伤害类型集合命中（兼容旧口径：异常 scope 的异放倍率增益在异放结算时也生效） */
function damageTypeMatches(
  types: readonly BuffDamageType[],
  current: BuffDamageType,
  stat: BuffStatKey | CustomBuffStatKey,
): boolean {
  if (types.includes(current)) return true
  if (
    current === 'anomalyRelease' &&
    types.includes('attributeAnomaly') &&
    (stat === 'anomalyReleaseMult' || stat === 'anomalyReleaseMultFactor')
  ) {
    return true
  }
  return false
}

/** 是否有招式条件（有 skillTargets / 旧 skillCategory 即限定招式） */
function hasSkillCondition(effect: BuffEffect): boolean {
  return getEffectSkillTargets(effect).length > 0
}

/**
 * 效果生效判定（2026-10-20 条件体系；2026-10-30 删除 `appliesToAnomaly` 门槛）。
 *
 * - 有 `conditions.damageTypes`：只在这些第二级类型上生效；通用面板上下文一律不命中。
 * - 无伤害类型条件：走「通用」语义，任何结算上下文都不额外加门槛。
 * - 有 skillTargets：要求命中招式坐标（异常结算同样只看招式坐标，不再要求额外勾选）。
 * - `groupId` 不参与任何判定。
 */
export function effectMatchesContext(
  effect: BuffEffect,
  ctx: SkillCalcContext | null | undefined,
): boolean {
  const types = damageTypesOf(effect)
  const skillCondition = hasSkillCondition(effect)
  if (!ctx) return types.length === 0 && !skillCondition

  const situation = effect.applySituation ?? 'global'
  if (situation !== 'global') {
    const phase = ctx.staggerPhase ?? 'stagger'
    if (situation === 'stagger' && phase !== 'stagger') return false
    if (situation === 'non_stagger' && phase !== 'normal') return false
  }

  if (
    effect.stat === 'staggerVulnerableOnly' &&
    ctx.staggerPhase &&
    ctx.staggerPhase !== 'stagger'
  ) {
    return false
  }

  if (types.length) {
    // 面板通用上下文（只汇总无类型/无招式条件的通用 Buff）：带类型条件的不进。
    if (ctx.generic) return false
    const current = contextDamageType(ctx)
    if (!current || !damageTypeMatches(types, current, effect.stat)) return false
    if (skillCondition) return effectTargetsSkill(effect, ctx)
    return true
  }

  if (skillCondition) return effectTargetsSkill(effect, ctx)
  return true
}

/**
 * 招式限定判定：效果的 `skillTargets` 是否命中当前结算招式。
 * 与 `effectMatchesContext` 的区别是**不看 scope 数组**——用于「必须限定到本招式」的调用方
 * （例如行级异放倍率只补本招式对应的技能等级转模，避免同角色多个块互相串味）。
 */
export function effectTargetsSkill(
  effect: BuffEffect,
  ctx: SkillCalcContext | null | undefined,
): boolean {
  if (!ctx) return false
  const targets = getEffectSkillTargets(effect)
  if (!targets.length) return false
  return targets.some((target) => skillTargetMatchesContext(target, ctx))
}

/**
 * 未提供 coords → 回落单坐标（旧调用方行为不变）。
 * 提供了空数组 → 该招式没有任何招式类型且无锚点时，招式限定 Buff 一律不命中。
 * 异常类可仅靠增益锚点产出坐标以命中「限定某一招」的 Buff。
 */
export function resolveSkillMatchCoords(ctx: SkillCalcContext): SkillMatchCoord[] {
  if (ctx.coords) return ctx.coords
  return [{ category: ctx.categoryId, subcategoryId: ctx.subcategoryId }]
}

function skillTargetMatchesContext(
  target: BuffSkillTarget,
  ctx: SkillCalcContext,
): boolean {
  const coords = resolveSkillMatchCoords(ctx)
  if (target.category === 'follow_up') {
    if (!ctx.isFollowUp) return false
    if (!target.subcategoryId) return true
    return coords.some((coord) => coord.subcategoryId === target.subcategoryId)
  }
  return coords.some(
    (coord) =>
      coord.category === target.category &&
      (!target.subcategoryId || coord.subcategoryId === target.subcategoryId),
  )
}

/** 根据小类打标与整大类规则判断当前招式是否视为追加攻击 */
export function resolveIsFollowUp(options: {
  agentId?: string | null
  categoryId: SkillCategoryId
  subcategoryId?: string | null
  skillSubcategories?: SkillSubcategory[] | null
  followUpSkillRules?: FollowUpSkillRule[] | null
}): boolean {
  const agentId = options.agentId?.trim() || ''
  const subcategoryId = options.subcategoryId ?? null
  const subs = options.skillSubcategories ?? []
  const rules = options.followUpSkillRules ?? []

  if (subcategoryId) {
    const sub = subs.find((item) => item.id === subcategoryId)
    if (sub?.countsAsFollowUp) return true
  }

  for (const rule of rules) {
    if (rule.agentId && rule.agentId !== agentId) continue
    if (rule.categoryId !== options.categoryId) continue
    if (rule.subcategoryId == null) return true
    if (subcategoryId && rule.subcategoryId === subcategoryId) return true
  }
  return false
}

export function effectMatchesElement(effect: BuffEffect, element?: string): boolean {
  const filter = effect.elementFilter
  if (!filter || filter === 'all') return true
  if (!element) return true
  if (isLuminousElement(element)) return false
  return filter.includes(element)
}

/** 统计编组中已上阵角色某职业人数（空槽不计） */
export function countTeamProfession(
  teamSlots: Array<{ agentId?: string | null }>,
  agents: Array<{ id: string; profession?: string | null }>,
  profession: string,
): number {
  const required = profession.trim()
  if (!required) return 0
  let count = 0
  for (const slot of teamSlots) {
    const agentId = String(slot.agentId ?? '').trim()
    if (!agentId || agentId === 'none') continue
    const agent = agents.find((item) => item.id === agentId)
    if (String(agent?.profession ?? '').trim() === required) count += 1
  }
  return count
}

/** 队内职业人数条件：无配置 → 放行；勾选的人数档按「恰好 N 人」生效 */
export function effectMatchesTeamProfessionGate(
  effect: Pick<
    BuffEffect,
    'teamProfession' | 'teamProfessionValues' | 'teamProfessionMinCount' | 'value'
  >,
  teamProfessionCount: number,
): boolean {
  const required = effect.teamProfession?.trim()
  if (!required) return true
  if (teamProfessionCount < 1 || teamProfessionCount > 3) return false

  const values = normalizeTeamProfessionValues(
    effect.teamProfessionValues,
    effect.teamProfession,
    effect.teamProfessionMinCount,
    effect.value,
  )
  if (!values) return true

  const thresholds = values
    .map((v, index) => (v != null && Number.isFinite(Number(v)) ? index + 1 : null))
    .filter((n): n is number => n != null)
  // 未勾任何人数（且无旧 minCount 可迁）→ 不生效
  if (!thresholds.length) return false
  return thresholds.includes(teamProfessionCount)
}

export function formatTeamProfessionGateLabel(
  effect: Pick<
    BuffEffect,
    'teamProfession' | 'teamProfessionValues' | 'teamProfessionMinCount' | 'value'
  >,
): string {
  const required = effect.teamProfession?.trim()
  if (!required) return ''
  const values = normalizeTeamProfessionValues(
    effect.teamProfessionValues,
    effect.teamProfession,
    effect.teamProfessionMinCount,
    effect.value,
  )
  if (values?.some((v) => v != null)) {
    const parts = values
      .map((v, i) => (v == null ? null : `${i + 1}人`))
      .filter(Boolean)
    return parts.length ? `队内·${required}·${parts.join('/')}` : `队内·${required}`
  }
  return `队内·${required}`
}

/** 受益代理人职业限制（谁能吃到这条效果） */
export function formatApplyProfessionLabel(
  effect: Pick<BuffEffect, 'applyProfession'>,
): string {
  const required = effect.applyProfession?.trim()
  if (!required) return ''
  return `[${required}]`
}

/** 属性限定（非「全部属性」时标出生效属性，如 `[电]` / `[电、火]`） */
export function formatElementFilterLabel(
  effect: Pick<BuffEffect, 'elementFilter'>,
): string {
  const filter = effect.elementFilter
  if (!filter || filter === 'all' || !Array.isArray(filter)) return ''
  const names = filter.map((item) => String(item).trim()).filter(Boolean)
  if (!names.length) return ''
  return `[${names.join('、')}]`
}

export function isEffectEnabled(
  effect: BuffEffect,
  selection: { enabledIds?: Record<string, boolean> } | null | undefined,
): boolean {
  // 额外增益没有勾选状态：**加入即已勾选**（2026-09-24 阶段 3 起并入统一收集）
  if (effect.extraGain) return true
  if (!selection?.enabledIds || !(effect.id in selection.enabledIds)) {
    // 有队内职业人数条件：未同步前默认不启用，避免条件未满足却全开
    if (effect.teamProfession?.trim()) return false
    // 危局 / Boss 场地 / 防线 / 临界：目录默认不勾；缺省勿回退 enabledDefault（否则换期清空后会「全选」）
    if (
      effect.id.startsWith('crisis-buff-') ||
      effect.id.startsWith('boss-field-') ||
      effect.id.startsWith('defense-buff-') ||
      effect.id.startsWith('deduction-buff-') ||
      effect.id.startsWith('deduction-field-')
    ) {
      return false
    }
    return effect.enabledDefault !== false
  }
  return Boolean(selection.enabledIds[effect.id])
}

export function resolveEffectsToMods(
  effects: BuffEffect[],
  options: {
    applyTarget?: BuffApplyTarget
    /** 当前结算角色同时吃 self + team */
    applyTargets?: BuffApplyTarget[]
    ctx?: SkillCalcContext | null
    element?: string
    /** 队伍 Buff 的受益角色属性（通常为当前结算主 C；流明不作等价替换） */
    beneficiaryElement?: string
    stacksByEffectId?: Record<string, number>
    convertInputs?: Record<string, number>
    attrValues?: Partial<Record<CharacterAttrKey, number>>
    panelSourceValues?: {
      external?: Partial<Record<CharacterAttrKey, number>>
      final?: Partial<Record<CharacterAttrKey, number>>
    }
    /** 技能等级转模来源：效果所属角色的五大类技能等级 */
    skillTalentLevels?: Partial<SkillTalentLevels> | null
    /** 跳过转模效果（用于先叠非转模再算转模） */
    skipConvert?: boolean
    selection?: { enabledIds?: Record<string, boolean> } | null
    /** 队内某职业人数；有人数条件的效果必须传入，否则带条件效果一律不结算 */
    resolveTeamProfessionCount?: (profession: string) => number
    /** 当前结算主槽角色职业（防线 Buff 等 applyProfession 条件） */
    beneficiaryProfession?: string | null
    /**
     * 逐效果状态回调（计算链路收敛 Spec §2.2 第 1 项）：**每次判定结束调用一次**，
     * 不论生效、零值还是被排除。不传时为零开销（不分配记录对象）。
     */
    onEffectResolved?: (record: ResolvedEffectRecord) => void
    /**
     * 前置排除（行级禁用 / 来源政策排除）：命中时只报告状态，不解析参数、不匹配、不运算。
     * 由候选集合的判定方给出，避免外层另造记录或把已排除项送回运算。
     */
    excludedByEffectId?: Readonly<Record<string, 'disabled' | 'source-excluded'>>
  } = {},
): BuffStatModifiers {
  let total = emptyMods()
  const report = options.onEffectResolved
  for (const effect of effects) {
    const emit = (
      status: BuffEffectApplyStatus,
      parameters?: ResolvedEffectParameters,
      matchElement?: string | null,
    ) => {
      if (!report) return
      report({
        effectId: effect.id,
        stat: effect.stat,
        status,
        amount: parameters?.amount ?? 0,
        stacks: parameters?.stacks,
        convertBase: parameters?.convertBase,
        matchElement: matchElement ?? null,
      })
    }
    const excluded = options.excludedByEffectId?.[effect.id]
    if (excluded) {
      emit(excluded)
      continue
    }
    // 判定顺序与改造前逐条一致：目标 → 启用 → 上下文 → 元素 → 职业人数 → 受益职业 → 阶段
    if (options.applyTargets?.length) {
      if (!options.applyTargets.includes(effect.applyTarget)) {
        emit('target-mismatch')
        continue
      }
    } else if (options.applyTarget && effect.applyTarget !== options.applyTarget) {
      emit('target-mismatch')
      continue
    }
    if (!isEffectEnabled(effect, options.selection)) {
      emit('not-enabled')
      continue
    }
    if (!effectMatchesContext(effect, options.ctx)) {
      emit('context-mismatch')
      continue
    }
    const matchElement = options.ctx && !options.ctx.generic
      ? options.ctx.element
      : effect.applyTarget === 'team'
        ? (options.beneficiaryElement ?? options.element ?? options.ctx?.element)
        : (options.element ?? options.ctx?.element)
    if (!effectMatchesElement(effect, matchElement)) {
      emit('element-mismatch', undefined, matchElement)
      continue
    }
    if (effect.teamProfession?.trim()) {
      if (!options.resolveTeamProfessionCount) {
        emit('team-count-mismatch', undefined, matchElement)
        continue
      }
      const count = options.resolveTeamProfessionCount(effect.teamProfession.trim())
      if (!effectMatchesTeamProfessionGate(effect, count)) {
        emit('team-count-mismatch', undefined, matchElement)
        continue
      }
    }
    if (effect.applyProfession?.trim()) {
      const required = effect.applyProfession.trim()
      const beneficiary = String(options.beneficiaryProfession ?? '').trim()
      if (beneficiary !== required) {
        emit('profession-mismatch', undefined, matchElement)
        continue
      }
    }
    if (options.skipConvert && effect.kind === 'convert') {
      emit('convert-skipped', undefined, matchElement)
      continue
    }

    const parameters = resolveBuffEffectParameters(effect, {
      stacks: options.stacksByEffectId?.[effect.id] ?? effect.defaultStacks ?? 1,
      overrideBase:
        options.convertInputs && effect.id in options.convertInputs
          ? options.convertInputs[effect.id]
          : null,
      attrValues: options.attrValues,
      panelSourceValues: options.panelSourceValues,
      skillTalentLevels: options.skillTalentLevels,
    })
    const amount = parameters.amount
    if (isBuffMultFactorKey(effect.stat)) {
      if (!Number.isFinite(amount) || Math.abs(amount) < 1e-12) {
        emit('zero', parameters, matchElement)
        continue
      }
      total = addStat(total, effect.stat, amount)
      emit('applied', parameters, matchElement)
      continue
    }
    if (!amount) {
      emit('zero', parameters, matchElement)
      continue
    }
    total = addStat(total, effect.stat, amount)
    emit('applied', parameters, matchElement)
  }
  return total
}

/**
 * 把一条行级例外展开成"禁用的效果 id"集合（**只展开，不判定**）。
 *
 * - 单条禁用：直接命中
 * - 块禁用：按调用方给的 blockKey 命中（与收集侧一致：`${sourceKey}::${blockName ?? ''}`）
 * - 传 null / 空结果 → 返回 null（调用方据此跳过判定，零开销）
 */
export function expandBuffOverrideToEffectIds(
  override:
    | { disabledBlockIds?: string[] | null; disabledEffectIds?: string[] | null }
    | null
    | undefined,
  items: Array<{ effect: { id: string }; blockKey?: string | null }>,
): Set<string> | null {
  if (!override) return null
  const blockIds = new Set(override.disabledBlockIds ?? [])
  const effectIds = new Set(override.disabledEffectIds ?? [])
  if (!blockIds.size && !effectIds.size) return null
  const out = new Set<string>()
  for (const item of items) {
    if (effectIds.has(item.effect.id)) out.add(item.effect.id)
    else if (item.blockKey && blockIds.has(item.blockKey)) out.add(item.effect.id)
  }
  return out.size ? out : null
}

function normalizeApplyTarget(value: unknown): BuffApplyTarget {
  return value === 'team' ? 'team' : 'self'
}

function normalizeApplySituation(value: unknown): BuffApplySituation {
  if (value === 'stagger' || value === 'non_stagger') return value
  return 'global'
}

function normalizeKind(value: unknown): BuffEffectKind {
  if (value === 'stacked' || value === 'convert') return value
  return 'fixed'
}

function normalizeStat(value: unknown): BuffStatKey | CustomBuffStatKey {
  // 旧个人效果可能在字段白名单之前仍写着旧名（`anomalyDmgBonus` 等）：
  // 先按 §4.4 映射转换再做白名单判定（幂等）。
  const migrated = typeof value === 'string' ? ATTRIBUTE_ANOMALY_FIELD_RENAMES[value] ?? value : value
  // 乘区定义登记的自定义键：合法 `custom:<slug>` 原样保留，不能被回落成 dmgBonus
  if (typeof migrated === 'string' && isCustomBuffStatKey(migrated)) return migrated
  if (typeof migrated === 'string' && (BUFF_STAT_KEYS as string[]).includes(migrated)) {
    return migrated as BuffStatKey
  }
  return 'dmgBonus'
}

function normalizeSkillCategory(value: unknown): BuffSkillTargetId | undefined {
  if (typeof value === 'string' && (BUFF_SKILL_TARGETS as string[]).includes(value)) {
    return value as BuffSkillTargetId
  }
  return undefined
}

function normalizeConvert(value: unknown): BuffEffect['convert'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Record<string, unknown>
  const rawFrom = entry.from
  if (typeof rawFrom !== 'string') return undefined

  let from: ConvertFromKey
  let panelSource: 'external' | 'final' | 'manual' =
    entry.panelSource === 'final'
      ? 'final'
      : entry.panelSource === 'manual'
        ? 'manual'
        : 'external'

  const legacy = LEGACY_CONVERT_FROM[rawFrom]
  if (legacy) {
    from = legacy.from
    if (
      entry.panelSource !== 'external' &&
      entry.panelSource !== 'final' &&
      entry.panelSource !== 'manual'
    ) {
      panelSource = legacy.panelSource
    }
  } else if (isSkillConvertFromKey(rawFrom)) {
    // 技能等级转模来源：五大类技能等级（与后端 normalizeConvert 白名单对齐）
    from = rawFrom
  } else if ((CHARACTER_ATTRS as string[]).includes(rawFrom)) {
    from = rawFrom as CharacterAttrKey
  } else {
    return undefined
  }

  const capRaw = entry.cap
  const defaultBaseRaw = entry.defaultBase
  const initialBaseRaw = entry.initialBase
  return {
    from,
    panelSource,
    ratioPercent: readNumber(entry.ratioPercent),
    cap: capRaw == null || capRaw === '' ? null : readNumber(capRaw),
    defaultBase:
      defaultBaseRaw == null || defaultBaseRaw === '' ? null : readNumber(defaultBaseRaw),
    initialBase:
      initialBaseRaw == null || initialBaseRaw === '' ? 0 : readNumber(initialBaseRaw),
  }
}

function normalizeElementFilter(value: unknown): BuffEffect['elementFilter'] {
  if (value == null || value === 'all') return 'all'
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }
  return 'all'
}

export function normalizeBuffEffect(value: unknown): BuffEffect | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  // 旧个人效果/旧导入包可能仍写旧子类类型值（`conditions.damageTypes` / 旧 `scope`）：
  // 在归一化（白名单）之前换成新值，转换幂等（Spec §4.4.3）。
  const legacyMigrated = migrateAttributeAnomalyNamingDeep({
    scope: entry.scope,
    conditions: entry.conditions,
  }) as { scope?: BuffScope | BuffScope[]; conditions?: BuffEffect['conditions'] }
  const legacyScope = legacyMigrated.scope
  const legacyConditions = legacyMigrated.conditions
  const effect = createEmptyBuffEffect({
    id: typeof entry.id === 'string' && entry.id ? entry.id : newEffectId(),
    origin: typeof entry.origin === 'string' ? entry.origin : '',
    conditions: legacyConditions,
    scope: legacyScope,
    groupId: typeof entry.groupId === 'string' ? entry.groupId : undefined,
    applyTarget: normalizeApplyTarget(entry.applyTarget),
    applySituation: normalizeApplySituation(entry.applySituation),
    applyProfession:
      entry.applyProfession == null || String(entry.applyProfession).trim() === ''
        ? null
        : String(entry.applyProfession).trim(),
    teamProfession:
      entry.teamProfession == null || String(entry.teamProfession).trim() === ''
        ? null
        : String(entry.teamProfession).trim(),
    teamProfessionValues: normalizeTeamProfessionValues(
      entry.teamProfessionValues,
      entry.teamProfession == null ? null : String(entry.teamProfession),
      entry.teamProfessionMinCount == null ? null : readNumber(entry.teamProfessionMinCount),
      entry.value == null ? null : readNumber(entry.value),
    ),
    teamProfessionMinCount:
      entry.teamProfession == null || String(entry.teamProfession).trim() === ''
        ? null
        : entry.teamProfessionMinCount == null || entry.teamProfessionMinCount === ''
          ? null
          : Math.min(3, Math.max(1, Math.round(readNumber(entry.teamProfessionMinCount) || 1))),
    skillTargets: Array.isArray(entry.skillTargets)
      ? (entry.skillTargets as BuffSkillTarget[])
      : undefined,
    skillCategory: normalizeSkillCategory(entry.skillCategory),
    skillSubcategoryId:
      entry.skillSubcategoryId == null || entry.skillSubcategoryId === ''
        ? null
        : String(entry.skillSubcategoryId),
    elementFilter: normalizeElementFilter(entry.elementFilter),
    kind: normalizeKind(entry.kind),
    stat: normalizeStat(entry.stat),
    value: readNumber(entry.value),
    stackable: Boolean(entry.stackable),
    maxStacks: Math.max(1, readNumber(entry.maxStacks) || 1),
    valuePerStack: readNumber(entry.valuePerStack),
    defaultStacks: (() => {
      if (entry.defaultStacks == null || entry.defaultStacks === '') return 1
      const n = Number(entry.defaultStacks)
      if (!Number.isFinite(n)) return 1
      return Math.max(0, n)
    })(),
    convert: normalizeConvert(entry.convert),
    enabledDefault: entry.enabledDefault === false ? false : true,
    note: typeof entry.note === 'string' ? entry.note : '',
  })
  if (isBuffMultFactorKey(effect.stat)) {
    effect.value = normalizeBuffMultFactorDelta(effect.value)
    effect.valuePerStack = normalizeBuffMultFactorDelta(effect.valuePerStack)
  }
  if (effect.kind === 'convert' && !effect.convert) {
    effect.kind = 'fixed'
  }
  // 叠层结算只用 valuePerStack×层数；转模只用 convert.*。value 为历史冗余，统一清零以免脏数据回写。
  if (effect.kind === 'stacked' || effect.stackable || effect.kind === 'convert') {
    effect.value = 0
  }
  if (hasSkillCondition(effect)) {
    const targets = getEffectSkillTargets(effect)
    if (!targets.length) {
      setEffectSkillTargets(effect, [{ category: 'basic', subcategoryId: null }])
    } else {
      setEffectSkillTargets(effect, targets)
    }
  }
  // 倍率修正增量为 0 的脏条目不保留。
  // 转模（convert）的数值由来源属性在运行时折算，value 字段本就为 0，
  // 不能按脏条目丢弃，否则会连带删掉蕾米埃尔「精通 → 耀变倍率修正」这类核心被动。
  const factorValue = Number(effect.value ?? 0)
  const factorPerStack = Number(effect.valuePerStack ?? 0)
  if (
    effect.kind !== 'convert' &&
    isBuffMultFactorKey(effect.stat) &&
    Math.abs(factorValue) < 1e-12
  ) {
    if (effect.kind !== 'stacked' || Math.abs(factorPerStack) < 1e-12) {
      return null
    }
  }
  return effect
}

export function normalizeBuffEffects(value: unknown): BuffEffect[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeBuffEffect(item))
    .filter((item): item is BuffEffect => item != null)
}

function newBlockId() {
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyBuffEffectBlock(
  overrides: Partial<BuffEffectBlock> = {},
): BuffEffectBlock {
  return {
    id: overrides.id ?? newBlockId(),
    name: overrides.name ?? '效果块',
    note: typeof overrides.note === 'string' ? overrides.note : '',
    effects: overrides.effects ?? [],
    enabledDefault: overrides.enabledDefault ?? true,
  }
}

export function flattenEffectBlocks(
  blocks: Array<{ effects?: BuffEffect[] | null }>,
): BuffEffect[] {
  return blocks.flatMap((block) => block.effects ?? [])
}

export function wrapEffectsAsBlocks(effects: BuffEffect[]): BuffEffectBlock[] {
  if (!effects.length) return []
  return [
    createEmptyBuffEffectBlock({
      name: '效果块 1',
      effects,
    }),
  ]
}

export function normalizeBuffEffectBlocks(value: unknown): BuffEffectBlock[] {
  if (value == null) return []
  if (!Array.isArray(value)) {
    if (typeof value === 'object') return normalizeBuffEffectBlocks([value])
    return []
  }
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const entry = item as Record<string, unknown>
      return createEmptyBuffEffectBlock({
        id: typeof entry.id === 'string' && entry.id ? entry.id : `blk-${index}`,
        name: typeof entry.name === 'string' && entry.name ? entry.name : `效果块 ${index + 1}`,
        note: typeof entry.note === 'string' ? entry.note : '',
        effects: normalizeBuffEffects(entry.effects),
        enabledDefault: entry.enabledDefault === false ? false : true,
      })
    })
}

export function packFromEffects(effects: BuffEffect[]): AgentMindscapeRankBuffs {
  const effectBlocks = wrapEffectsAsBlocks(effects)
  return {
    effectBlocks,
    effects,
    selfMods: effectsToFlatMods(effects, 'self'),
    teamMods: effectsToFlatMods(effects, 'team'),
  }
}

export function packFromBlocks(blocks: BuffEffectBlock[]): AgentMindscapeRankBuffs {
  const effectBlocks = blocks.map((block) =>
    createEmptyBuffEffectBlock({
      ...block,
      effects: normalizeBuffEffects(block.effects),
    }),
  )
  const effects = flattenEffectBlocks(effectBlocks)
  return {
    effectBlocks,
    effects,
    selfMods: effectsToFlatMods(effects, 'self'),
    teamMods: effectsToFlatMods(effects, 'team'),
  }
}

/** 收集效果时允许只带 blocks/effects 的轻量 pack（如邦布精炼临时对象） */
export type BuffEffectPackLike = {
  effectBlocks?: Array<{
    id?: string
    name?: string
    note?: string
    effects?: BuffEffect[] | null
  }> | null
  effects?: BuffEffect[] | null
  selfMods?: BuffStatModifiers | null
  teamMods?: BuffStatModifiers | null
}

export function collectEffectsFromPack(
  pack: BuffEffectPackLike | null | undefined,
): BuffEffect[] {
  if (!pack) return []
  if (Array.isArray(pack.effectBlocks) && pack.effectBlocks.length > 0) {
    const fromBlocks = flattenEffectBlocks(pack.effectBlocks)
    if (fromBlocks.length) return fromBlocks
  }
  if (Array.isArray(pack.effects) && pack.effects.length > 0) return pack.effects
  // 稳定 id，避免每次收集随机 id 导致勾选串源（如影画与驱动盘互相捆绑）
  return [
    ...flatModsToEffects(pack.selfMods ?? emptyMods(), 'self', 'general', 'legacy-self'),
    ...flatModsToEffects(pack.teamMods ?? emptyMods(), 'team', 'general', 'legacy-team'),
  ]
}

/** 按效果块收集，便于选择器/明细按块展示 */
export function collectBlockEntriesFromPack(
  pack: BuffEffectPackLike | null | undefined,
): Array<{ blockId: string; blockName: string; blockNote: string; effects: BuffEffect[] }> {
  if (!pack) return []
  if (Array.isArray(pack.effectBlocks) && pack.effectBlocks.length > 0) {
    const blocks = pack.effectBlocks
      .map((block) => ({
        blockId: block.id || 'legacy',
        blockName: block.name?.trim() || '效果块',
        blockNote: block.note?.trim() || '',
        effects: Array.isArray(block.effects) ? block.effects : [],
      }))
      .filter((entry) => entry.effects.length > 0)
    if (blocks.length) return blocks
  }
  const effects = collectEffectsFromPack({
    ...pack,
    effectBlocks: [],
    effects: Array.isArray(pack.effects) && pack.effects.length ? pack.effects : [],
  })
  if (!effects.length) return []
  return [{ blockId: 'legacy', blockName: '增益', blockNote: '', effects }]
}

export const SKILL_CATEGORY_LABELS: Record<BuffSkillTargetId, string> = {
  basic: '普通攻击',
  dodge: '闪避',
  assist: '支援技',
  special: '特殊技',
  chain: '连携技',
  ultimate: '终结技',
  follow_up: '追加攻击',
}

const APPLY_SITUATION_LABELS: Record<string, string> = {
  global: '全局',
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

function convertSourceAttrLabel(convert: BuffEffectConvert): string {
  const source =
    convert.panelSource === 'final'
      ? '局内'
      : convert.panelSource === 'manual'
        ? '自行'
        : '局外'
  const from =
    CONVERT_FROM_OPTIONS.find((item) => item.id === convert.from)?.label ?? convert.from
  return `${source}·${from}`
}

/** 转模说明：如「自行·等级转模120%」「局外·生命转模30%（初始50）」 */
export function convertSummaryLabel(convert: BuffEffectConvert | null | undefined): string {
  if (!convert) return '转模'
  const initial =
    convert.initialBase != null && Number.isFinite(convert.initialBase) && convert.initialBase !== 0
      ? `（初始${formatCalcDecimal(convert.initialBase)}）`
      : ''
  return `${convertSourceAttrLabel(convert)}转模${formatCalcDecimal(convert.ratioPercent ?? 0)}%${initial}`
}

/** 招式目标展示：有小类名则只显示小类 `[斩妄开天]`；否则显示大类 `[终结技]`（不露内部 id） */
export function formatSkillTargetBracket(
  target: BuffSkillTarget,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  const catLabel = SKILL_CATEGORY_LABELS[target.category] ?? '招式'
  if (!target.subcategoryId) {
    return `[${catLabel}]`
  }
  const name = skillSubcategories?.find((item) => item.id === target.subcategoryId)?.name?.trim()
  if (name) return `[${name}]`
  return `[${catLabel}]`
}

/** 按顺序拼接全部招式目标括号（有 skillTargets 即限定招式） */
export function formatSkillTargetsPrefix(
  effect: BuffEffect,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  return getEffectSkillTargets(effect)
    .map((target) => formatSkillTargetBracket(target, skillSubcategories))
    .join('')
}

export function effectSummaryLabel(
  effect: BuffEffect,
  statLabelFn?: (stat: BuffStatKey | CustomBuffStatKey) => string,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  const target = effect.applyTarget === 'team' ? '全队' : '自身'
  const skillPrefix = formatSkillTargetsPrefix(effect, skillSubcategories)
  // 显示只显示第二级类型，不带「直伤类 / 异常类」前缀；类2 的类型由 stat 反推。
  const explicitTypes = damageTypesOf(effect)
  const statType = anomalyTypeOfStat(effect.stat)
  const typeIds: BuffDamageType[] =
    explicitTypes.length ? explicitTypes : statType ? [statType] : []
  const typeText = typeIds.map((id) => damageTypeLabel(id)).join(' + ')
  const situation =
    APPLY_SITUATION_LABELS[effect.applySituation ?? 'global'] ?? '全局'
  const applyProf = formatApplyProfessionLabel(effect)
  const elementLabel = formatElementFilterLabel(effect)
  const gate = formatTeamProfessionGateLabel(effect)
  const statText = statLabelFn?.(effect.stat) ?? effect.stat
  const amount =
    effect.kind === 'stacked'
      ? `${effect.valuePerStack ?? 0}×叠层`
      : effect.kind === 'convert'
        ? convertSummaryLabel(effect.convert)
        : `${effect.value ?? 0}`
  const parts = [target]
  if (skillPrefix) parts.push(`招式·${skillPrefix}`)
  if (typeText) parts.push(typeText)
  parts.push(situation)
  if (applyProf) parts.splice(0, 0, applyProf)
  // 属性限制：全局之后、效果之前
  if (elementLabel) parts.push(elementLabel)
  if (gate) parts.push(gate)
  // 数值在前、增益名在后：`60 爆伤%` / `5×叠层 爆伤%`
  parts.push(`${amount} ${statText}`)
  return parts.join(' · ')
}

/** 作用情况标签：全局 / 失衡期 / 非失衡期（`全局` = 不限定时期） */
export function formatApplySituationLabel(
  effect: Pick<BuffEffect, 'applySituation'>,
): string {
  return APPLY_SITUATION_LABELS[effect.applySituation ?? 'global'] ?? '全局'
}

/**
 * Buff 卡片效果行：`[强攻][斩妄开天] [电] +40 增伤`。
 *
 * `applySituation` 打开后标出作用情况（`[强攻][失衡期] [电] +40 增伤`）——
 * 局内 Buff 选择器与本行增益例外弹窗共用这一份实现，两处文案不会各写一遍。
 */
export function formatBuffEffectResultText(
  effect: BuffEffect,
  amountText: string,
  options?: {
    statLabelFn?: (stat: BuffStatKey | CustomBuffStatKey) => string
    skillSubcategories?: SkillSubcategory[] | null
    /** 非全局作用情况时加 `[失衡期]` / `[非失衡期]` 前缀 */
    applySituation?: boolean
  },
): string {
  const skillPrefix = formatSkillTargetsPrefix(effect, options?.skillSubcategories)
  const label = options?.statLabelFn?.(effect.stat) ?? effect.stat
  const applyProf = formatApplyProfessionLabel(effect)
  const elementLabel = formatElementFilterLabel(effect)
  const gate = formatTeamProfessionGateLabel(effect)
  const head = [applyProf, skillPrefix].filter(Boolean).join('')
  const mid = gate ? `${gate} ` : ''
  const el = elementLabel ? `${elementLabel} ` : ''
  // 数值顺序（2026-09-23 用户口径）：`增伤% +20.16` —— 属性名在前、数值在后
  const line = `${head}${head ? ' ' : ''}${mid}${el}${label} ${amountText}`
  if (!options?.applySituation) return line
  const situation = formatApplySituationLabel(effect)
  if (situation === '全局') return line
  // [强攻] 放最前，作用情况紧随其后
  if (applyProf && line.startsWith(applyProf)) {
    return `${applyProf}[${situation}] ${line.slice(applyProf.length).trimStart()}`
  }
  return `[${situation}] ${line}`
}

export { BUFF_STAT_KEYS }