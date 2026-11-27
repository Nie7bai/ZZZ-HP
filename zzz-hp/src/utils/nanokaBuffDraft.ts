import type { NanokaApplyRow, NanokaBuffKind, NanokaKeywordAnchors, NanokaKeywordConvert, NanokaKeywordSlots } from '@/api/nanokaBuffs'
import type { BuffEffect, BuffEffectBlock, BuffSkillTarget, SkillSubcategory } from '@/types/calculator'
import { formatSkillTargetBracket, normalizeBuffEffect } from '@/utils/buffEffect'

/** 关键字负责来源与解析，效果草稿沿用正式库的 BuffEffect / BuffEffectBlock。 */
export interface NanokaDraftKeyword {
  key: string
  itemSlot: string
  itemSlotLabel: string
  source: string
  containerIndex: number | null
  title: string
  rawText: string
  origin: string
  slots: NanokaKeywordSlots
  convert: NanokaKeywordConvert | null
  anchors: NanokaKeywordAnchors
  skillDesc: NanokaApplyRow['skillDesc']
  gain: BuffEffect | null
  recorded: boolean
  included: boolean
  blocked: boolean
  dirty: Record<string, boolean>
}

export type NanokaDraftSlots = Record<string, BuffEffectBlock[]>

export function replaceNanokaKeywordSkillTargets(
  row: NanokaDraftKeyword,
  targets: BuffSkillTarget[],
  subcategories: SkillSubcategory[],
  selectedTarget?: BuffSkillTarget,
) {
  const pendingCreates = (row.anchors.pendingCreates ?? []).filter(({ categoryId }) => {
    // 原先的空小类可能是自动建锚点的占位，手选整类才明确取消该类别的建锚点计划。
    if (selectedTarget?.category === categoryId && !selectedTarget.subcategoryId) return false
    return targets.some((target) => target.category === categoryId && !target.subcategoryId)
  })
  const resolved = targets.map((target) => {
    const pending = !target.subcategoryId && pendingCreates.find((item) => item.categoryId === target.category)
    return {
      ...target,
      subcategoryId: target.subcategoryId ?? null,
      name: pending ? pending.name : formatSkillTargetBracket(target, subcategories).slice(1, -1),
      level: target.subcategoryId ? 'subcategory' : 'category',
    }
  })
  const singleTarget = targets.length === 1 ? targets[0] : undefined
  row.anchors = {
    ok: true,
    labels: resolved.map(({ name }) => name),
    resolved,
    skillTargets: targets.map((target) => ({ ...target })),
    skillCategory: singleTarget?.category ?? '',
    skillSubcategoryId: singleTarget?.subcategoryId ?? null,
    pendingCreates,
    reason: '',
  }
  row.recorded = true
}

export function nanokaDraftSlot(kind: NanokaBuffKind, row: Pick<NanokaDraftKeyword, 'source' | 'containerIndex'>): string {
  return kind === 'wengine' && row.source === 'fixed' ? 'fixed' : String(row.containerIndex ?? 0)
}

export function createNanokaBuffDraft(kind: NanokaBuffKind, rows: NanokaDraftKeyword[]): NanokaDraftSlots {
  const slots: NanokaDraftSlots = {}
  for (const row of rows) {
    if (!row.recorded || row.blocked || !row.included || !row.gain) continue
    const blocks = (slots[nanokaDraftSlot(kind, row)] ??= [])
    const blockId = `nanoka-${row.itemSlot}`
    let block = blocks.find((item) => item.id === blockId)
    if (!block) {
      block = { id: blockId, name: row.title || row.itemSlotLabel, note: row.rawText, enabledDefault: true, effects: [] }
      blocks.push(block)
    }
    // origin 仅在草稿内关联关键字；派生/拆分效果会保留它，提交时换回来源说明。
    block.effects.push({ ...clone(row.gain), id: row.key, origin: row.key })
  }
  return slots
}

