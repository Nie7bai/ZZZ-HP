import type { EnemySlot, PhaseData } from '@/types/history'
import { formatHpExpansionPercent, parseHpString } from '@/utils/gameData'

/** 场地 Buff 快照：来自某一期的怪物槽位，附该期的展示用标签 */
export interface MonsterFieldBuffSnapshot {
  fieldBuff: EnemySlot['fieldBuff']
  phaseLabel: string
}

/** 在 phases 里定位同一怪物：同一 Boss 名可同期出现在多个房间，必须同时匹配房间码 */
export interface MonsterLookupKey {
  bossName: string
  room?: string
}

/** 该怪物在某一期的一次出现 */
export interface MonsterOccurrence {
  phaseIndex: number
  phaseLabel: string
  enemy: EnemySlot
}

export function buildPhaseLabel(phase: PhaseData): string {
  return `${phase.version} ${phase.phase}`.trim()
}

function matchesLookupKey(enemy: EnemySlot, key: MonsterLookupKey): boolean {
  return enemy.bossName === key.bossName && (enemy.room ?? '') === (key.room ?? '')
}

function hasFieldBuffContent(fieldBuff: EnemySlot['fieldBuff']): boolean {
  return Boolean(
    fieldBuff && (fieldBuff.name?.trim() || fieldBuff.text?.trim() || fieldBuff.effectBlocks?.length),
  )
}

/** 该怪物在各期的全部出现（按期顺序），供「原 / 现」两侧取数 */
export function findMonsterEntries(
  phases: PhaseData[],
  key: MonsterLookupKey,
): MonsterOccurrence[] {
  if (!key.bossName) return []
  const entries: MonsterOccurrence[] = []
  phases.forEach((phase, phaseIndex) => {
    for (const enemy of phase.enemies) {
      if (matchesLookupKey(enemy, key)) {
        entries.push({ phaseIndex, phaseLabel: buildPhaseLabel(phase), enemy })
      }
    }
  })
  return entries
}

/**
 * 该怪物（**只按名字**，跨房间）出现过的全部游戏版本，去重。
 * 「是否在某个版本（含）之前就已存在」是 Boss 级属性：同一只 Boss 会跨期换房间，
 * 按名字匹配才不会把换了房间的老 Boss 误判成新怪（见 dev-docs/monster-resistance-table.md）。
 */
export function listMonsterAppearanceVersions(phases: PhaseData[], bossName: string): string[] {
  if (!bossName) return []
  const versions = new Set<string>()
  for (const phase of phases) {
    if (!phase.enemies.some((enemy) => enemy.bossName === bossName)) continue
    if (phase.version) versions.add(phase.version)
  }
  return [...versions]
}

/**
 * 从当前期往前找该怪物最近一次出现，取其弱点 / 抗性与期数标签。
 * 只按 Boss 名 + 房间匹配（与场地 Buff 对比同口径）。
 */
export interface MonsterTraitSnapshot {
  phaseLabel: string
  weakness?: string
  resistance?: string
  resistanceHigh?: string
}

export function findPreviousMonsterTraits(
  phases: PhaseData[],
  currentPhaseIndex: number,
  key: MonsterLookupKey,
): MonsterTraitSnapshot | null {
  if (!key.bossName) return null
  for (let index = currentPhaseIndex - 1; index >= 0; index--) {
    const phase = phases[index]
    if (!phase) continue
    const enemy = phase.enemies.find((item) => matchesLookupKey(item, key))
    if (!enemy) continue
    // 不跳过空值：原来没有弱点/抗性、本期新增，也算一次变化
    return {
      phaseLabel: buildPhaseLabel(phase),
      weakness: enemy.weakness?.trim() ?? '',
      resistance: enemy.resistance?.trim() ?? '',
      resistanceHigh: enemy.resistanceHigh,
    }
  }
  return null
}

/** 弱点 / 抗性是否发生变化（仅比较有内容的一侧） */
export function isMonsterTraitsChanged(
  previous: MonsterTraitSnapshot | null | undefined,
  current: { weakness?: string; resistance?: string; resistanceHigh?: string } | null | undefined,
): boolean {
  if (!previous || !current) return false
  return (
    (previous.weakness ?? '') !== (current.weakness ?? '') ||
    (previous.resistance ?? '') !== (current.resistance ?? '') ||
    (previous.resistanceHigh ?? '') !== (current.resistanceHigh ?? '')
  )
}

/**
 * 从当前期往前找最近的、场地 Buff 非空的该怪物出现，取其场地 Buff 与期数标签。
 * 往前不存在带内容的场地 Buff 时返回 null。
 */
