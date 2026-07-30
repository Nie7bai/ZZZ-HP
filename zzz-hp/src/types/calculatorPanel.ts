export interface PanelStats {
  hp: number
  atk: number
  def: number
  critRate: number
  critDmg: number
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
  pen: number
  critRate: number
  critDmg: number
  mastery: number
}

export type PanelCalcMode = 'panel' | 'affix' | 'optimal'

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

export function createDefaultExternalPanel(): PanelStats {
  return {
    hp: 9873,
    atk: 4008,
    def: 0,
    critRate: 48.2,
    critDmg: 186,
    dmgBonus: 10,
    ignoreDefense: 0,
    reduceDefense: 0,
    penRate: 0,
    pen: 90,
    resPen: 0,
    mastery: 0,
    anomalyControl: 0,
    energyRegen: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    anomalyDmgBonus: 0,
    anomalyReleaseCritRate: 0,
    anomalyReleaseCritDmg: 0,
    anomalyReleaseMult: 0,
    anomalyReleaseDmgBonus: 0,
    directDmgMult: 100,
    settlementDmgMult: 0,
    anomalyMult: 0,
    disorderBaseMult: 0,
    anomalyDuration: 0,
    disorderCompMult: 0,
    turbulenceBaseMult: 0,
    turbulenceCompMult: 0,
    disorderDmgBonus: 0,
    turbulenceDmgBonus: 0,
    directDmgMultFactor: 100,
    anomalyMultFactor: 100,
    anomalyReleaseMultFactor: 100,
    disorderBaseMultFactor: 100,
    turbulenceBaseMultFactor: 100,
    radianceMult: 0,
    radianceDmgBonus: 0,
    radianceResPen: 0,
    mutationCoeff: 0,
    radianceMultFactor: 100,
    mutationCoeffFactor: 100,
  }
}
