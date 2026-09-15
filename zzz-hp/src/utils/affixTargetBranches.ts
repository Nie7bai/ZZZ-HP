/**
 * 词条目标下拉：时机 → 2 级组 → 叶子，三个下拉同一行。
 * 只改选法，不改计算。2 级组名来自 `sandbox/affix-target-classify.xlsx`。
 *
 * 「局外重复」= 局外和局内都可以加的同一属性（暴击 / 爆伤 / 增伤 / 精通），不是删除。
 */
import {
  AFFIX_GAIN_FIELDS,
  AFFIX_PANEL_DELTA_FIELD_LABELS,
  AFFIX_SUBSTAT_KEY_LABELS,
  affixTargetLabel,
  gainTarget,
  isAffixPanelTargetHiddenFromPicker,
  panelTarget,
  type AffixGainField,
  type AffixLibraryEntryTarget,
  type AffixPanelDeltaField,
} from '@/utils/affixLibrary'
import type { AffixCounts } from '@/types/calculatorPanel'

export type AffixTargetTiming = 'panel' | 'gain'

export interface AffixTargetBranchOption {
  id: AffixLibraryEntryTarget
  label: string
}

export interface AffixTargetBranchGroup {
  id: string
  label: string
  options: AffixTargetBranchOption[]
}

export const AFFIX_TARGET_TIMING_OPTIONS: readonly { id: AffixTargetTiming; label: string }[] = [
  { id: 'panel', label: '局外' },
  { id: 'gain', label: '局内' },
]

function opt(id: AffixLibraryEntryTarget): AffixTargetBranchOption {
  return { id, label: affixTargetLabel(id) }
}

function panelOpts(...fields: Parameters<typeof panelTarget>[0][]): AffixTargetBranchOption[] {
  return fields.map((field) => opt(panelTarget(field)))
}

function gainOpts(...fields: AffixGainField[]): AffixTargetBranchOption[] {
  return fields.map((field) => opt(gainTarget(field)))
}

function group(
  id: string,
  label: string,
  options: AffixTargetBranchOption[],
): AffixTargetBranchGroup {
  return { id, label, options }
}

function buildAffixTargetBranchGroups(): AffixTargetBranchGroup[] {
  const groups: AffixTargetBranchGroup[] = [
    group('hp', '生命', [
      ...panelOpts('hpPercent', 'hpFlat'),
      ...gainOpts('inCombatHpPercent', 'externalHpPercent', 'hp'),
    ]),
    group('atk', '攻击', [
      ...panelOpts('atkPercent', 'atkFlat'),
      ...gainOpts('inCombatAtkPercent', 'externalAtkPercent', 'atk'),
    ]),
    group('def', '防御', [
      ...panelOpts('defPercent', 'defFlat'),
      ...gainOpts('inCombatDefPercent', 'externalDefPercent', 'def'),
    ]),
    group('shared', '局外重复', [
      ...panelOpts('critRate', 'critDmg', 'dmgBonus', 'mastery'),
      ...gainOpts('critRate', 'critDmg', 'dmgBonus', 'mastery'),
    ]),
    group('defenseZone', '防御区', [
      ...panelOpts('penRate', 'pen'),
      ...gainOpts('penRate', 'reduceDefense'),
    ]),
    group('nonCombat', '非战斗', [
      ...panelOpts('anomalyControl', 'energyRegen', 'impact'),
      ...gainOpts(
        'anomalyControl',
        'anomalyControlPercent',
        'energyRegen',
        'energyRegenFlat',
        'pierce',
      ),
    ]),
    group('anomaly', '属性异常', [
      ...gainOpts(
        'anomalyDmgBonus',
        'anomalyCritRate',
        'anomalyCritDmg',
        'anomalyMult',
        'anomalyMultFactor',
        'anomalyDuration',
      ),
    ]),
    group('anomalyRelease', '异常放', [
      ...gainOpts(
        'anomalyReleaseDmgBonus',
        'anomalyReleaseCritRate',
        'anomalyReleaseCritDmg',
        'anomalyReleaseMult',
        'anomalyReleaseMultFactor',
      ),
    ]),
    group('disorder', '紊乱', [
      ...gainOpts('disorderDmgBonus', 'disorderBaseMult', 'disorderBaseMultFactor', 'disorderCompMult'),
    ]),
    group('turbulence', '乱流', [
      ...gainOpts(
        'turbulenceDmgBonus',
        'turbulenceBaseMult',
        'turbulenceBaseMultFactor',
        'turbulenceCompMult',
      ),
    ]),
    group('radiance', '耀变', [
      ...gainOpts('radianceDmgBonus', 'radianceResPen', 'radianceMult', 'radianceMultFactor'),
    ]),
    group('directMult', '直伤倍率', [
      ...gainOpts('directDmgMult', 'directDmgMultFactor', 'settlementDmgMult'),
    ]),
    group('rare', '稀有乘区', [
      ...gainOpts(
        'vulnerable',
        'directVulnerable',
        'anomalyVulnerable',
        'dmgReduction',
        'directDmgReduction',
        'anomalyDmgReduction',
        'dmgPenalty',
      ),
    ]),
    group('profession', '职业特有乘区', [
      ...gainOpts('pierceDmgBonus', 'sharpenDmgBonus', 'sharpenCritDmgBonus'),
    ]),
    group('agent', '角色特有乘区', [...gainOpts('mutationCoeff', 'mutationCoeffFactor')]),
    group('skill', '特殊', [...gainOpts('skillDmgBonus', 'skillMultiplierBonus')]),
    group('other', '其他', [
      ...gainOpts(
        'resPen',
        'specialMult',
        'specialMultFactor',
        'special',
        'globalStaggerVulnerable',
        'staggerVulnerable',
        'staggerVulnerableOnly',
      ),
    ]),
  ]

  const classified = new Set(groups.flatMap((item) => item.options.map((option) => option.id)))

  const leftoverGain = AFFIX_GAIN_FIELDS.filter((field) => !classified.has(gainTarget(field))).map(
    (field) => opt(gainTarget(field)),
  )
  const leftoverPanel = [
    ...(Object.keys(AFFIX_SUBSTAT_KEY_LABELS) as (keyof AffixCounts)[]).map((key) =>
      panelTarget(key),
    ),
    ...(Object.keys(AFFIX_PANEL_DELTA_FIELD_LABELS) as AffixPanelDeltaField[]).map((field) =>
      panelTarget(field),
    ),
  ]
    .filter(
      (id, index, list) =>
        list.indexOf(id) === index &&
        !classified.has(id) &&
        !isAffixPanelTargetHiddenFromPicker(id),
    )
    .map((id) => opt(id))

  const leftover = [...leftoverPanel, ...leftoverGain]
  if (leftover.length) {
    const other = groups.find((item) => item.id === 'other')
    if (other) other.options.push(...leftover)
    else groups.push(group('other', '其他', leftover))
  }

  return groups
}

