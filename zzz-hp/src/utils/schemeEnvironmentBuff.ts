/**
 * 方案的环境 Buff 勾选快照与重建。
 *
 * 环境 Buff 的实例 id 是 `{sourceKey}::{blockId}::{effectId}`，其中 sourceKey 带数据库行 id
 * （`crisis-buff-{rowId}` / `defense-buff-{rowId}` / `deduction-buff-{rowId}`），块与效果 id 由管理端
 * 保存时生成。云端重新 seed 或换期后这些 id 都可能变，所以方案除了存 id，还存一份
 * 「卡片名 + 效果数值」的签名：加载时先按 id 精确命中，命中不到再按名称 + 数值重建。
 */
import type { BuffEffect } from '@/types/calculator'
import type { EnvironmentBuffEntry, EnvironmentBuffKind } from '@/utils/environmentBuffCalc'
import { effectInstanceId } from '@/utils/buffEffect'
import {
  createEmptyBuffSelectionState,
  isEnvironmentBuffSourceKey,
  type BuffSelectionState,
  type MultiSlotBuffSelection,
} from '@/utils/panelBuffCalc'

export interface SchemeEnvironmentBuffEffect {
  /** 实例 id：`{sourceKey}::{blockId}::{effectId}` */
  id: string
  stat: string
  value: number | null
  blockName: string
}

export interface SchemeEnvironmentBuffCheck {
  sourceKey: string
  /** 卡片名（危局 buff 名 / 场地 Buff / 第x间…），id 失效时按它找回 */
  name: string
  kind: EnvironmentBuffKind
  effects: SchemeEnvironmentBuffEffect[]
}

/** 全队与各槽位的环境 Buff 勾选（与 `MultiSlotBuffSelection` 同级分组） */
export interface SchemeEnvironmentBuffChecks {
  team: SchemeEnvironmentBuffCheck[]
  bySlot: Record<string, SchemeEnvironmentBuffCheck[]>
}

export interface SchemeEnvironmentBuffApplyResult {
  /** 按实例 id 精确恢复的效果数 */
  applied: number
  /** 按名称 + 数值重建的效果数 */
  remapped: number
  /** 找不到落点的效果数 */
  missing: number
  /** 命中的卡片数 */
  cards: number
  /** 找不到卡片的数量 */
  missingCards: number
}

interface CatalogEffect {
  id: string
  stat: string
  value: number | null
  blockName: string
}

interface CatalogCard {
  sourceKey: string
  name: string
  kind: EnvironmentBuffKind
  effects: CatalogEffect[]
}

function emptyResult(): SchemeEnvironmentBuffApplyResult {
  return { applied: 0, remapped: 0, missing: 0, cards: 0, missingCards: 0 }
}

function effectValue(effect: BuffEffect): number | null {
  const value = Number(effect.value)
  return Number.isFinite(value) ? value : null
}

function catalogCards(catalog: readonly EnvironmentBuffEntry[]): CatalogCard[] {
  return catalog.map((env) => {
    const effects: CatalogEffect[] = []
    for (const block of env.effectBlocks ?? []) {
      // 与 `collectBlockEntriesFromPack` 的块 id 兜底保持一致
      const blockId = block.id || 'legacy'
      for (const effect of block.effects ?? []) {
        effects.push({
          id: effectInstanceId(env.sourceKey, blockId, effect.id),
          stat: String(effect.stat ?? ''),
          value: effectValue(effect),
          blockName: block.name?.trim() || '',
        })
      }
    }
    return { sourceKey: env.sourceKey, name: env.name, kind: env.kind, effects }
  })
}

function captureStore(
  store: BuffSelectionState | undefined,
  cards: Map<string, CatalogCard>,
): SchemeEnvironmentBuffCheck[] {
  const bySourceKey = new Map<string, SchemeEnvironmentBuffCheck>()
  for (const [id, enabled] of Object.entries(store?.enabledIds ?? {})) {
    if (!enabled) continue
    const sourceKey = id.split('::')[0] ?? ''
    if (!isEnvironmentBuffSourceKey(sourceKey)) continue
    const card = cards.get(sourceKey)
    if (!card) continue
    const effect = card.effects.find((item) => item.id === id)
    if (!effect) continue
    const record: SchemeEnvironmentBuffEffect = {
      id,
      stat: effect.stat,
      value: effect.value,
      blockName: effect.blockName,
    }
    const existing = bySourceKey.get(sourceKey)
    if (existing) existing.effects.push(record)
    else {
      bySourceKey.set(sourceKey, {
        sourceKey,
        name: card.name,
        kind: card.kind,
        effects: [record],
      })
    }
  }
  return [...bySourceKey.values()]
}

