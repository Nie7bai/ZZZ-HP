import type {
  DriveDiscSlot4StatId,
  DriveDiscSlot5StatId,
  DriveDiscSlot6StatId,
} from '@/types/calculatorPanel'

export const AFFIX_DRIVE_DISC_SLOT_1_HP = 2200
export const AFFIX_DRIVE_DISC_SLOT_2_ATK = 316

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
  critRate: number
  critDmg: number
  dmgBonus: number
  penRate: number
  mastery: number
}

export function createEmptyAffixDriveDiscMainStatContribution(): AffixDriveDiscMainStatContribution {
  return {
    externalHpPercent: 0,
    externalAtkPercent: 0,
    critRate: 0,
    critDmg: 0,
    dmgBonus: 0,
    penRate: 0,
    mastery: 0,
  }
}

function findSlotOption<T extends { id: string; value: number }>(
  options: readonly T[],
  id: string,
) {
  return options.find((item) => item.id === id)
}

export function collectAffixDriveDiscMainStatContribution(input: {
  slot4MainStat: DriveDiscSlot4StatId
  slot5MainStat: DriveDiscSlot5StatId
  slot6MainStat: DriveDiscSlot6StatId
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
      default:
        break
    }
  }

  return result
}
