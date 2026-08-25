import type { BuffEffectBlock } from '@/types/calculator'
import type { DefenseSeason } from '@/types/defense'
import type { DeductionPeriod } from '@/api/deduction'
import { isDeductionBattleNode } from '@/api/deduction'
import type { BuffInfo, EnemySlot, PhaseData } from '@/types/history'
import { normalizeBuffEffectBlocks } from '@/utils/buffEffect'
import { resolveAssetUrl } from '@/utils/gameData'

export type EnvironmentBuffMode = 'crisis' | 'defense' | 'deduction'
export type EnvironmentBuffKind =
  | 'crisis'
  | 'boss-field'
  | 'defense-room'
  | 'deduction-node'
  | 'deduction-field'

export interface EnvironmentBuffRoomBoss {
  name: string
  imageUrl?: string
  defense?: number
  level?: number
  weakness?: string
  resistance?: string
  recordId?: number
}

export interface EnvironmentBuffEntry {
  kind: EnvironmentBuffKind
  /** 稳定 sourceKey 后缀：crisis-buff-{id} / boss-field-{bossName} / defense-buff-{id} */
  id: string
  sourceKey: string
  name: string
  imageUrl?: string | null
  text?: string
  effectBlocks: BuffEffectBlock[]
  version?: string
  phase?: string
  /** Boss 场地 Buff 对应的 Boss 名 */
  bossName?: string
  /** 防卫战房间展示用 Boss 列表 */
  roomBosses?: EnvironmentBuffRoomBoss[]
  roomLabel?: string
  /** 防卫战：该防线内房间序号（1-based），展示用「第x间」 */
  roomIndex?: number
  /** 临界推演：所属战斗节点名 */
  nodeLabel?: string
}

export function environmentBuffSourceKey(kind: EnvironmentBuffKind, id: string): string {
  if (kind === 'crisis') return `crisis-buff-${id}`
  if (kind === 'boss-field') return `boss-field-${id}`
  if (kind === 'deduction-node') return `deduction-buff-${id}`
  if (kind === 'deduction-field') return `deduction-field-${id}`
  return `defense-buff-${id}`
}

export function isBossFieldSourceKey(sourceKey: string): boolean {
  return sourceKey.startsWith('boss-field-') || sourceKey.startsWith('deduction-field-')
}

export function parseBossFieldBossName(sourceKey: string): string | null {
  if (sourceKey.startsWith('boss-field-')) {
    return sourceKey.slice('boss-field-'.length) || null
  }
  if (sourceKey.startsWith('deduction-field-')) {
    const raw = sourceKey.slice('deduction-field-'.length)
    const sep = raw.lastIndexOf('::')
    return sep >= 0 ? raw.slice(sep + 2) || null : raw || null
  }
  return null
}

function hasStructuredBlocks(blocks: BuffEffectBlock[] | null | undefined): boolean {
  return normalizeBuffEffectBlocks(blocks ?? []).some((block) => block.effects?.length)
}

function fromCrisisBuff(buff: BuffInfo, version: string, phase: string): EnvironmentBuffEntry | null {
  if (buff.isEmpty || buff.recordId == null) return null
  const effectBlocks = normalizeBuffEffectBlocks(buff.effectBlocks ?? [])
  if (!hasStructuredBlocks(effectBlocks)) return null
  const id = String(buff.recordId)
  return {
    kind: 'crisis',
    id,
    sourceKey: environmentBuffSourceKey('crisis', id),
    name: buff.name,
    imageUrl: buff.imageUrl ?? null,
    text: buff.buffText ?? buff.lines.join('\n'),
    effectBlocks,
    version,
    phase,
  }
}

function fromBossField(enemy: EnemySlot, version: string, phase: string): EnvironmentBuffEntry | null {
  if (enemy.isEmpty || !enemy.bossName) return null
  const effectBlocks = normalizeBuffEffectBlocks(enemy.fieldBuff?.effectBlocks ?? [])
  if (!hasStructuredBlocks(effectBlocks)) return null
  const id = enemy.bossName
  const name = enemy.fieldBuff?.name?.trim() || '场地 Buff'
  return {
    kind: 'boss-field',
    id,
    sourceKey: environmentBuffSourceKey('boss-field', id),
    name,
    imageUrl: enemy.fieldBuff?.imageUrl ?? enemy.imageUrl ?? null,
    text: enemy.fieldBuff?.text ?? '',
    effectBlocks,
    version,
    phase,
    bossName: enemy.bossName,
  }
}

