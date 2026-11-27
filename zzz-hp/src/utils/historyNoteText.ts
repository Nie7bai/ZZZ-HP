/**
 * 历史 / 怪物详情里的纯文本备注（得分机制、场地 Buff 原文）：
 * 录入文本常自带行首项目符号，展示时统一去掉，并按行拆分。
 */
import { splitBuffLines } from '@/utils/gameData'

const NOTE_BULLETS = ['·', '•', '●', '▪', '◦']

/** 去掉行首一个或多个项目符号（「· 」「• 」等），保留其余内容 */
export function stripNoteBullet(line: string): string {
  let out = line.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const bullet of NOTE_BULLETS) {
      if (out.startsWith(bullet)) {
        out = out.slice(bullet.length).trimStart()
        changed = true
      }
    }
  }
  return out
}

/** 按行拆分并去掉行首符号与空行（兼容字面量 `\n`，与场地 Buff 原文同口径） */
export function splitNoteLines(text: string | null | undefined): string[] {
  if (!text) return []
  return splitBuffLines(text).map((line) => stripNoteBullet(line))
}

/**
 * 效果块只保留注释，且去掉与原文重复的注释；没有有效注释时返回 null。
 * 往期详情 / 怪物详情 / 怪物数据库三处的场地 Buff 展示口径一致。
 */
export function noteBlocksForDisplay<T extends { note?: string | null }>(
  blocks: readonly T[] | null | undefined,
  content: string,
): Array<T & { note: string }> | null {
  if (!blocks?.length) return null
  const text = content.trim()
  const kept = blocks
    .map((block) => ({
      ...block,
      note: block.note?.trim() && block.note.trim() !== text ? block.note : '',
    }))
    .filter((block) => block.note)
  return kept.length ? kept : null
}
