import type { ExtraBuffGain } from '@/utils/extraBuffCalc'
import {
  adaptAffixLibraryEntry,
  type AllocatedAffix,
} from '@/utils/effectAdapters'
import {
  extraGainFromLibraryEntry,
  type AffixDeltaMap,
  type AffixEntryEvalInput,
  type AffixLibraryEntry,
  type AffixPanelDeltaField,
} from '@/utils/affixLibrary'
import { AFFIX_VALUE_PER_COUNT } from '@/utils/affixPanelCalc'
import type { AffixCounts } from '@/types/calculatorPanel'

/**
 * 词条库 → 评估输入（走适配器分桶）。
 *
 * 与 `entryRollsToEvalInput` 同构：局外 `panel:` 进 deltas、`gain:` extraGains。
 * 不从本文件 import `panelPipeline`（会环）。生产评估仍走旧 `computeFinalPanel`。
 */
export function entryRollsToEffectEvalInput(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): AffixEntryEvalInput {
  const counts: Partial<AffixCounts> = {}
  const deltas: AffixDeltaMap = {}
  const extraGains: ExtraBuffGain[] = []
  const valuePerCount: Record<keyof AffixCounts, number> = { ...AFFIX_VALUE_PER_COUNT }

  for (const entry of entries) {
    const rolls = rollsByEntryId[entry.id] ?? 0
    const allocated = adaptAffixLibraryEntry(entry, rolls)
    applyAllocatedAffix(allocated, entry, rolls, counts, deltas, extraGains)
  }

  return { counts, deltas, extraGains, valuePerCount }
}

function applyAllocatedAffix(
  allocated: AllocatedAffix | null,
  entry: AffixLibraryEntry,
  rolls: number,
  _counts: Partial<AffixCounts>,
  deltas: AffixDeltaMap,
  extraGains: ExtraBuffGain[],
): void {
  if (!allocated) return
  if (allocated.type === 'count') {
    deltas[allocated.statKey] =
      (deltas[allocated.statKey] ?? 0) + rolls * entry.perRoll
    return
  }
  if (allocated.instance.sourceFamily === 'affix-panel') {
    const field = allocated.instance.stat as AffixPanelDeltaField
    deltas[field] = (deltas[field] ?? 0) + allocated.instance.magnitude
    return
  }
  if (allocated.instance.sourceFamily === 'affix-gain') {
    const gain = extraGainFromLibraryEntry(entry, rolls)
    if (gain) extraGains.push(gain)
  }
}
