import type {
  AgentMindscapeRankBuffs,
  AnomalyDamageSubKind,
  BuffApplySituation,
  BuffApplyTarget,
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
  FollowUpSkillRule,
  SkillCalcContext,
  SkillMatchCoord,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'
import { isLuminousElement } from '@/utils/remielUtils'
import { formatCalcDecimal, roundCalc } from '@/utils/calcNumberFormat'

const BUFF_SCOPE_SET = new Set<string>([
  'general',
  'skill',
  'anomaly',
  'disorder',
  'turbulence',
  'anomalyRelease',
  'radiance',
  'mutation',
])

const BUFF_SCOPE_LABELS: Record<string, string> = {
  general: '通用',
  skill: '招式',
  anomaly: '异常',
  disorder: '紊乱',
  turbulence: '乱流',
  anomalyRelease: '异放',
  radiance: '耀变',
  mutation: '异化系数',
}

function isAnomalyDamageScope(scope: BuffScope): boolean {
  return (
    scope === 'anomaly' ||
    scope === 'disorder' ||
    scope === 'turbulence' ||
    scope === 'anomalyRelease' ||
    scope === 'radiance'
  )
}

function scopeToAnomalySubKind(scope: BuffScope): AnomalyDamageSubKind | null {
  if (scope === 'anomaly') return 'anomaly'
  if (scope === 'disorder') return 'disorder'
  if (scope === 'turbulence') return 'turbulence'
  if (scope === 'anomalyRelease') return 'anomalyRelease'
  if (scope === 'radiance') return 'radiance'
  return null
}

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
  'vulnerable',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
  'special',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDmgBonus',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  'anomalyReleaseMult',
  'directDmgMult',
  'settlementDmgMult',
  'anomalyMult',
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
  'anomalyMultFactor',
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
  'anomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
]

function isBuffMultFactorKey(key: string): boolean {
  return (BUFF_MULT_FACTOR_KEYS as string[]).includes(key)
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
  overrides: Partial<BuffEffect> = {},
): BuffEffect {
  const skillTargets = normalizeSkillTargets(
    overrides.skillTargets,
    overrides.skillCategory,
    overrides.skillSubcategoryId,
  )
  const primary = skillTargets[0]
  return {
    id: overrides.id ?? newEffectId(),
    origin: overrides.origin ?? '',
    scope: overrides.scope ?? 'general',
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
    stat: overrides.stat ?? 'dmgBonus',
    value: overrides.value ?? 0,
    stackable: overrides.stackable ?? false,
    maxStacks: overrides.maxStacks ?? 1,
    valuePerStack: overrides.valuePerStack ?? 0,
    defaultStacks: overrides.defaultStacks ?? 1,
    convert: overrides.convert,
    appliesToAnomaly: overrides.appliesToAnomaly,
    enabledDefault: overrides.enabledDefault ?? true,
    note: overrides.note ?? '',
  }
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
  scope: BuffScope = 'general',
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
  }
}