export function listCrisisEnvironmentBuffs(phase: PhaseData): EnvironmentBuffEntry[] {
  const phaseNum = phase.phase.replace(/\D/g, '') || phase.phase
  const crisis = phase.buffs
    .map((buff) => fromCrisisBuff(buff, phase.version, phaseNum))
    .filter((item): item is EnvironmentBuffEntry => item != null)
  const bossFields = phase.enemies
    .map((enemy) => fromBossField(enemy, phase.version, phaseNum))
    .filter((item): item is EnvironmentBuffEntry => item != null)
  return [...crisis, ...bossFields]
}

function collectDefenseRoomBosses(
  room: DefenseSeason['frontiers'][number]['rooms'][number],
): EnvironmentBuffRoomBoss[] {
  const bosses: EnvironmentBuffRoomBoss[] = []
  const seen = new Set<string>()
  for (const battle of room.battleRooms) {
    for (const wave of battle.waves) {
      for (const enemy of wave.enemies) {
        if (!enemy.isBoss || !enemy.name || seen.has(enemy.name)) continue
        seen.add(enemy.name)
        bosses.push({
          name: enemy.name,
          imageUrl: enemy.imageUrl,
          defense: enemy.defense,
          weakness: enemy.weakness,
          resistance: enemy.resistance,
          recordId: enemy.id,
        })
      }
    }
  }
  return bosses
}

export function listDefenseEnvironmentBuffs(
  season: DefenseSeason,
  options?: { frontierId?: string; roomId?: string },
): EnvironmentBuffEntry[] {
  const phaseNum = season.phase.replace(/\D/g, '') || season.phase
  const entries: EnvironmentBuffEntry[] = []

  for (const frontier of season.frontiers) {
    if (options?.frontierId && frontier.id !== options.frontierId) continue
    frontier.rooms.forEach((room, roomOffset) => {
      if (options?.roomId && room.id !== options.roomId) return
      const roomIndex = roomOffset + 1
      const roomBosses = collectDefenseRoomBosses(room)
      const roomLabel = `${frontier.title || frontier.id} · ${room.label || room.id}`

      const candidates: Array<{
        recordId?: number
        name: string
        imageUrl?: string
        text?: string
        lines?: string[]
        effectBlocks?: BuffEffectBlock[] | null
      }> = []

      if (room.roomBuff?.name && !room.roomBuff.isEmpty) {
        let effectBlocks = room.roomBuff.effectBlocks
        if (
          !effectBlocks?.length &&
          room.roomBuff.recordId != null &&
          room.zoneBuffRecords?.length
        ) {
          const zoneMatch = room.zoneBuffRecords.find(
            (zone) => zone.recordId === room.roomBuff.recordId && zone.effectBlocks?.length,
          )
          if (zoneMatch) effectBlocks = zoneMatch.effectBlocks
        }
        candidates.push({
          recordId: room.roomBuff.recordId,
          name: room.roomBuff.name,
          imageUrl: room.roomBuff.imageUrl,
          text: room.roomBuff.buffText,
          lines: room.roomBuff.lines,
          effectBlocks,
        })
      }
      for (const zone of room.zoneBuffRecords ?? []) {
        if (!zone.buffName && !zone.buffText) continue
        candidates.push({
          recordId: zone.recordId,
          name: zone.buffName || `区域 Buff ${zone.buffIndex}`,
          text: zone.buffText,
          effectBlocks: zone.effectBlocks,
        })
      }

      for (const buff of candidates) {
        if (buff.recordId == null) continue
        const effectBlocks = normalizeBuffEffectBlocks(buff.effectBlocks ?? [])
        if (!hasStructuredBlocks(effectBlocks)) continue
        const id = String(buff.recordId)
        entries.push({
          kind: 'defense-room',
          id,
          sourceKey: environmentBuffSourceKey('defense-room', id),
          name: buff.name,
          imageUrl: buff.imageUrl ? resolveAssetUrl(buff.imageUrl) : null,
          text: buff.text ?? buff.lines?.join('\n') ?? '',
          effectBlocks,
          version: season.version,
          phase: phaseNum,
          roomBosses,
          roomLabel,
          roomIndex,
        })
      }
    })
  }

  return entries
}

