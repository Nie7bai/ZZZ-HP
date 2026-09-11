export interface PanelStats {
  hp: number
  atk: number
  def: number
  critRate: number
  critDmg: number
  /** 锐爆伤害加成%（锋御局内展示；由 combatMods 写入 finalPanel） */
  sharpenCritDmgBonus: number
  dmgBonus: number
  ignoreDefense: number
  reduceDefense: number
  penRate: number
  pen: number
  resPen: number
  mastery: number
  /** 异常掌控（不进伤害乘区） */
  anomalyControl: number
  /** 能量回复效率（不进伤害乘区） */
  energyRegen: number
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  /** 异放暴击% */
  anomalyReleaseCritRate: number
  /** 异放爆伤% */
  anomalyReleaseCritDmg: number
  /** 异放倍率% */
  anomalyReleaseMult: number
  /** 异放增伤% */
  anomalyReleaseDmgBonus: number
  /** 直伤倍率%，默认 100（即 ×1） */
  directDmgMult: number
  /** 决算倍率%（仅来自增益，默认 0） */
  settlementDmgMult: number
  /** 异常倍率% */
  anomalyMult: number
  /** 紊乱基础倍率% */
  disorderBaseMult: number
  /** 异常持续时间（秒） */
  anomalyDuration: number
  /** 紊乱补偿倍率% */
  disorderCompMult: number
  /** 乱流基础倍率% */
  turbulenceBaseMult: number
  /** 乱流补偿倍率% */
  turbulenceCompMult: number
  /** 紊乱增伤% */
  disorderDmgBonus: number
  /** 乱流增伤% */
  turbulenceDmgBonus: number
  /** 耀变倍率% */
  radianceMult: number
  /** 耀变增伤% */
  radianceDmgBonus: number
  /** 耀变抗性穿透% */
  radianceResPen: number
  /** 特殊倍率% */
  specialMult: number
  /** 异化系数% */
  mutationCoeff: number
  /** 直伤倍率乘算修正（默认 1） */
  directDmgMultFactor: number
  /** 异常倍率乘算修正（默认 1） */
  anomalyMultFactor: number
  /** 异放倍率乘算修正（默认 1） */
  anomalyReleaseMultFactor: number
  /** 紊乱倍率乘算修正（默认 1） */
  disorderBaseMultFactor: number
  /** 乱流倍率乘算修正（默认 1） */
  turbulenceBaseMultFactor: number
  /** 耀变倍率乘算修正（默认 1） */
  radianceMultFactor: number
  /** 特殊倍率乘算修正（默认 1） */
  specialMultFactor: number
  /** 异化系数乘算修正（默认 1） */
  mutationCoeffFactor: number
}

export interface PanelStatDelta {
  hpFlat: number
  hpPercent: number
  atkFlat: number
  atkPercent: number
  critRate: number
  critDmg: number
  dmgBonus: number
  ignoreDefense: number
  reduceDefense: number
  penRate: number
  pen: number
  resPen: number
}

/** 词条数输入（副词条条数） */
export interface AffixCounts {
  hpFlat: number
  hpPercent: number
  atkFlat: number
  atkPercent: number
  defFlat: number
  defPercent: number
  pen: number
  critRate: number
  critDmg: number
  mastery: number
}

/** 页面计算方式：伤害计算（统一录入） / 最优词条分配 */
export type PanelCalcMode = 'damage' | 'optimal'

/**
 * 局外权威（脏标记）：最后编辑的一侧。
 * - `panel`：用手填/OCR 局外结算，词条为吸附结果
 * - `affix`：用词条实时推导局外结算
 */
export type ExternalPanelAuthority = 'panel' | 'affix'

/** @deprecated 旧方案 / 草稿里的计算方式；读入时归一到 PanelCalcMode + ExternalPanelAuthority */
export type LegacyPanelCalcMode = 'panel' | 'affix' | 'damage' | 'optimal'