const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))

const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

/** 共享组件直接编辑嵌套字段，解析前按实际差异记录人工修改，删除后不自动复活。 */
export function rememberNanokaDraftEdits(slots: NanokaDraftSlots, rows: NanokaDraftKeyword[]) {
  const effects = Object.values(slots).flatMap((blocks) => blocks.flatMap((block) => block.effects))
  for (const row of rows) {
    const matches = effects.filter((effect) => effect.origin === row.key)
    if (!matches.length) {
      if (row.gain && row.recorded && !row.blocked) row.included = false
      continue
    }
    for (const effect of matches) {
      for (const field of new Set([...Object.keys(row.gain ?? {}), ...Object.keys(effect)])) {
        if (field === 'id' || field === 'origin') continue
        if (!same(row.gain?.[field as keyof BuffEffect], effect[field as keyof BuffEffect])) row.dirty[field] = true
      }
    }
    const representative = matches.find((effect) => effect.id === row.key) ?? matches[0]!
    row.gain = { ...clone(representative), id: row.key, origin: row.origin }
  }
}

/** 只更新解析拥有的字段；手动拆分、增删块、改名、备注和分组全部保留。 */
export function refreshNanokaBuffDraft(kind: NanokaBuffKind, slots: NanokaDraftSlots, rows: NanokaDraftKeyword[]) {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const represented = new Set<string>()
  for (const blocks of Object.values(slots)) {
    for (const block of blocks) {
      block.effects = block.effects.map((effect) => {
        const row = byKey.get(effect.origin ?? '')
        if (!row?.gain) return effect
        represented.add(row.key)
        const next = { ...effect } as Record<string, unknown>
        for (const field of new Set([...Object.keys(effect), ...Object.keys(row.gain)])) {
          if (['id', 'origin', 'groupId'].includes(field) || row.dirty[field]) continue
          next[field] = clone(row.gain[field as keyof BuffEffect])
        }
        return normalizeBuffEffect(next) ?? effect
      })
    }
  }
  const additions = createNanokaBuffDraft(kind, rows.filter((row) => !represented.has(row.key)))
  for (const [slot, blocks] of Object.entries(additions)) {
    const existing = (slots[slot] ??= [])
    for (const block of blocks) {
      const target = existing.find((item) => item.id === block.id)
      if (target) target.effects.push(...block.effects)
      else existing.push(block)
    }
  }
}

export function nanokaDraftApplyRows(kind: NanokaBuffKind, slots: NanokaDraftSlots, rows: NanokaDraftKeyword[]): NanokaApplyRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return Object.entries(slots).flatMap(([slot, blocks]) => blocks.flatMap((block) => block.effects.flatMap((effect) => {
    const row = byKey.get(effect.origin ?? '')
    if (row?.blocked || row && !row.recorded) return []
    return [{
      key: effect.id,
      slot: row?.itemSlot ?? `manual-${slot}`,
      slotLabel: row?.itemSlotLabel ?? (slot === 'fixed' ? '基础效果' : kind === 'agent' ? `${slot} 影` : `精炼 ${Number(slot) + 1}`),
      source: slot === 'fixed' ? 'fixed' : row?.source ?? (kind === 'agent' ? 'talent' : 'refinement'),
      containerIndex: slot === 'fixed' ? null : Number(slot),
      rawText: row?.rawText ?? '',
      keywordSlots: row?.slots,
      convert: row?.convert ?? null,
      effect: { ...clone(effect), origin: row?.origin ?? '' },
      block: { id: block.id, name: block.name, note: block.note ?? '', enabledDefault: block.enabledDefault !== false },
      // 只为仍由解析负责的招式条件创建锚点，避免手改目标后被旧计划重新替换。
      anchors: row && !row.dirty.skillTargets ? row.anchors : null,
      skillDesc: row?.skillDesc,
    }]
  })))
}
