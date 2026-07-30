import type {
  AgentBasePanel,
  AgentMindscapeRankBuffs,
  BuffStatKey,
  BuffStatModifiers,
  WengineAdvancedStats,
} from '@/types/calculator'
import {
  flatModsToEffects,
  normalizeBuffEffectBlocks,
  normalizeBuffEffects,
  packFromBlocks,
  packFromEffects,
  wrapEffectsAsBlocks,
} from '@/utils/buffEffect'
import { normalizeBuffMultFactorDelta, normalizePanelMultFactorPercent } from '@/utils/multFactorPercent'

export const AGENT_ROLES = ['强攻', '击破', '异常', '支援', '防护', '命破'] as const
export const AGENT_ELEMENTS = ['风', '火', '电', '物理', '以太', '冰', '流明'] as const
export const WENGINE_RARITIES = ['S', 'A', 'B'] as const
export type WengineRarity = (typeof WENGINE_RARITIES)[number]

export type AgentRole = (typeof AGENT_ROLES)[number]
export type AgentElement = (typeof AGENT_ELEMENTS)[number]

/** 音擎职业与角色一致时增益才生效；任一方职业为空时放行（兼容未填数据） */
export function isWengineProfessionMatch(
  agentProfession: string | null | undefined,
  wengineProfession: string | null | undefined,
) {
  const agent = String(agentProfession ?? '').trim()
  const wengine = String(wengineProfession ?? '').trim()
  if (!agent || !wengine) return true
  return agent === wengine
}

export const AGENT_MINDSCAPE_RANKS = [0, 1, 2, 3, 4, 5, 6] as const
export const REFINEMENT_RANKS = [1, 2, 3, 4, 5] as const
export type RefinementRank = (typeof REFINEMENT_RANKS)[number]

export const SUPPORT_STAT_OPTIONS = [
  { id: 'hp', label: '生命值' },
  { id: 'atk', label: '攻击力' },
  { id: 'critRate', label: '暴击率' },
  { id: 'critDmg', label: '暴击伤害' },
  { id: 'dmgBonus', label: '增伤' },
  { id: 'penRate', label: '穿透率' },
  { id: 'pen', label: '穿透值' },
  { id: 'resPen', label: '抗穿' },
] as const

