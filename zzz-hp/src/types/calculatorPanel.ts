export interface PanelStats {
  hp: number
  atk: number
  /** 防御力（展示用，不进当前伤害公式） */
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
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  /** 异放暴击%（与异常分开展示，计算时并入异常暴击） */
  anomalyReleaseCritRate: number
  /** 异放爆伤% */
  anomalyReleaseCritDmg: number
  /** 异放倍率% */
  anomalyReleaseMult: number
  /** 异放增伤% */
  anomalyReleaseDmgBonus: number
  /** 直伤倍率%，默认 100（即 ×1） */
  directDmgMult: number
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
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    anomalyDmgBonus: 0,
    anomalyReleaseCritRate: 0,
    anomalyReleaseCritDmg: 0,
    anomalyReleaseMult: 0,
    anomalyReleaseDmgBonus: 0,
    directDmgMult: 100,
    anomalyMult: 0,
    disorderBaseMult: 0,
    anomalyDuration: 0,
    disorderCompMult: 0,
    turbulenceBaseMult: 0,
    turbulenceCompMult: 0,
    disorderDmgBonus: 0,
    turbulenceDmgBonus: 0,
  }
}