export type DriveDiscSlot4StatId =
  | 'critDmg'
  | 'critRate'
  | 'externalAtkPercent'
  | 'externalHpPercent'
  | 'mastery'
  | 'externalDefPercent'

export type DriveDiscSlot5StatId =
  | 'externalAtkPercent'
  | 'externalHpPercent'
  | 'externalDefPercent'
  | 'penRate'
  | 'dmgBonus'

export type DriveDiscSlot6StatId =
  | 'externalAtkPercent'
  | 'externalHpPercent'
  | 'externalDefPercent'
  | 'anomalyControl'
  | 'impact'
  | 'energyRegen'

export interface AffixDriveDiscMainStats {
  slot4MainStat: DriveDiscSlot4StatId
  slot5MainStat: DriveDiscSlot5StatId
  slot6MainStat: DriveDiscSlot6StatId
}

export function createDefaultAffixDriveDiscMainStats(): AffixDriveDiscMainStats {
  return {
    slot4MainStat: 'critDmg',
    slot5MainStat: 'externalAtkPercent',
    slot6MainStat: 'externalHpPercent',
  }
}

export function createEmptyAffixCounts(): AffixCounts {
  return {
    hpFlat: 0,
    hpPercent: 0,
    atkFlat: 0,
    atkPercent: 0,
    defFlat: 0,
    defPercent: 0,
    pen: 0,
    critRate: 0,
    critDmg: 0,
    mastery: 0,
  }
}

export function createEmptyPanelStatDelta(): PanelStatDelta {
  return {
    hpFlat: 0,
    hpPercent: 0,
    atkFlat: 0,
    atkPercent: 0,
    critRate: 0,
    critDmg: 0,
    dmgBonus: 0,
    ignoreDefense: 0,
    reduceDefense: 0,
    penRate: 0,
    pen: 0,
    resPen: 0,
  }
}


/** 方案不持久化的乘区入口；缺字段时必须补成数字，否则 `undefined + convert` 会变成 NaN。 */
export const SCHEME_EXCLUDED_PANEL_DEFAULTS: Pick<
  PanelStats,
  'mutationCoeff' | 'mutationCoeffFactor'
> = {
  mutationCoeff: 0,
  mutationCoeffFactor: 100,
}

/**
 * 默认局外面板的模板。
 *
 * 原先 `createDefaultExternalPanel()` 每次调用都重新写一遍这 44 个字段的字面量。
 * 它在热路径上（词条求解每评估一次要补面板默认值数千次），实测剖析里
 * `fillPanelStatsDefaults` 自身占 9.8% CPU。模板不可变（全是数字），
 * 复用后仍每次返回新对象，调用方随便改都不会串。
 */
const DEFAULT_EXTERNAL_PANEL: PanelStats = {
  hp: 9873, atk: 4008, def: 0, critRate: 48.2, critDmg: 186, sharpenCritDmgBonus: 0, dmgBonus: 10,
  ignoreDefense: 0, reduceDefense: 0, penRate: 0, pen: 90, resPen: 0, mastery: 0,
  anomalyControl: 0, energyRegen: 0, anomalyCritRate: 0, anomalyCritDmg: 0,
  anomalyDmgBonus: 0, anomalyReleaseCritRate: 0, anomalyReleaseCritDmg: 0,
  anomalyReleaseMult: 0, anomalyReleaseDmgBonus: 0, directDmgMult: 100,
  settlementDmgMult: 0, anomalyMult: 0, disorderBaseMult: 0, anomalyDuration: 0,
  disorderCompMult: 0, turbulenceBaseMult: 0, turbulenceCompMult: 0,
  disorderDmgBonus: 0, turbulenceDmgBonus: 0, directDmgMultFactor: 100,
  anomalyMultFactor: 100, anomalyReleaseMultFactor: 100, disorderBaseMultFactor: 100,
  turbulenceBaseMultFactor: 100, radianceMult: 0, radianceDmgBonus: 0,
  radianceResPen: 0, specialMult: 100, mutationCoeff: 0, radianceMultFactor: 100,
  specialMultFactor: 100, mutationCoeffFactor: 100,
}