export const BUFF_STAT_FIELDS: {
  key: BuffStatKey
  label: string
  unit: 'percent' | 'flat' | 'factor'
  hint: string
}[] = [
  {
    key: 'inCombatHpPercent',
    label: '局内生命值',
    unit: 'percent',
    hint: '局外生命 × (1 + 值/100)',
  },
  {
    key: 'inCombatAtkPercent',
    label: '局内攻击力',
    unit: 'percent',
    hint: '仅对局外基础攻击乘算，不含固定攻击力',
  },
  {
    key: 'inCombatDefPercent',
    label: '局内防御力',
    unit: 'percent',
    hint: '仅对局外基础防御乘算，不含固定防御力',
  },
  {
    key: 'externalHpPercent',
    label: '局外生命值',
    unit: 'percent',
    hint: '参与词条计算的局外生命乘算',
  },
  {
    key: 'externalAtkPercent',
    label: '局外攻击力',
    unit: 'percent',
    hint: '参与词条计算的局外攻击乘算',
  },
  {
    key: 'externalDefPercent',
    label: '局外防御力',
    unit: 'percent',
    hint: '参与词条计算的局外防御乘算',
  },
  {
    key: 'atk',
    label: '攻击力',
    unit: 'flat',
    hint: '固定数值，直接加到局内攻击，不受局内攻击力%影响',
  },
  {
    key: 'def',
    label: '防御力',
    unit: 'flat',
    hint: '固定数值，直接加到局内防御，不受局内防御力%影响',
  },
  { key: 'pierce', label: '贯穿力', unit: 'flat', hint: '固定数值，加到局内贯穿力' },
  { key: 'dmgBonus', label: '增伤', unit: 'percent', hint: '百分点，累加到局内增伤%' },
  { key: 'critRate', label: '暴击', unit: 'percent', hint: '百分点，累加到局内暴击率%' },
  { key: 'critDmg', label: '爆伤', unit: 'percent', hint: '百分点，累加到局内暴伤%' },
  { key: 'penRate', label: '穿透率', unit: 'percent', hint: '百分点，累加到局内穿透率%' },
  { key: 'reduceDefense', label: '无视防御/减防', unit: 'percent', hint: '百分点，累加到局内无视防御与减防（二者加算）' },
  { key: 'resPen', label: '抗性穿透', unit: 'percent', hint: '百分点，累加到局内抗穿%' },
  { key: 'mastery', label: '精通', unit: 'flat', hint: '固定数值，累加到局内精通' },
  {
    key: 'anomalyControl',
    label: '异常掌控',
    unit: 'flat',
    hint: '固定数值，累加到局内异常掌控（不进伤害乘区）',
  },
  {
    key: 'anomalyControlPercent',
    label: '异常掌控',
    unit: 'percent',
    hint: '百分点，按角色基础面板的初始异常掌控换算后加到局内异常掌控',
  },
  {
    key: 'energyRegen',
    label: '能量回复效率',
    unit: 'percent',
    hint: '百分点：游戏显示 1.2（120%）时填 120；提升 20% 填 20。按角色初始能量回复效率换算',
  },
  {
    key: 'energyRegenFlat',
    label: '能量回复效率（数值）',
    unit: 'flat',
    hint: '固定数值直接累加；能量回复请优先用上方百分比字段',
  },
  { key: 'vulnerable', label: '易伤', unit: 'percent', hint: '独立易伤区，常驻加算（如 1.5 + 30% = 1.8）' },
  {
    key: 'globalStaggerVulnerable',
    label: '全局失衡易伤',
    unit: 'percent',
    hint: '失衡期与非失衡期均生效',
  },
  {
    key: 'staggerVulnerable',
    label: '失衡易伤',
    unit: 'percent',
    hint: '全局存在，仅在失衡期计入乘区',
  },
  {
    key: 'staggerVulnerableOnly',
    label: '失衡易伤（仅失衡）',
    unit: 'percent',
    hint: '仅在失衡期存在并计入乘区',
  },
  {
    key: 'special',
    label: '特殊补充',
    unit: 'percent',
    hint: '独立乘区，对所有伤害生效；与本区基础加算',
  },
  { key: 'anomalyCritRate', label: '异常暴击', unit: 'percent', hint: '百分点，累加到局内异常暴击率%' },
  { key: 'anomalyCritDmg', label: '异常爆伤', unit: 'percent', hint: '百分点，累加到局内异常爆伤%' },
  { key: 'anomalyDmgBonus', label: '异常增伤', unit: 'percent', hint: '百分点，与异常增伤区加算（1 + 值/100）' },
  {
    key: 'directDmgMult',
    label: '直伤倍率',
    unit: 'percent',
    hint: '百分点，累加到局内直伤倍率%（伤害 × 值/100）',
  },
  {
    key: 'settlementDmgMult',
    label: '决算倍率',
    unit: 'percent',
    hint: '百分点，独立决算伤害分量，计入直伤大类（通用乘区 × 值/100 × 直伤倍率修正）',
  },
  {
    key: 'directDmgMultFactor',
    label: '直伤倍率修正',
    unit: 'percent',
    hint: '百分点，与面板倍率修正加算；默认 100% 表示 ×1',
  },
  {
    key: 'anomalyMult',
    label: '异常倍率提升',
    unit: 'percent',
    hint: '百分点，累加到局内异常倍率%（伤害 × 值/100）',
  },
  {
    key: 'anomalyMultFactor',
    label: '异常倍率修正',
    unit: 'percent',
    hint: '百分点，与面板倍率修正加算',
  },
  {
    key: 'disorderBaseMult',
    label: '紊乱倍率提升',
    unit: 'percent',
    hint: '百分点，加算到紊乱基础倍率（参与最终紊乱倍率）',
  },
  {
    key: 'disorderBaseMultFactor',
    label: '紊乱倍率修正',
    unit: 'percent',
    hint: '百分点，与面板倍率修正加算',
  },
  {
    key: 'anomalyDuration',
    label: '异常持续时间',
    unit: 'flat',
    hint: '秒；火/以太计算时有效时间 = 持续时间 ÷ 0.5',
  },
  {
    key: 'disorderCompMult',
    label: '紊乱补偿倍率',
    unit: 'percent',
    hint: '百分点，与异常持续时间相乘后加算到紊乱基础倍率区',
  },
  {
    key: 'turbulenceBaseMult',
    label: '乱流倍率提升',
    unit: 'percent',
    hint: '百分点，加算到乱流基础倍率（参与最终乱流倍率）',
  },
  {
    key: 'turbulenceBaseMultFactor',
    label: '乱流倍率修正',
    unit: 'percent',
    hint: '百分点，与面板倍率修正加算',
  },
  {
    key: 'turbulenceCompMult',
    label: '乱流补偿倍率',
    unit: 'percent',
    hint: '百分点，与异常持续时间相乘后加算到乱流基础倍率区',
  },
  {
    key: 'disorderDmgBonus',
    label: '紊乱增伤',
    unit: 'percent',
    hint: '百分点，紊乱增伤区 = 1 + 值%',
  },
  {
    key: 'turbulenceDmgBonus',
    label: '乱流增伤',
    unit: 'percent',
    hint: '百分点，乱流增伤区 = 1 + 值%',
  },
  {
    key: 'radianceMult',
    label: '耀变倍率',
    unit: 'percent',
    hint: '百分点，耀变倍率加算',
  },
  {
    key: 'radianceMultFactor',
    label: '耀变倍率修正',
    unit: 'factor',
    hint: '乘算修正，默认 100',
  },
  {
    key: 'radianceDmgBonus',
    label: '耀变增伤',
    unit: 'percent',
    hint: '与异常增伤加算后参与耀变综合增伤',
  },
  {
    key: 'radianceResPen',
    label: '耀变抗性穿透',
    unit: 'percent',
    hint: '仅耀变：并入产生角色抗性区',
  },
  {
    key: 'mutationCoeff',
    label: '异化系数',
    unit: 'percent',
    hint: '队伍有蕾米埃尔时，所有异常伤害独立乘区',
  },
  {
    key: 'mutationCoeffFactor',
    label: '异化系数修正',
    unit: 'factor',
    hint: '乘算修正，默认 100',
  },
  { key: 'hp', label: '固定生命', unit: 'flat', hint: '固定数值，直接加到局内生命' },
  {
    key: 'pierceDmgBonus',
    label: '贯穿增伤',
    unit: 'percent',
    hint: '独立乘区，仅当直伤基础来源为贯穿力时生效，不进增伤区',
  },
  {
    key: 'anomalyReleaseDmgBonus',
    label: '异放增伤',
    unit: 'percent',
    hint: '百分点，异放增伤区加算',
  },
  {
    key: 'anomalyReleaseCritRate',
    label: '异放暴击',
    unit: 'percent',
    hint: '百分点，累加到异放暴击率',
  },
  {
    key: 'anomalyReleaseCritDmg',
    label: '异放爆伤',
    unit: 'percent',
    hint: '百分点，累加到异放爆伤',
  },
  {
    key: 'anomalyReleaseMult',
    label: '异放倍率提升',
    unit: 'percent',
    hint: '百分点，异放倍率加算',
  },
  {
    key: 'anomalyReleaseMultFactor',
    label: '异放倍率修正',
    unit: 'percent',
    hint: '百分点，与面板倍率修正加算',
  },
  {
    key: 'skillDmgBonus',
    label: '招式伤害加成',
    unit: 'percent',
    hint: '招式增益：进增伤区加算',
  },
  {
    key: 'skillMultiplierBonus',
    label: '招式倍率加算',
    unit: 'percent',
    hint: '招式增益：进直伤倍率区加算',
  },
]

