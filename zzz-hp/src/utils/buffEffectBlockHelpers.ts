import type { BuffEffect, BuffEffectBlock } from '@/types/calculator'
import { getEffectSkillTargets } from '@/utils/buffEffect'

function skillTargetsKey(effect: BuffEffect) {
  return getEffectSkillTargets(effect)
    .map((item) => `${item.category}:${item.subcategoryId ?? ''}`)
    .join('|')
}

/**
 * 效果块身份匹配（跨精炼同步「异常计算时也生效」用）
 */
export function sameBuffEffectIdentity(a: BuffEffect, b: BuffEffect) {
  return (
    a.stat === b.stat &&
    a.kind === b.kind &&
    a.scope === b.scope &&
    a.applyTarget === b.applyTarget &&
    skillTargetsKey(a) === skillTargetsKey(b)
  )
}

/** 邦布/音擎：勾选「异常计算时也生效」时同步到所有精炼 */
export function syncAppliesToAnomalyAcrossRefinementBlocks(
  ranks: BuffEffectBlock[][],
  target: BuffEffect,
  value: boolean,
) {
  for (const blocks of ranks) {
    for (const block of blocks) {
      for (const effect of block.effects) {
        if (!sameBuffEffectIdentity(effect, target)) continue
        effect.appliesToAnomaly = value ? true : undefined
      }
    }
  }
}

/** 精炼效果块：保证第一块默认名为 精N（不覆盖用户已改过的名字） */
export function ensureRefinementFirstBlockName(
  blocks: BuffEffectBlock[],
  rank: number,
): BuffEffectBlock[] {
  if (!blocks.length) return blocks
  const first = blocks[0]!
  const trimmed = first.name?.trim() ?? ''
  // 仅补空名或占位「效果块 / 效果块 N」；用户自定义名称一律保留
  if (!trimmed || /^效果块(\s*\d+)?$/.test(trimmed)) {
    first.name = `精${rank}`
  }
  if (typeof first.note !== 'string') first.note = ''
  return blocks
}