export function createDefaultExternalPanel(): PanelStats {
  return { ...DEFAULT_EXTERNAL_PANEL }
}

/** 读盘 / 队友槽面板可能缺键；用默认值补齐后再进乘区。 */
export function fillPanelStatsDefaults(panel?: Partial<PanelStats> | null): PanelStats {
  return { ...DEFAULT_EXTERNAL_PANEL, ...(panel ?? {}) }
}

/** 方案快照里把内部乘区入口重置为默认，而不是 delete（delete 会让后续加法得到 NaN）。 */
export function resetSchemeExcludedPanelFields<T extends Partial<PanelStats>>(panel: T): T {
  return { ...panel, ...SCHEME_EXCLUDED_PANEL_DEFAULTS }
}

/** 未录入时用的占位毕业面板（攻击 4008 等），不是角色自己的局外面板 */
export function isPlaceholderExternalPanel(
  panel: Pick<PanelStats, 'hp' | 'atk' | 'critRate' | 'critDmg'>,
): boolean {
  return panel.atk === 4008 && panel.hp === 9873 && panel.critRate === 48.2 && panel.critDmg === 186
}

type AgentBaseLike = {
  hp: number
  atk: number
  def: number
  critRate: number
  critDmg: number
  dmgBonus: number
  penRate: number
  pen: number
  mastery?: number
  anomalyControl: number
  energyRegen: number
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  directDmgMult: number
  anomalyMult: number
  disorderBaseMult: number
  anomalyDuration: number
  disorderCompMult: number
  turbulenceBaseMult: number
  turbulenceCompMult: number
  disorderDmgBonus: number
  turbulenceDmgBonus: number
  radianceMult: number
  radianceDmgBonus: number
  radianceResPen: number
  specialMult?: number
  mutationCoeff: number
}

export function applyAgentBaseToPanelStats(target: PanelStats, base: AgentBaseLike) {
  target.hp = base.hp
  target.atk = base.atk
  target.def = base.def
  target.critRate = base.critRate
  target.critDmg = base.critDmg
  target.dmgBonus = base.dmgBonus
  target.penRate = base.penRate
  target.pen = base.pen
  target.directDmgMult = base.directDmgMult
  target.anomalyMult = base.anomalyMult
  target.anomalyCritRate = base.anomalyCritRate
  target.anomalyCritDmg = base.anomalyCritDmg
  target.anomalyDmgBonus = base.anomalyDmgBonus
  target.anomalyControl = base.anomalyControl
  target.energyRegen = base.energyRegen
  target.disorderBaseMult = base.disorderBaseMult
  target.anomalyDuration = base.anomalyDuration
  target.disorderCompMult = base.disorderCompMult
  target.turbulenceBaseMult = base.turbulenceBaseMult
  target.turbulenceCompMult = base.turbulenceCompMult
  target.disorderDmgBonus = base.disorderDmgBonus
  target.turbulenceDmgBonus = base.turbulenceDmgBonus
  target.radianceMult = base.radianceMult
  target.radianceDmgBonus = base.radianceDmgBonus
  target.radianceResPen = base.radianceResPen
  target.specialMult = base.specialMult ?? 100
  // 异化系数的基数 1 只在 computeMutationZone（1 + %/100）里加。
  // 角色基础面板的 mutationCoeff 不能再写进局外，否则会变成 1.22 + 1 = 2.22。
  if (typeof base.mastery === 'number') target.mastery = base.mastery
}

export function createExternalPanelFromAgentBase(base?: AgentBaseLike | null): PanelStats {
  const panel = createDefaultExternalPanel()
  if (base) applyAgentBaseToPanelStats(panel, base)
  return panel
}