/** 招式专属字段（管理端招式 scope 可选） */
export const SKILL_BUFF_STAT_KEYS: BuffStatKey[] = ['skillDmgBonus', 'skillMultiplierBonus']

export const GENERAL_BUFF_STAT_FIELDS = BUFF_STAT_FIELDS.filter(
  (field) => !SKILL_BUFF_STAT_KEYS.includes(field.key),
)

export const SKILL_BUFF_STAT_FIELDS = BUFF_STAT_FIELDS.filter((field) =>
  SKILL_BUFF_STAT_KEYS.includes(field.key),
)

/** 异常倍率% 按属性默认值 */
export const ANOMALY_MULT_BY_ELEMENT: Record<AgentElement, number> = {
  冰: 500,
  物理: 713,
  火: 50,
  电: 125,
  以太: 62.5,
  风: 1250,
  流明: 0,
}

export function defaultAnomalyMultByElement(element: string): number {
  return ANOMALY_MULT_BY_ELEMENT[element as AgentElement] ?? 0
}

export function isMiyabiAgent(agentIdOrName = ''): boolean {
  const text = agentIdOrName.trim().toLowerCase()
  return text === 'miyabi' || text.includes('星见雅') || text.includes('miyabi')
}

export function defaultDisorderCompMultByElement(element: string, agentIdOrName = ''): number {
  if (element === '风') return 0
  if (isMiyabiAgent(agentIdOrName)) return 75
  const disorderCompByElement: Record<string, number> = {
    物理: 7.5,
    冰: 7.5,
    火: 50,
    电: 125,
    以太: 62.5,
  }
  return disorderCompByElement[element] ?? 0
}

