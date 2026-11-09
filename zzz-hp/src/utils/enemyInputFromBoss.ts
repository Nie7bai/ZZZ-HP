import {
  DEFAULT_ENEMY_STAGGER_MULTIPLIER,
  normalizeDamageEnemyInput,
  type DamageEnemyInput,
} from '@/utils/enemyResistance'
import { parseBossTraitToElementResistance } from '@/utils/enemyBossTextParse'

export type EnemyBossSource = 'manual' | 'boss_info' | 'boss_record'

export interface BossInfoLike {
  boss_name: string
  defense?: number | null
  level?: number | null
  weakness?: string | null
  resistance?: string | null
  /** 高抗性（40%）属性，为 resistance 的子集 */
  resistance_high?: string | null
  stagger_multiplier?: number | null
  boss_image?: string | null
}

export interface BossRecordLike extends BossInfoLike {
  id?: number
  version?: string
  phase?: string
  room?: string | null
}

export interface EnemyBossSelectionMeta {
  bossSource: EnemyBossSource
  bossName?: string
  bossRecordId?: number
  bossRecordLabel?: string
}

export type DamageEnemyInputWithBossMeta = DamageEnemyInput & EnemyBossSelectionMeta

/**
 * 失衡易伤取值：怪物库（boss_info）优先，期数行快照仅作兜底（2026-11-09 所有者口径）。
 * 基础库改值后，危局/防卫战期数记录与计算器重新应用都跟随怪物库。
 */
export function resolveBossStaggerMultiplier(
  primaryValue: number | null | undefined,
  secondaryValue: number | null | undefined,
  /** Boss 数据里都没有该字段时的回落值（默认 1.5）。同步敌方时应传「用户当前值」，别把用户设的 1.8 冲成 1.5 */
  fallback: number = DEFAULT_ENEMY_STAGGER_MULTIPLIER,
): number {
  const primary = Number(primaryValue)
  if (Number.isFinite(primary) && primary > 0) return primary
  const secondary = Number(secondaryValue)
  if (Number.isFinite(secondary) && secondary > 0) return secondary
  return fallback
}

export function mapBossInfoToDamageEnemyInput(
  info: BossInfoLike,
  current?: Partial<DamageEnemyInput>,
): DamageEnemyInputWithBossMeta {
  const base = normalizeDamageEnemyInput(current)
  return {
    ...base,
    defense: Number(info.defense) || base.defense,
    elementResistance: parseBossTraitToElementResistance(
      info.weakness,
      info.resistance,
      info.resistance_high,
    ),
    staggerMultiplier: resolveBossStaggerMultiplier(
      info.stagger_multiplier,
      undefined,
      base.staggerMultiplier,
    ),
    bossSource: 'boss_info',
    bossName: info.boss_name,
    bossRecordId: undefined,
    bossRecordLabel: undefined,
    bossImage: info.boss_image ?? null,
  }
}

export function mapBossRecordToDamageEnemyInput(
  record: BossRecordLike,
  info?: BossInfoLike | null,
  current?: Partial<DamageEnemyInput>,
): DamageEnemyInputWithBossMeta {
  const base = normalizeDamageEnemyInput(current)
  const weakness = record.weakness ?? info?.weakness ?? null
  const resistance = record.resistance ?? info?.resistance ?? null
  const resistanceHigh = record.resistance_high ?? info?.resistance_high ?? null
  const version = record.version?.trim()
  const phase = record.phase?.trim()
  const room = record.room?.trim()
  const labelParts = [
    version && phase ? `${version} 第${phase}期` : '',
    room ? `房间 ${room}` : '',
    record.boss_name,
  ].filter(Boolean)

  return {
    ...base,
    defense: Number(record.defense) || Number(info?.defense) || base.defense,
    elementResistance: parseBossTraitToElementResistance(weakness, resistance, resistanceHigh),
    staggerMultiplier: resolveBossStaggerMultiplier(
      // 怪物库优先，期数行快照仅兜底（2026-11-09）
      info?.stagger_multiplier,
      record.stagger_multiplier,
      base.staggerMultiplier,
    ),
    bossSource: 'boss_record',
    bossName: record.boss_name,
    bossRecordId: record.id,
    bossRecordLabel: labelParts.join(' · '),
    bossImage: record.boss_image ?? info?.boss_image ?? null,
  }
}