function fromDeductionNodeBuff(
  buff: DeductionPeriod['nodes'][number]['buffs'][number],
  version: string,
  phase: string,
  nodeId: string,
  nodeLabel: string,
  index: number,
): EnvironmentBuffEntry | null {
  const effectBlocks = normalizeBuffEffectBlocks(buff.effect_blocks ?? [])
  if (!hasStructuredBlocks(effectBlocks)) return null
  const id = `${version}-${nodeId}-${index}`
  const imageUrl = buff.buff_image ? resolveAssetUrl(buff.buff_image) : null
  return {
    kind: 'deduction-node',
    id,
    sourceKey: environmentBuffSourceKey('deduction-node', id),
    name: buff.title,
    imageUrl,
    text: buff.desc ?? '',
    effectBlocks,
    version,
    phase,
    nodeLabel,
  }
}

function fromDeductionFieldBuff(
  layer: DeductionPeriod['nodes'][number]['layers'][number],
  version: string,
  phase: string,
  nodeId: string,
): EnvironmentBuffEntry | null {
  const fieldBuff = layer.fieldBuff
  if (!fieldBuff) return null
  const effectBlocks = normalizeBuffEffectBlocks(fieldBuff.effectBlocks ?? [])
  if (!hasStructuredBlocks(effectBlocks)) return null
  const bossName = layer.monsters?.[0]?.name || layer.name
  const id = `${version}::${nodeId}::${layer.name}::${bossName}`
  const bossMonster = layer.monsters?.[0]
  const imageUrl = fieldBuff.image
    ? resolveAssetUrl(fieldBuff.image)
    : bossMonster?.boss_image
      ? resolveAssetUrl(bossMonster.boss_image)
      : null
  return {
    kind: 'deduction-field',
    id,
    sourceKey: environmentBuffSourceKey('deduction-field', id),
    name: fieldBuff.name?.trim() || '场地 Buff',
    imageUrl,
    text: fieldBuff.text ?? '',
    effectBlocks,
    version,
    phase,
    bossName,
  }
}

/** 临界推演：当期战斗节点的节点 Buff + Boss 层场地 Buff（仅含已录入 effect_blocks 的项） */
export function listDeductionEnvironmentBuffs(
  period: DeductionPeriod,
  options?: { nodeId?: string },
): EnvironmentBuffEntry[] {
  const phaseNum = period.phase.replace(/\D/g, '') || period.phase
  const version = period.periodId
  const nodeBuffs: EnvironmentBuffEntry[] = []
  const fieldBuffs: EnvironmentBuffEntry[] = []

  for (const node of period.nodes) {
    if (!isDeductionBattleNode(node.type)) continue
    if (options?.nodeId && node.nodeId !== options.nodeId) continue
    node.buffs.forEach((buff, index) => {
      const entry = fromDeductionNodeBuff(
        buff,
        version,
        phaseNum,
        node.nodeId,
        node.name,
        index,
      )
      if (entry) nodeBuffs.push(entry)
    })
    for (const layer of node.layers) {
      const entry = fromDeductionFieldBuff(layer, version, phaseNum, node.nodeId)
      if (entry) fieldBuffs.push(entry)
    }
  }

  return [...nodeBuffs, ...fieldBuffs]
}

/** 局内筛选：临界推演战斗节点列表 */
export function listDeductionEnvNodeFilterOptions(
  period: DeductionPeriod | null | undefined,
): { id: string; label: string }[] {
  if (!period?.nodes.length) return []
  return period.nodes
    .filter((node) => isDeductionBattleNode(node.type))
    .map((node) => ({
      id: node.nodeId,
      label: `${node.name}（${node.nodeId}）`,
    }))
}

/** 局内筛选：按防线列出选项（选中后展示该防线全部房间 Buff） */
export function listDefenseEnvFrontierFilterOptions(
  season: DefenseSeason | null | undefined,
): { id: string; label: string }[] {
  if (!season?.frontiers.length) return []
  return season.frontiers.map((frontier) => ({
    id: frontier.id,
    label: frontier.title?.trim() || frontier.id,
  }))
}

export function listCrisisPhaseOptions(phases: PhaseData[]): { version: string; phase: string; id: string; label: string }[] {
  return phases.map((phase) => {
    const phaseNum = phase.phase.replace(/\D/g, '') || phase.phase
    return {
      version: phase.version,
      phase: phaseNum,
      id: phase.id,
      label: `${phase.version} 第${phaseNum}期`,
    }
  })
}

export function listDefenseSeasonOptions(
  seasons: DefenseSeason[],
): { version: string; phase: string; id: string; label: string }[] {
  return seasons.map((season) => {
    const phaseNum = season.phase.replace(/\D/g, '') || season.phase
    return {
      version: season.version,
      phase: phaseNum,
      id: season.seasonId,
      label: `${season.version} 第${phaseNum}期`,
    }
  })
}