/** 紊乱相关默认值（按属性；星见雅单独处理） */
export function defaultDisorderStats(
  element: string,
  agentIdOrName = '',
): {
  disorderBaseMult: number
  anomalyDuration: number
  disorderCompMult: number
} {
  if (element === '风') {
    return { disorderBaseMult: 0, anomalyDuration: 30, disorderCompMult: 0 }
  }
  if (isMiyabiAgent(agentIdOrName)) {
    return { disorderBaseMult: 600, anomalyDuration: 20, disorderCompMult: 75 }
  }
  return {
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: defaultDisorderCompMultByElement(element, agentIdOrName),
  }
}

/** 乱流相关默认值（补偿倍率数值与紊乱相同但字段独立） */
export function defaultTurbulenceStats(
  element: string,
  agentIdOrName = '',
): {
  turbulenceBaseMult: number
  turbulenceCompMult: number
} {
  if (isMiyabiAgent(agentIdOrName)) {
    return {
      turbulenceBaseMult: 0,
      turbulenceCompMult: defaultDisorderCompMultByElement(element, agentIdOrName),
    }
  }
  const turbulenceBaseByElement: Record<string, number> = {
    物理: 800,
    冰: 1300,
    火: 900,
    电: 650,
    以太: 650,
  }
  return {
    turbulenceBaseMult: turbulenceBaseByElement[element] ?? 0,
    turbulenceCompMult: defaultDisorderCompMultByElement(element, agentIdOrName),
  }
}

/** 火/以太计算时异常持续时间 ÷ 0.5 */
export function effectiveAnomalyDuration(duration: number, element: string): number {
  if (element === '火' || element === '以太') return duration / 0.5
  return duration
}

export function buffStatFieldLabel(field: (typeof BUFF_STAT_FIELDS)[number]) {
  return field.unit === 'flat' ? `${field.label}（数值）` : `${field.label}%`
}

export const TWO_PIECE_BUFF_STAT_FIELDS = BUFF_STAT_FIELDS.filter(
  (field) =>
    field.key !== 'inCombatHpPercent' &&
    field.key !== 'inCombatAtkPercent' &&
    field.key !== 'inCombatDefPercent',
)

export function normalizeTwoPieceMods(value: unknown): BuffStatModifiers {
  const mods = normalizeBuffStatModifiers(value)
  if (!mods.externalHpPercent && mods.inCombatHpPercent) {
    mods.externalHpPercent = mods.inCombatHpPercent
  }
  if (!mods.externalAtkPercent && mods.inCombatAtkPercent) {
    mods.externalAtkPercent = mods.inCombatAtkPercent
  }
  if (!mods.externalDefPercent && mods.inCombatDefPercent) {
    mods.externalDefPercent = mods.inCombatDefPercent
  }
  mods.inCombatHpPercent = 0
  mods.inCombatAtkPercent = 0
  mods.inCombatDefPercent = 0
  return mods
}

