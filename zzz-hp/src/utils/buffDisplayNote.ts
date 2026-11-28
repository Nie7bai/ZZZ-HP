/**
 * 增益展示注释合并。
 *
 * 一处增益行的注释可能来自多段（影画注释、效果块注释、驱动盘套装注释……），
 * 采集早期会把同一段原文同时写进影画注释与效果块注释，所以这里按「行」判重：
 * 一段的每一行都已被其它段覆盖 → 整段丢掉；多段完全相同 → 只留第一段。
 * 只要还带一行独有内容就保留，避免误删信息。与传入顺序无关。
 */
export function mergeBuffDisplayNotes(...parts: Array<string | null | undefined>): string {
  const prepared = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .map((text) => ({
      text,
      lines: text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    }))
    .filter((item) => item.lines.length > 0)

  const lineSets = prepared.map((item) => new Set(item.lines))
  const kept: string[] = []
  prepared.forEach((item, index) => {
    const coveredByOther = (line: string) =>
      lineSets.some((set, other) => other !== index && set.has(line))
    const hasOwnLine = item.lines.some((line) => !coveredByOther(line))
    if (hasOwnLine) {
      kept.push(item.text)
      return
    }
    // 没有独占行：与后面某段完全相同则只留第一段；被更长的段完全覆盖则丢掉
    const ownSet = lineSets[index]!
    const identicalLater = prepared.some((other, otherIndex) => {
      const otherSet = lineSets[otherIndex]
      if (otherIndex <= index || !otherSet) return false
      return (
        otherSet.size === ownSet.size && item.lines.every((line) => otherSet.has(line))
      )
    })
    if (identicalLater) kept.push(item.text)
  })
  return kept.join('\n')
}
