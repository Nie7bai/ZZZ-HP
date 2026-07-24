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

export interface DefenseBuffInfo {
  name: string
  imageUrl?: string
  lines: string[]
}

export interface DefenseRoom {
  id: string
  label: string
  level: number
  rankRequirements?: { s: string; a: string; b: string }
  zoneBuffs: string[]
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
  rawHp: string
  aoeHp?: string
  altHp?: string
  totalHp?: number
  frontiers: DefenseFrontier[]
}