export function hasNonZeroBuffMods(mods: BuffStatModifiers): boolean {
  return BUFF_STAT_FIELDS.some((field) => mods[field.key] !== 0)
}

export function normalizeWengineRarity(value: unknown): WengineRarity {
  if (value === 'S' || value === 'A' || value === 'B') return value
  return 'A'
}

export function createEmptyBuffStatModifiers(): BuffStatModifiers {
  return {
    hp: 0,
    inCombatHpPercent: 0,
    inCombatAtkPercent: 0,
    inCombatDefPercent: 0,
    externalHpPercent: 0,
    externalAtkPercent: 0,
    externalDefPercent: 0,
    atk: 0,
    def: 0,
    dmgBonus: 0,
    critRate: 0,
    critDmg: 0,
    penRate: 0,
    reduceDefense: 0,
    resPen: 0,
    mastery: 0,
    anomalyControl: 0,
    anomalyControlPercent: 0,
    energyRegen: 0,
    energyRegenFlat: 0,
    pierce: 0,
    pierceDmgBonus: 0,
    vulnerable: 0,
    globalStaggerVulnerable: 0,
    staggerVulnerable: 0,
    staggerVulnerableOnly: 0,
    special: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    anomalyDmgBonus: 0,
    anomalyReleaseDmgBonus: 0,
    anomalyReleaseCritRate: 0,
    anomalyReleaseCritDmg: 0,
    anomalyReleaseMult: 0,
    directDmgMult: 0,
    settlementDmgMult: 0,
    anomalyMult: 0,
    disorderBaseMult: 0,
    anomalyDuration: 0,
    disorderCompMult: 0,
    turbulenceBaseMult: 0,
    turbulenceCompMult: 0,
    disorderDmgBonus: 0,
    turbulenceDmgBonus: 0,
    skillDmgBonus: 0,
    skillMultiplierBonus: 0,
    directDmgMultFactor: 0,
    anomalyMultFactor: 0,
    anomalyReleaseMultFactor: 0,
    disorderBaseMultFactor: 0,
    turbulenceBaseMultFactor: 0,
    radianceMult: 0,
    radianceDmgBonus: 0,
    radianceResPen: 0,
    mutationCoeff: 0,
    radianceMultFactor: 0,
    mutationCoeffFactor: 0,
  }
}

export function createEmptySelfTeamBuffs(): AgentMindscapeRankBuffs {
  return packFromEffects([])
}

export function createEmptyMindscapeBuffs() {
  return AGENT_MINDSCAPE_RANKS.map(() => createEmptySelfTeamBuffs())
}

export function createEmptyMindscapeNotes(): string[] {
  return AGENT_MINDSCAPE_RANKS.map(() => '')
}

export function normalizeMindscapeNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return createEmptyMindscapeNotes()
  return AGENT_MINDSCAPE_RANKS.map((_, index) =>
    typeof value[index] === 'string' ? value[index] : '',
  )
}

export function getMindscapeNote(agent: { mindscapeNotes?: string[] }, rank: number): string {
  const clampedRank = Math.min(6, Math.max(0, Math.round(rank)))
  return agent.mindscapeNotes?.[clampedRank]?.trim() ?? ''
}

/** 影画注释按阶叠加：N 影包含 0～N 影全部非空条目 */
export function getMindscapeNotesUpToRank(
  agent: { mindscapeNotes?: string[] },
  rank: number,
): { rank: number; text: string }[] {
  const clampedRank = Math.min(6, Math.max(0, Math.round(rank)))
  const notes: { rank: number; text: string }[] = []

  for (let index = 0; index <= clampedRank; index++) {
    const text = agent.mindscapeNotes?.[index]?.trim() ?? ''
    if (text) notes.push({ rank: index, text })
  }

  return notes
}

export function createEmptyRefinementMods() {
  return REFINEMENT_RANKS.map(() => createEmptyBuffStatModifiers())
}