/** 从当前勾选 + 当前期目录抓快照；不在目录里的 id 不记录（无法命名，重建时也无从匹配） */
export function captureSchemeEnvironmentBuffChecks(
  selection: MultiSlotBuffSelection,
  catalog: readonly EnvironmentBuffEntry[],
): SchemeEnvironmentBuffChecks {
  const cards = new Map(catalogCards(catalog).map((card) => [card.sourceKey, card]))
  const bySlot: Record<string, SchemeEnvironmentBuffCheck[]> = {}
  for (const [slot, store] of Object.entries(selection.bySlot ?? {})) {
    const checks = captureStore(store, cards)
    if (checks.length) bySlot[slot] = checks
  }
  return { team: captureStore(selection.team, cards), bySlot }
}

function sameEffectShape(a: CatalogEffect | SchemeEnvironmentBuffEffect, b: CatalogEffect | SchemeEnvironmentBuffEffect) {
  if (a.stat !== b.stat || a.value !== b.value) return false
  if (!a.blockName || !b.blockName) return true
  return a.blockName === b.blockName
}

function scoreCard(check: SchemeEnvironmentBuffCheck, card: CatalogCard): number {
  let score = 0
  for (const effect of check.effects) {
    if (card.effects.some((item) => item.id === effect.id)) score += 2
    else if (card.effects.some((item) => sameEffectShape(item, effect))) score += 1
  }
  return score
}

interface ResolveContext {
  bySourceKey: Map<string, CatalogCard>
  byName: Map<string, string[]>
}

function resolveCard(check: SchemeEnvironmentBuffCheck, ctx: ResolveContext): CatalogCard | null {
  const exact = ctx.bySourceKey.get(check.sourceKey)
  if (exact) return exact
  const candidates = (ctx.byName.get(check.name) ?? [])
    .map((key) => ctx.bySourceKey.get(key))
    .filter((card): card is CatalogCard => card != null)
  const sameKind = candidates.filter((card) => card.kind === check.kind)
  let best: CatalogCard | null = null
  let bestScore = 0
  for (const card of sameKind.length ? sameKind : candidates) {
    const score = scoreCard(check, card)
    if (score > bestScore) {
      best = card
      bestScore = score
    }
  }
  return best
}

function applyStore(
  store: BuffSelectionState,
  checks: SchemeEnvironmentBuffCheck[] | undefined,
  ctx: ResolveContext,
): SchemeEnvironmentBuffApplyResult {
  const result = emptyResult()
  for (const check of checks ?? []) {
    const card = resolveCard(check, ctx)
    if (!card) {
      result.missingCards += 1
      result.missing += check.effects.length
      continue
    }
    result.cards += 1
    for (const record of check.effects) {
      let target = card.effects.find((item) => item.id === record.id)
      const remapped = !target
      if (!target) {
        // 块名会随房间 / 节点变（「第x间」「节点名」），所以先找同名块，再退回「同数值」的第一条
        const sameShape = card.effects.filter(
          (item) => item.stat === record.stat && item.value === record.value,
        )
        target =
          sameShape.find((item) => item.blockName && item.blockName === record.blockName) ??
          sameShape[0]
      }
      if (!target) {
        result.missing += 1
        continue
      }
      store.enabledIds[target.id] = true
      store.manualTouchedIds = { ...(store.manualTouchedIds ?? {}), [target.id]: true }
      if (remapped) result.remapped += 1
      else result.applied += 1
    }
  }
  return result
}

/**
 * 把方案里的环境勾选写回当前选择。
 * 调用前应先切好模式 / 期数，让 `catalog` 是目标期数的目录。
 */
export function applySchemeEnvironmentBuffChecks(
  selection: MultiSlotBuffSelection,
  checks: SchemeEnvironmentBuffChecks | null | undefined,
  catalog: readonly EnvironmentBuffEntry[],
): SchemeEnvironmentBuffApplyResult {
  const total = emptyResult()
  if (!checks) return total
  const cards = catalogCards(catalog)
  const ctx: ResolveContext = {
    bySourceKey: new Map(cards.map((card) => [card.sourceKey, card])),
    byName: new Map(),
  }
  for (const card of cards) {
    const list = ctx.byName.get(card.name) ?? []
    list.push(card.sourceKey)
    ctx.byName.set(card.name, list)
  }
  const merge = (part: SchemeEnvironmentBuffApplyResult) => {
    total.applied += part.applied
    total.remapped += part.remapped
    total.missing += part.missing
    total.cards += part.cards
    total.missingCards += part.missingCards
  }
  merge(applyStore(selection.team, checks.team, ctx))
  for (const [slot, list] of Object.entries(checks.bySlot ?? {})) {
    const index = Number(slot)
    if (!Number.isFinite(index)) continue
    if (!selection.bySlot[index]) selection.bySlot[index] = createEmptyBuffSelectionState()
    merge(applyStore(selection.bySlot[index], list, ctx))
  }
  return total
}