export function effectsToFlatMods(
  effects: BuffEffect[],
  applyTarget?: BuffApplyTarget,
): BuffStatModifiers {
  let total = emptyMods()
  for (const effect of effects) {
    if (applyTarget && effect.applyTarget !== applyTarget) continue
    if (effect.scope !== 'general') continue
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
  stat: BuffStatKey,
  amount: number,
): BuffStatModifiers {
  return { ...mods, [stat]: mods[stat] + amount }
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
): number {
  if (effect.kind !== 'convert' || !effect.convert) return 0
  const source = effect.convert.panelSource ?? 'external'
  let from: number
  if (source === 'manual') {
    // 自行设置：不读面板，优先用计算页输入，其次配置的 defaultBase
    from =
      overrideBase != null && Number.isFinite(overrideBase)
        ? overrideBase
        : effect.convert.defaultBase != null && Number.isFinite(effect.convert.defaultBase)
          ? effect.convert.defaultBase
          : 0
  } else {
    const sourceMap =
      panelSourceValues?.[source] ??
      (source === 'final' ? panelSourceValues?.final : panelSourceValues?.external) ??
      attrValues
    from =
      overrideBase != null && Number.isFinite(overrideBase)
        ? overrideBase
        : (sourceMap[effect.convert.from] ?? attrValues[effect.convert.from] ?? 0)
  }
  const initialBase =
    effect.convert.initialBase != null && Number.isFinite(effect.convert.initialBase)
      ? effect.convert.initialBase
      : 0
  const convertible = Math.max(0, from - initialBase)
  let amount = (convertible * effect.convert.ratioPercent) / 100
  if (effect.convert.cap != null && Number.isFinite(effect.convert.cap)) {
    amount = Math.min(amount, effect.convert.cap)
  }
  // 转模结果统一到 4 位小数，与界面展示一致
  return roundCalc(amount)
}

export function effectMatchesContext(
  effect: BuffEffect,
  ctx: SkillCalcContext | null | undefined,
): boolean {
  if (!ctx) {
    return effect.scope === 'general'
  }

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

  const scope = effect.scope

  if (scope === 'mutation') {
    return ctx.damageKind === 'anomaly'
  }
  if (scope === 'radiance') {
    return ctx.damageKind === 'anomaly' && (ctx.anomalySubKind ?? 'anomaly') === 'radiance'
  }

  if (isAnomalyDamageScope(scope)) {
    if (ctx.damageKind !== 'anomaly') return false
    const required = scopeToAnomalySubKind(scope)
    const current = ctx.anomalySubKind ?? 'anomaly'
    if (required === current) return true
    // 异常 scope 的异放倍率增益在异放结算时也应生效
    if (
      current === 'anomalyRelease' &&
      required === 'anomaly' &&
      (effect.stat === 'anomalyReleaseMult' || effect.stat === 'anomalyReleaseMultFactor')
    ) {
      return true
    }
    return false
  }

  if (ctx.damageKind === 'anomaly') {
    const skillStat =
      effect.stat === 'skillDmgBonus' || effect.stat === 'skillMultiplierBonus'
    const allowsAnomaly =
      effect.appliesToAnomaly === true ||
      (effect.appliesToAnomaly !== false && scope === 'general' && !skillStat)
    if (!allowsAnomaly) return false
    if (scope === 'skill' && effect.appliesToAnomaly !== true) return false
  }

  if (scope === 'general') return true

  if (scope === 'skill') {
    if (ctx.damageKind === 'anomaly' && effect.appliesToAnomaly !== true) return false
    const targets = getEffectSkillTargets(effect)
    if (!targets.length) return false
    return targets.some((target) => skillTargetMatchesContext(target, ctx))
  }

  return false
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

/**
 * @deprecated 人数条件不再覆盖数值；请用 effectMatchesTeamProfessionGate。
 * 保留：不满足条件 → null；满足 → undefined（继续走固定/叠层/转模自身数值）。
 */
export function resolveTeamProfessionAmount(
  effect: Pick<
    BuffEffect,
    | 'kind'
    | 'teamProfession'
    | 'teamProfessionValues'
    | 'teamProfessionMinCount'
    | 'value'
  >,
  teamProfessionCount: number,
): number | null | undefined {
  if (!effectMatchesTeamProfessionGate(effect, teamProfessionCount)) return null
  return undefined
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

export function filterEffects(
  effects: BuffEffect[],
  options: {
    applyTarget?: BuffApplyTarget
    ctx?: SkillCalcContext | null
    element?: string
    enabledIds?: Set<string> | null
    disabledIds?: Set<string> | null
  } = {},
): BuffEffect[] {
  return effects.filter((effect) => {
    if (options.applyTarget && effect.applyTarget !== options.applyTarget) return false
    if (options.enabledIds && !options.enabledIds.has(effect.id)) {
      if (effect.enabledDefault === false) return false
      if (options.disabledIds?.has(effect.id)) return false
      if (options.enabledIds.size > 0 && !options.enabledIds.has(effect.id)) {
        // enabledIds 非空表示显式勾选集合
        return false
      }
    }
    if (options.disabledIds?.has(effect.id)) return false
    if (!effectMatchesContext(effect, options.ctx)) return false
    if (!effectMatchesElement(effect, options.element ?? options.ctx?.element)) return false
    return true
  })
}

export function isEffectEnabled(
  effect: BuffEffect,
  selection: { enabledIds?: Record<string, boolean> } | null | undefined,
): boolean {
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
    /** 跳过转模效果（用于先叠非转模再算转模） */
    skipConvert?: boolean
    selection?: { enabledIds?: Record<string, boolean> } | null
    /** 队内某职业人数；有人数条件的效果必须传入，否则带条件效果一律不结算 */
    resolveTeamProfessionCount?: (profession: string) => number
    /** 当前结算主槽角色职业（防线 Buff 等 applyProfession 条件） */
    beneficiaryProfession?: string | null
  } = {},
): BuffStatModifiers {
  let total = emptyMods()
  for (const effect of effects) {
    if (options.applyTargets?.length) {
      if (!options.applyTargets.includes(effect.applyTarget)) continue
    } else if (options.applyTarget && effect.applyTarget !== options.applyTarget) {
      continue
    }
    if (!isEffectEnabled(effect, options.selection)) continue
    if (!effectMatchesContext(effect, options.ctx)) continue
    const matchElement =
      effect.applyTarget === 'team'
        ? (options.beneficiaryElement ?? options.element ?? options.ctx?.element)
        : (options.element ?? options.ctx?.element)
    if (!effectMatchesElement(effect, matchElement)) continue
    if (effect.teamProfession?.trim()) {
      if (!options.resolveTeamProfessionCount) continue
      const count = options.resolveTeamProfessionCount(effect.teamProfession.trim())
      if (!effectMatchesTeamProfessionGate(effect, count)) continue
    }
    if (effect.applyProfession?.trim()) {
      const required = effect.applyProfession.trim()
      const beneficiary = String(options.beneficiaryProfession ?? '').trim()
      if (beneficiary !== required) continue
    }
    if (options.skipConvert && effect.kind === 'convert') continue

    const stacks =
      options.stacksByEffectId?.[effect.id] ?? effect.defaultStacks ?? 1
    let amount =
      effect.kind === 'convert'
        ? resolveConvertValue(
            effect,
            options.attrValues ?? {},
            options.convertInputs && effect.id in options.convertInputs
              ? options.convertInputs[effect.id]
              : null,
            options.panelSourceValues,
          )
        : resolveEffectBaseValue(effect, stacks)
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

function normalizeScope(value: unknown): BuffScope {
  if (typeof value === 'string' && BUFF_SCOPE_SET.has(value)) {
    return value as BuffScope
  }
  return 'general'
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

function normalizeStat(value: unknown): BuffStatKey {
  if (typeof value === 'string' && (BUFF_STAT_KEYS as string[]).includes(value)) {
    return value as BuffStatKey
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

  let from: CharacterAttrKey
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
  const effect = createEmptyBuffEffect({
    id: typeof entry.id === 'string' && entry.id ? entry.id : newEffectId(),
    origin: typeof entry.origin === 'string' ? entry.origin : '',
    scope: normalizeScope(entry.scope),
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
    appliesToAnomaly: resolveAppliesToAnomaly(entry),
    enabledDefault: entry.enabledDefault === false ? false : true,
    note: typeof entry.note === 'string' ? entry.note : '',
  })
  if (effect.kind === 'convert' && !effect.convert) {
    effect.kind = 'fixed'
  }
  if (effect.scope === 'skill') {
    const targets = getEffectSkillTargets(effect)
    if (!targets.length) {
      setEffectSkillTargets(effect, [{ category: 'basic', subcategoryId: null }])
    } else {
      setEffectSkillTargets(effect, targets)
    }
  }
  return effect
}

/**
 * 耀变/异放/紊乱等天然异常乘区：招式限定时若未显式关闭，默认可用于异常伤害。
 * 增伤类（skillDmgBonus / dmgBonus）仍须显式勾选 appliesToAnomaly。
 */
const INHERENT_ANOMALY_SKILL_STATS = new Set<BuffStatKey>([
  'anomalyMult',
  'anomalyMultFactor',
  'anomalyReleaseMult',
  'anomalyReleaseMultFactor',
  'disorderBaseMult',
  'disorderBaseMultFactor',
  'disorderCompMult',
  'disorderDmgBonus',
  'turbulenceBaseMult',
  'turbulenceBaseMultFactor',
  'turbulenceCompMult',
  'turbulenceDmgBonus',
  'radianceMult',
  'radianceMultFactor',
  'radianceDmgBonus',
  'radianceResPen',
  'anomalyDmgBonus',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDuration',
  'mutationCoeff',
  'mutationCoeffFactor',
])

function resolveAppliesToAnomaly(entry: Record<string, unknown>): boolean | undefined {
  if (entry.appliesToAnomaly != null) return Boolean(entry.appliesToAnomaly)
  const scope = normalizeScope(entry.scope)
  const stat = normalizeStat(entry.stat)
  if (scope === 'skill' && INHERENT_ANOMALY_SKILL_STATS.has(stat)) return true
  return undefined
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

export function normalizeSelfTeamBuffsWithEffects(value: unknown): AgentMindscapeRankBuffs {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entry = value as Record<string, unknown>
    if (Array.isArray(entry.effectBlocks) && entry.effectBlocks.length > 0) {
      return packFromBlocks(normalizeBuffEffectBlocks(entry.effectBlocks))
    }
    if (Array.isArray(entry.effects) && entry.effects.length > 0) {
      return packFromEffects(normalizeBuffEffects(entry.effects))
    }
    if (entry.selfMods || entry.teamMods) {
      const effects = [
        ...flatModsToEffects(normalizeLooseMods(entry.selfMods), 'self'),
        ...flatModsToEffects(normalizeLooseMods(entry.teamMods), 'team'),
      ]
      return packFromEffects(effects)
    }
  }
  return packFromEffects([])
}

function normalizeLooseMods(value: unknown): BuffStatModifiers {
  const empty = emptyMods()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const entry = value as Record<string, unknown>
  const result = { ...empty }
  for (const key of BUFF_STAT_KEYS) {
    result[key] = readNumber(entry[key])
  }
  return result
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

export function mergeEffectLists(...lists: BuffEffect[][]): BuffEffect[] {
  return lists.flat()
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
    CHARACTER_ATTR_OPTIONS.find((item) => item.id === convert.from)?.label ?? convert.from
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

/** 按顺序拼接全部招式目标括号 */
export function formatSkillTargetsPrefix(
  effect: BuffEffect,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  if (effect.scope !== 'skill') return ''
  return getEffectSkillTargets(effect)
    .map((target) => formatSkillTargetBracket(target, skillSubcategories))
    .join('')
}

export function effectSummaryLabel(
  effect: BuffEffect,
  statLabelFn?: (stat: BuffStatKey) => string,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  const target = effect.applyTarget === 'team' ? '全队' : '自身'
  const skillPrefix = formatSkillTargetsPrefix(effect, skillSubcategories)
  const scope =
    effect.scope === 'skill'
      ? skillPrefix
        ? `招式·${skillPrefix}`
        : '招式'
      : (BUFF_SCOPE_LABELS[effect.scope] ?? '通用')
  const situation =
    APPLY_SITUATION_LABELS[effect.applySituation ?? 'global'] ?? '全局'
  const applyProf = formatApplyProfessionLabel(effect)
  const elementLabel = formatElementFilterLabel(effect)
  const gate = formatTeamProfessionGateLabel(effect)
  const statText = statLabelFn?.(effect.stat) ?? effect.stat
  const kind =
    effect.kind === 'stacked'
      ? `叠层×${effect.valuePerStack ?? 0}`
      : effect.kind === 'convert'
        ? convertSummaryLabel(effect.convert)
        : `${effect.value ?? 0}`
  const parts = [target, scope, situation]
  if (applyProf) parts.splice(0, 0, applyProf)
  // 属性限制：全局之后、效果之前
  if (elementLabel) parts.push(elementLabel)
  if (gate) parts.push(gate)
  parts.push(`${statText} ${kind}`)
  return parts.join(' · ')
}

/** 局内 Buff 卡片效果行：`[强攻][斩妄开天] [电] 增伤 +40` */
export function formatBuffEffectResultText(
  effect: BuffEffect,
  amountText: string,
  options?: {
    statLabelFn?: (stat: BuffStatKey) => string
    skillSubcategories?: SkillSubcategory[] | null
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
  return `${head}${head ? ' ' : ''}${mid}${el}${label} ${amountText}`
}

export { BUFF_STAT_KEYS }