export function createEmptyWengineRefinementBuffs(): AgentMindscapeRankBuffs[] {
  return REFINEMENT_RANKS.map(() => createEmptySelfTeamBuffs())
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
  'radianceMultFactor',
  'mutationCoeffFactor',
]

export function normalizeBuffStatModifiers(value: unknown): BuffStatModifiers {
  const empty = createEmptyBuffStatModifiers()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return empty
  }
  const entry = value as Record<string, unknown>
  const result = { ...empty }
  for (const field of BUFF_STAT_FIELDS) {
    const raw = readNumber(entry[field.key])
    if (BUFF_MULT_FACTOR_KEYS.includes(field.key)) {
      result[field.key] = normalizeBuffMultFactorDelta(raw)
    } else {
      result[field.key] = raw
    }
  }
  if (readNumber(entry.externalAtkPercent) && !result.inCombatAtkPercent) {
    result.inCombatAtkPercent = readNumber(entry.externalAtkPercent)
  }
  if (readNumber(entry.externalDefPercent) && !result.inCombatDefPercent) {
    result.inCombatDefPercent = readNumber(entry.externalDefPercent)
  }
  return result
}

export function normalizeSelfTeamBuffs(value: unknown): AgentMindscapeRankBuffs {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entry = value as Record<string, unknown>
    if (Array.isArray(entry.effectBlocks) && entry.effectBlocks.length > 0) {
      return packFromBlocks(normalizeBuffEffectBlocks(entry.effectBlocks))
    }
    if (Array.isArray(entry.effects) && entry.effects.length > 0) {
      return packFromEffects(normalizeBuffEffects(entry.effects))
    }
    if (entry.selfMods || entry.teamMods) {
      const selfMods = normalizeBuffStatModifiers(entry.selfMods)
      const teamMods = normalizeBuffStatModifiers(entry.teamMods)
      return packFromEffects([
        ...flatModsToEffects(selfMods, 'self'),
        ...flatModsToEffects(teamMods, 'team'),
      ])
    }
    if (entry.selfBuffs || entry.teamBuffs) {
      return packFromEffects([
        ...flatModsToEffects(normalizeBuffStatModifiers(entry.selfBuffs), 'self'),
        ...flatModsToEffects(normalizeBuffStatModifiers(entry.teamBuffs), 'team'),
      ])
    }
    const mods = normalizeBuffStatModifiers(entry)
    if (hasNonZeroBuffMods(mods)) {
      return packFromEffects(flatModsToEffects(mods, 'self'))
    }
  }
  return createEmptySelfTeamBuffs()
}

export function normalizeWengineRefinementBuffs(value: unknown): AgentMindscapeRankBuffs[] {
  const empty = createEmptyWengineRefinementBuffs()
  if (!Array.isArray(value)) return empty
  return REFINEMENT_RANKS.map((_, index) => normalizeSelfTeamBuffs(value[index] ?? {}))
}

export function normalizeRefinementMods(value: unknown): BuffStatModifiers[] {
  const empty = createEmptyRefinementMods()
  if (!Array.isArray(value)) return empty
  return REFINEMENT_RANKS.map((_, index) => normalizeBuffStatModifiers(value[index]))
}

export function mergeBuffStatModifiers(
  target: BuffStatModifiers,
  source: BuffStatModifiers,
): BuffStatModifiers {
  const result = { ...target }
  const factorKeys: BuffStatKey[] = [
    'directDmgMultFactor',
    'anomalyMultFactor',
    'anomalyReleaseMultFactor',
    'disorderBaseMultFactor',
    'turbulenceBaseMultFactor',
  ]
  for (const field of BUFF_STAT_FIELDS) {
    if (factorKeys.includes(field.key)) {
      const src = Number(source[field.key])
      // 增益倍率修正为百分点增量，直接加算
      if (Number.isFinite(src)) result[field.key] += src
    } else {
      result[field.key] += source[field.key]
    }
  }
  return result
}

