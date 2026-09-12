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

export function resolveBossStaggerMultiplier(
  recordValue: number | null | undefined,
  infoValue: number | null | undefined,
): number {
  const record = Number(recordValue)
  if (Number.isFinite(record) && record > 0) return record
  const info = Number(infoValue)
  if (Number.isFinite(info) && info > 0) return info
  return DEFAULT_ENEMY_STAGGER_MULTIPLIER
}

export function mapBossInfoToDamageEnemyInput(
  info: BossInfoLike,
  current?: Partial<DamageEnemyInput>,
): DamageEnemyInputWithBossMeta {
  const base = normalizeDamageEnemyInput(current)
  return {
    ...base,
    defense: Number(info.defense) || base.defense,
    elementResistance: parseBossTraitToElementResistance(info.weakness, info.resistance),
    staggerMultiplier: resolveBossStaggerMultiplier(undefined, info.stagger_multiplier),
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
    elementResistance: parseBossTraitToElementResistance(weakness, resistance),
    staggerMultiplier: resolveBossStaggerMultiplier(
      record.stagger_multiplier,
      info?.stagger_multiplier,
    ),
    bossSource: 'boss_record',
    bossName: record.boss_name,
    bossRecordId: record.id,
    bossRecordLabel: labelParts.join(' · '),
    bossImage: record.boss_image ?? info?.boss_image ?? null,
  }
}
