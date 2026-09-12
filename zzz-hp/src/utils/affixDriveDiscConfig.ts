import type {
  DriveDiscSlot4StatId,
  DriveDiscSlot5StatId,
  DriveDiscSlot6StatId,
} from '@/types/calculatorPanel'

export const AFFIX_DRIVE_DISC_SLOT_1_HP = 2200
export const AFFIX_DRIVE_DISC_SLOT_2_ATK = 316
/** S 级满级 3 号位固定防御力 */
export const AFFIX_DRIVE_DISC_SLOT_3_DEF = 184

export const DRIVE_DISC_SLOT_4_OPTIONS: {
  id: DriveDiscSlot4StatId
  label: string
  value: number
}[] = [
  { id: 'critDmg', label: '爆伤 48%', value: 48 },
  { id: 'critRate', label: '暴击 24%', value: 24 },
  { id: 'externalAtkPercent', label: '局外攻击力 30%', value: 30 },
  { id: 'externalHpPercent', label: '局外生命值 30%', value: 30 },
  { id: 'mastery', label: '精通 92', value: 92 },
  { id: 'externalDefPercent', label: '局外防御力 48%', value: 48 },
]

export const DRIVE_DISC_SLOT_5_OPTIONS: {
  id: DriveDiscSlot5StatId
  label: string
  value: number
}[] = [
  { id: 'externalAtkPercent', label: '局外攻击力 30%', value: 30 },
  { id: 'externalHpPercent', label: '局外生命值 30%', value: 30 },
  { id: 'externalDefPercent', label: '局外防御力 48%', value: 48 },
  { id: 'penRate', label: '穿透率 24%', value: 24 },
  { id: 'dmgBonus', label: '增伤 30%', value: 30 },
]

export const DRIVE_DISC_SLOT_6_OPTIONS: {
  id: DriveDiscSlot6StatId
  label: string
  value: number
}[] = [
  { id: 'externalAtkPercent', label: '局外攻击力 30%', value: 30 },
  { id: 'externalHpPercent', label: '局外生命值 30%', value: 30 },
  { id: 'externalDefPercent', label: '局外防御力 48%', value: 48 },
  { id: 'anomalyControl', label: '异常掌控 30%', value: 30 },
  { id: 'impact', label: '冲击力 18%', value: 18 },
  { id: 'energyRegen', label: '能量恢复 60%', value: 60 },
]

export interface AffixDriveDiscMainStatContribution {
  externalHpPercent: number
  externalAtkPercent: number
  externalDefPercent: number
  critRate: number
  critDmg: number
  dmgBonus: number
  penRate: number
  mastery: number
  anomalyControl: number
  energyRegen: number
  /**
   * 冲击力 18%（6 号位）。
   *
   * 口径（用户 2026-09-12：**没填的一律按 0**）：与同组的异常掌控 / 能量恢复一样
   * **按点数加**。不是「基础冲击力 × 18%」—— 角色基础冲击力没有入库，那样算不出来。
   */
  impact: number
}

export function createEmptyAffixDriveDiscMainStatContribution(): AffixDriveDiscMainStatContribution {
  return {
    externalHpPercent: 0,
    externalAtkPercent: 0,
    externalDefPercent: 0,
    critRate: 0,
    critDmg: 0,
    dmgBonus: 0,
    penRate: 0,
    mastery: 0,
    anomalyControl: 0,
    energyRegen: 0,
    impact: 0,
  }
}

function findSlotOption<T extends { id: string; value: number }>(
  options: readonly T[],
  id: string,
) {
  return options.find((item) => item.id === id)
}

export function collectAffixDriveDiscMainStatContribution(input: {
  slot4MainStat: DriveDiscSlot4StatId | ''
  slot5MainStat: DriveDiscSlot5StatId | ''
  slot6MainStat: DriveDiscSlot6StatId | ''
}): AffixDriveDiscMainStatContribution {
  const result = createEmptyAffixDriveDiscMainStatContribution()

  const slot4 = findSlotOption(DRIVE_DISC_SLOT_4_OPTIONS, input.slot4MainStat)
  const slot5 = findSlotOption(DRIVE_DISC_SLOT_5_OPTIONS, input.slot5MainStat)
  const slot6 = findSlotOption(DRIVE_DISC_SLOT_6_OPTIONS, input.slot6MainStat)

  for (const option of [slot4, slot5, slot6]) {
    if (!option) continue
    switch (option.id) {
      case 'externalHpPercent':
        result.externalHpPercent += option.value
        break
      case 'externalAtkPercent':
        result.externalAtkPercent += option.value
        break
      case 'externalDefPercent':
        result.externalDefPercent += option.value
        break
      case 'critRate':
        result.critRate += option.value
        break
      case 'critDmg':
        result.critDmg += option.value
        break
      case 'dmgBonus':
        result.dmgBonus += option.value
        break
      case 'penRate':
        result.penRate += option.value
        break
      case 'mastery':
        result.mastery += option.value
        break
      case 'anomalyControl':
        result.anomalyControl += option.value
        break
      case 'impact':
        result.impact += option.value
        break
      case 'energyRegen':
        result.energyRegen += option.value
        break
      default:
        break
    }
  }

  return result
}