/** 影画增益按阶叠加：N 影包含 0～N 影全部条目 */
export function collectMindscapeRankBuffs(
  mindscapeBuffs: AgentMindscapeRankBuffs[],
  rank: number,
): AgentMindscapeRankBuffs {
  const clampedRank = Math.min(6, Math.max(0, Math.round(rank)))
  const blocks: import('@/types/calculator').BuffEffectBlock[] = []

  for (let index = 0; index <= clampedRank; index++) {
    const rankBuffs = mindscapeBuffs[index] ?? createEmptySelfTeamBuffs()
    const rankBlocks =
      rankBuffs.effectBlocks?.length > 0
        ? rankBuffs.effectBlocks
        : wrapEffectsAsBlocks(rankBuffs.effects ?? [])
    for (const block of rankBlocks) {
      blocks.push({
        ...block,
        id: `r${index}-${block.id}`,
        name: `${index}影 · ${block.name?.trim() || '效果块'}`,
      })
    }
  }

  return packFromBlocks(blocks)
}

/** 仅取指定影画阶的增益，不含低阶叠加 */
export function getMindscapeRankOnlyBuffs(
  mindscapeBuffs: AgentMindscapeRankBuffs[],
  rank: number,
): AgentMindscapeRankBuffs {
  const clampedRank = Math.min(6, Math.max(0, Math.round(rank)))
  return mindscapeBuffs[clampedRank] ?? createEmptySelfTeamBuffs()
}

export function hasBuffStatModifiers(mods: BuffStatModifiers) {
  return BUFF_STAT_FIELDS.some((field) => mods[field.key] !== 0)
}

export function formatBuffModsSummary(mods: BuffStatModifiers) {
  const parts = BUFF_STAT_FIELDS.filter((field) => mods[field.key] !== 0).map((field) => {
    const value = mods[field.key]
    return `${buffStatFieldLabel(field)} ${value > 0 ? '+' : ''}${value}`
  })
  return parts.length ? parts.join('，') : '无'
}

export const AGENT_BASE_PANEL_FIELDS: {
  key: keyof AgentBasePanel
  label: string
  unit: 'flat' | 'percent'
}[] = [
  { key: 'hp', label: '基础生命值', unit: 'flat' },
  { key: 'atk', label: '基础攻击力', unit: 'flat' },
  { key: 'def', label: '基础防御力', unit: 'flat' },
  { key: 'critRate', label: '初始暴击率', unit: 'percent' },
  { key: 'critDmg', label: '初始爆伤', unit: 'percent' },
  { key: 'mastery', label: '初始精通', unit: 'flat' },
  { key: 'anomalyControl', label: '初始异常掌控', unit: 'flat' },
  { key: 'energyRegen', label: '初始能量回复效率', unit: 'percent' },
  { key: 'penRate', label: '初始穿透率', unit: 'percent' },
  { key: 'dmgBonus', label: '初始伤害加成', unit: 'percent' },
  { key: 'pen', label: '初始穿透值', unit: 'flat' },
  { key: 'anomalyCritRate', label: '初始异常暴击', unit: 'percent' },
  { key: 'anomalyCritDmg', label: '初始异常爆伤', unit: 'percent' },
  { key: 'anomalyDmgBonus', label: '初始异常增伤', unit: 'percent' },
  { key: 'directDmgMult', label: '初始直伤倍率', unit: 'percent' },
  { key: 'anomalyMult', label: '初始异常倍率', unit: 'percent' },
  { key: 'disorderBaseMult', label: '初始紊乱基础倍率', unit: 'percent' },
  { key: 'anomalyDuration', label: '初始异常持续时间', unit: 'flat' },
  { key: 'disorderCompMult', label: '初始紊乱补偿倍率', unit: 'percent' },
  { key: 'turbulenceBaseMult', label: '初始乱流基础倍率', unit: 'percent' },
  { key: 'turbulenceCompMult', label: '初始乱流补偿倍率', unit: 'percent' },
  { key: 'disorderDmgBonus', label: '初始紊乱增伤', unit: 'percent' },
  { key: 'turbulenceDmgBonus', label: '初始乱流增伤', unit: 'percent' },
  { key: 'radianceMult', label: '初始耀变倍率', unit: 'percent' },
  { key: 'radianceDmgBonus', label: '初始耀变增伤', unit: 'percent' },
  { key: 'radianceResPen', label: '初始耀变抗性穿透', unit: 'percent' },
  { key: 'mutationCoeff', label: '初始异化系数', unit: 'percent' },
]

