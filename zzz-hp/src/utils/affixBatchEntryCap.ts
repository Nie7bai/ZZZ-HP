/**
 * 「本组单词条上限」批量入口的**纯计算**（解析输入 + 汇总当前值）。
 *
 * 为什么单独一个文件：用户侧 `AffixLibraryModal.vue` 与管理侧 `AdminAffixPresetPanel.vue`
 * 是**各写一份**的 UI（手册 §10.4：抽公共组件那条路被用户叫停），但**这段计算必须一模一样**，
 * 而且必须能被测到 —— 2026-09-17 真机事故就是它：
 *
 * `<input type="number">` 上的 `v-model` 会自动按数字解析（值不是字符串），而原实现写的是
 * `batchEntryCapInput.value.trim()` → `.trim is not a function` → **computed 抛错 → 整个渲染崩掉**
 * → 按钮的 `disabled` 永远停在初始的禁用态 → 用户看到的就是「填了数字点不动」。
 * 所以这里统一收口：**只管输入是什么类型，一律先 `String()` 再解析**，
 * 两侧组件都调它，别再各写一份 `.trim()`。
 */

/**
 * 解析输入框里的值：返回 **≥ 0 的整数**，非法/空 → `null`（按钮据此置灰）。
 *
 * 接受 `string | number`（`<input type="number">` + `v-model` 会给出 number，也可能是空串），
 * 其它类型（`null` / `undefined` / 布尔 / 对象）一律当非法。
 * 语义与库侧 `setAffixLibraryGroupEntryCaps` 的钳制一致：负数/小数 → `0` 起的整数。
 */
export function parseBatchEntryCapInput(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const raw = String(value).trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
}

/**
 * 「本组当前：…」的显示口径（2026-09-17 用户定）：
 * - 全部一致 → `全部 30（10 条）` / `全部不限（10 条）`
 * - **只要有一条不一样 → `上限不一致`**（不列分布：批量入口只回答"能不能一次改"，明细看表格）
 * - 这一组没有条目 → `—`
 */
export function summarizeEntryCaps(caps: readonly number[]): string {
  if (!caps.length) return '—'
  const list = caps.map((cap) => (Number.isFinite(Number(cap)) ? Math.max(0, Math.round(Number(cap))) : -1))
  const first = list[0]!
  if (list.every((cap) => cap === first)) {
    return first === 0 ? `全部不限（${list.length} 条）` : `全部 ${first}（${list.length} 条）`
  }
  return '上限不一致'
}