export const AFFIX_TARGET_BRANCH_GROUPS: readonly AffixTargetBranchGroup[] =
  buildAffixTargetBranchGroups()

export const AFFIX_KNOWN_TARGET_IDS: ReadonlySet<string> = new Set(
  AFFIX_TARGET_BRANCH_GROUPS.flatMap((item) => item.options.map((option) => option.id)),
)

export function affixTargetTiming(target: string): AffixTargetTiming {
  return target.startsWith('gain:') ? 'gain' : 'panel'
}

export function findAffixTargetBranchGroup(target: string): AffixTargetBranchGroup | undefined {
  return AFFIX_TARGET_BRANCH_GROUPS.find((item) =>
    item.options.some((option) => option.id === target),
  )
}

export function groupsForAffixTargetTiming(timing: AffixTargetTiming): AffixTargetBranchGroup[] {
  return AFFIX_TARGET_BRANCH_GROUPS.map((item) => ({
    ...item,
    options: item.options.filter((option) => option.id.startsWith(`${timing}:`)),
  })).filter((item) => item.options.length > 0)
}

function fieldOfTarget(target: string): string {
  const index = target.indexOf(':')
  return index === -1 ? target : target.slice(index + 1)
}

/** 切时机：尽量留在同一 2 级组；字段名对得上就切到对应叶子。 */
export function pickAffixTargetForTiming(
  current: string,
  timing: AffixTargetTiming,
): AffixLibraryEntryTarget {
  const groups = groupsForAffixTargetTiming(timing)
  const defaultLeaf = groups[0]?.options[0]
  if (!defaultLeaf) {
    return (current.startsWith(`${timing}:`) ? current : 'panel:atkPercent') as AffixLibraryEntryTarget
  }
  const currentGroup = findAffixTargetBranchGroup(current)
  const pool =
    (currentGroup && groups.find((item) => item.id === currentGroup.id)?.options) ||
    groups[0]?.options ||
    [defaultLeaf]
  const field = fieldOfTarget(current)
  return pool.find((option) => fieldOfTarget(option.id) === field)?.id ?? defaultLeaf.id
}

/** 切 2 级组：时机不变；字段名对得上就留在对应叶子。 */
export function pickAffixTargetForGroup(
  current: string,
  groupId: string,
  timing: AffixTargetTiming,
): AffixLibraryEntryTarget {
  const groups = groupsForAffixTargetTiming(timing)
  const group = groups.find((item) => item.id === groupId) ?? groups[0]
  const defaultLeaf = group?.options[0]
  if (!defaultLeaf) return pickAffixTargetForTiming(current, timing)
  const field = fieldOfTarget(current)
  return group.options.find((option) => fieldOfTarget(option.id) === field)?.id ?? defaultLeaf.id
}

/** 表内只读摘要：时机 · 2 级组 · 叶子 */
export function affixTargetPickerSummary(target: string): string {
  const timingLabel =
    AFFIX_TARGET_TIMING_OPTIONS.find((item) => item.id === affixTargetTiming(target))?.label ?? ''
  const groupLabel = findAffixTargetBranchGroup(target)?.label ?? ''
  const leafLabel = affixTargetLabel(target as AffixLibraryEntryTarget)
  return [timingLabel, groupLabel, leafLabel].filter(Boolean).join(' · ')
}
