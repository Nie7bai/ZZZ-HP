export type DefenseVariant = 'old' | 'new'

export interface DefenseEnemy {
  id?: number
  name: string
  imageUrl?: string
  count?: number
  hp: string
  hpValue?: number
  defense?: number
  weakness?: string
  /** 失衡时间（秒） */
  staggerTime?: number | null
  resistance?: string
  isBoss?: boolean
}

export interface DefenseWave {
  label: string
  enemies: DefenseEnemy[]
}

export interface DefenseBattleRoom {
  id: string
  label: string
  waveCount: number
  weakness: string[]
  resistance?: string[]
  waves: DefenseWave[]
}

export interface DefenseZoneBuffRecord {
  recordId: number
  buffIndex: number
  buffText?: string
  buffName?: string
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface DefenseBuffInfo {
  name: string
  imageUrl?: string
  lines: string[]
  recordId?: number
  buffIndex?: number
  buffText?: string
  isEmpty?: boolean
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface DefenseRoom {
  id: string
  label: string
  level: number
  rankRequirements?: { s: string; a: string; b: string }
  /**
   * @deprecated 区域 Buff 已废弃；防卫战增益统一在 roomBuff（关卡增益）。
   * API 仍返回空数组以兼容旧客户端。
   */
  zoneBuffs: string[]
  /** @deprecated 见 zoneBuffs */
  zoneBuffRecords?: DefenseZoneBuffRecord[]
  roomBuff: DefenseBuffInfo
  battleRooms: DefenseBattleRoom[]
}

export interface DefenseFrontier {
  id: string
  title: string
  level: number
  rooms: DefenseRoom[]
}

export interface DefenseSeason {
  id: string
  version: string
  phase: string
  dateRange: string
  seasonId: string
  nodeType: string
  isHidden?: boolean
  /** 管理端软删除：已删除未清理 */
  pendingCleanup?: boolean
  deletedAt?: string | null
  rawHp: string
  aoeHp?: string
  altHp?: string
  totalHp?: number
  frontiers: DefenseFrontier[]
}