export const WENGINE_ADVANCED_STAT_FIELDS: {
  key: keyof WengineAdvancedStats
  label: string
  unit: 'flat' | 'percent'
}[] = [
  { key: 'critRate', label: '暴击', unit: 'percent' },
  { key: 'critDmg', label: '爆伤', unit: 'percent' },
  { key: 'anomalyControlPercent', label: '异常掌控', unit: 'percent' },
  { key: 'energyRegen', label: '能量恢复效率', unit: 'percent' },
  { key: 'mastery', label: '精通', unit: 'flat' },
  { key: 'externalAtkPercent', label: '局外攻击力', unit: 'percent' },
  { key: 'externalHpPercent', label: '局外生命力', unit: 'percent' },
  { key: 'externalDefPercent', label: '局外防御力', unit: 'percent' },
  { key: 'penRate', label: '穿透率', unit: 'percent' },
]

export function numericStatFieldLabel(label: string, unit: 'flat' | 'percent') {
  return unit === 'percent' ? `${label}%` : label
}

export function createEmptyAgentBasePanel(): AgentBasePanel {
  return {
    hp: 0,
    atk: 0,
    def: 0,
    critRate: 0,
    critDmg: 0,
    mastery: 0,
    anomalyControl: 0,
    energyRegen: 0,
    penRate: 0,
    dmgBonus: 0,
    pen: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    anomalyDmgBonus: 0,
    directDmgMult: 100,
    anomalyMult: 0,
    disorderBaseMult: 0,
    anomalyDuration: 0,
    disorderCompMult: 0,
    turbulenceBaseMult: 0,
    turbulenceCompMult: 0,
    disorderDmgBonus: 0,
    turbulenceDmgBonus: 0,
    radianceMult: 0,
    radianceDmgBonus: 0,
    radianceResPen: 0,
    mutationCoeff: 0,
  }
}

export function createEmptyWengineAdvancedStats(): WengineAdvancedStats {
  return {
    critRate: 0,
    critDmg: 0,
    anomalyControlPercent: 0,
    energyRegen: 0,
    mastery: 0,
    externalAtkPercent: 0,
    externalHpPercent: 0,
    externalDefPercent: 0,
    penRate: 0,
  }
}

/** 能量回复：旧乘数 1.2 迁为百分点 120 */
export function normalizeEnergyRegenPercent(value: number | undefined | null): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num === 0) return 0
  if (num > 0 && num <= 5 && !Number.isInteger(num)) return num * 100
  return num
}

export function normalizeAgentBasePanel(value: unknown): AgentBasePanel {
  const empty = createEmptyAgentBasePanel()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const entry = value as Record<string, unknown>
  const result = { ...empty }
  for (const field of AGENT_BASE_PANEL_FIELDS) {
    result[field.key] = readNumber(entry[field.key])
  }
  // 旧数据缺省直伤倍率时按 100%（×1）处理
  if (entry.directDmgMult == null) {
    result.directDmgMult = 100
  }
  result.energyRegen = normalizeEnergyRegenPercent(result.energyRegen)
  return result
}

export function normalizeWengineAdvancedStats(value: unknown): WengineAdvancedStats {
  const empty = createEmptyWengineAdvancedStats()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const entry = value as Record<string, unknown>
  const result = { ...empty }
  for (const field of WENGINE_ADVANCED_STAT_FIELDS) {
    result[field.key] = readNumber(entry[field.key])
  }
  result.energyRegen = normalizeEnergyRegenPercent(result.energyRegen)
  return result
}

export function roleShort(role: string) {
  const map: Record<string, string> = {
    强攻: '强',
    击破: '破',
    异常: '异',
    支援: '援',
    防护: '防',
    命破: '命',
  }
  return map[role] ?? role.slice(0, 1)
}

export function elementShort(element: string) {
  const map: Record<string, string> = {
    风: '风',
    火: '火',
    电: '电',
    物理: '物',
    以太: '以',
    冰: '冰',
  }
  return map[element] ?? element.slice(0, 1)
}