export function findPreviousFieldBuff(
  phases: PhaseData[],
  currentPhaseIndex: number,
  key: MonsterLookupKey,
): MonsterFieldBuffSnapshot | null {
  if (!key.bossName) return null
  for (let index = currentPhaseIndex - 1; index >= 0; index--) {
    const phase = phases[index]
    if (!phase) continue
    const enemy = phase.enemies.find((item) => matchesLookupKey(item, key))
    if (!enemy || !hasFieldBuffContent(enemy.fieldBuff)) continue
    return { fieldBuff: enemy.fieldBuff, phaseLabel: buildPhaseLabel(phase) }
  }
  return null
}

/**
 * 上一期的得分机制（同一 Boss + 房间，取最近一次有内容的那期）。
 * 与 `findPreviousFieldBuff` 同口径；返回 null 表示没有可比对的历史。
 */
export function findPreviousScoringNote(
  phases: PhaseData[],
  currentPhaseIndex: number,
  key: MonsterLookupKey,
): { note: string; phaseLabel: string } | null {
  if (!key.bossName) return null
  for (let index = currentPhaseIndex - 1; index >= 0; index--) {
    const phase = phases[index]
    if (!phase) continue
    const enemy = phase.enemies.find((item) => matchesLookupKey(item, key))
    const note = enemy?.scoringNote?.trim()
    if (!note) continue
    return { note, phaseLabel: buildPhaseLabel(phase) }
  }
  return null
}

/**
 * 是否构成一次真正的场地 Buff 转变：
 * 两侧都有内容且名称或正文不同。任一侧为空不算转变。
 */
export function isFieldBuffChanged(
  previous: EnemySlot['fieldBuff'],
  current: EnemySlot['fieldBuff'],
): boolean {
  if (!hasFieldBuffContent(previous) || !hasFieldBuffContent(current)) return false
  return (
    (previous?.name ?? '') !== (current?.name ?? '') ||
    (previous?.text ?? '') !== (current?.text ?? '')
  )
}

/** 单个怪物的血量与最近一次往期出现的对比结果 */
export interface BossHpComparison {
  diff: number
  /** 相对膨胀标签（如 +23%）；往期血量为 0 时为 null */
  expansion: string | null
}

/** 单个怪物的危局血量系数与最近一次往期出现的对比结果 */
export interface BossHpCoeffComparison {
  diff: number
  /** 带符号的百分点差值标签（如 +1.5%） */
  deltaLabel: string
}

/**
 * 从当前期往前找该 Boss 名最近的往期出现（仅按 Boss 名匹配，不区分房间），对比血量。
 * 无 Boss 名、当前血量不可解析、无往期出现或数值完全相同时返回 null。
 */
export function getBossHpComparison(
  phases: PhaseData[],
  currentPhaseIndex: number,
  bossName: string | undefined,
  hpValue: number | undefined,
  hpText: string,
): BossHpComparison | null {
  if (!bossName) return null

  const currentHp = hpValue ?? parseHpString(hpText)
  if (currentHp == null) return null

  for (let index = currentPhaseIndex - 1; index >= 0; index--) {
    const phase = phases[index]
    if (!phase) continue

    for (const enemy of phase.enemies) {
      if (enemy.bossName !== bossName) continue

      const previousHp = enemy.hpValue ?? parseHpString(enemy.hp)
      if (previousHp == null) continue

      const diff = currentHp - previousHp
      if (diff === 0) return null

      return {
        diff,
        expansion: formatHpExpansionPercent(currentHp, previousHp),
      }
    }
  }

  return null
}

/**
 * 从当前期往前找该 Boss 名最近的往期出现（仅按 Boss 名匹配，不区分房间），对比危局血量系数。
 * 无 Boss 名、当前系数无效、无往期出现或差值小于 1e-6 时返回 null。
 */
export function getBossHpCoeffComparison(
  phases: PhaseData[],
  currentPhaseIndex: number,
  bossName: string | undefined,
  currentCoeff: number | null | undefined,
): BossHpCoeffComparison | null {
  if (!bossName) return null
  if (currentCoeff == null || !Number.isFinite(currentCoeff)) return null

  for (let index = currentPhaseIndex - 1; index >= 0; index--) {
    const phase = phases[index]
    if (!phase) continue

    for (const enemy of phase.enemies) {
      if (enemy.bossName !== bossName) continue
      const previousCoeff = enemy.hpCoeffPercent
      if (previousCoeff == null || !Number.isFinite(previousCoeff)) continue

      const diff = currentCoeff - previousCoeff
      if (Math.abs(diff) < 1e-6) return null

      const signed = diff >= 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`
      return {
        diff,
        deltaLabel: signed,
      }
    }
  }

  return null
}
