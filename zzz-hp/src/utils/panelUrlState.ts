/**
 * 模式面板的「选择状态 ↔ URL query」公共工具。
 *
 * 目的：让面板里选中的东西能通过 URL 直达，便于分享 / 收藏 / 前进后退。
 * 约定（唯一事实来源，见 dev-docs/mode-panel-url-state.md）：
 *
 * | 面板 | query | 含义 |
 * |---|---|---|
 * | 危局强袭战 · 血量折线图 | `mode=hard` | 正常 / 绝境 子模式（缺省即正常） |
 * | 危局强袭战 · 分数与血量对应表 | `mode=hard` | 同上（既有实现） |
 * | 往期详细（危局 / 防卫战） | `phase=<version>-<期数>` | 选中的期 |
 * | 临界推演 · 往期详细 | `period=<periodId>&node=<nodeId>` | 选中的期与节点 |
 *
 * 这里只放**纯函数**，便于在 node 侧回归测试；调用方负责 `router.replace`。
 */

import type { LocationQueryRaw } from 'vue-router'

/** query 键名。集中定义，避免各面板各写一份字符串。 */
export const PANEL_QUERY_KEYS = {
  mode: 'mode',
  phase: 'phase',
  period: 'period',
  node: 'node',
} as const

/** `mode` 参数里表示「绝境」的值；缺省即正常模式。 */
export const PANEL_MODE_HARD = 'hard'

/**
 * 读取单值 query。
 *
 * vue-router 的 query 值可能是 `string | string[] | null`，这里统一取第一个非空字符串；
 * 空串、数组、null 一律视为「未设置」。
 */
export function readSingleQueryValue(
  query: LocationQueryRaw | null | undefined,
  key: string,
): string | undefined {
  if (!query) return undefined
  const raw = query[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 生成写入后的 query：值为空（null / undefined / ''）时**删除**该键，其余键原样保留。
 *
 * 只做纯计算、不触碰 router，方便测试与复用（一次可写多个键，如临界的 period + node）。
 * 入参直接用 `route.query` 即可：`LocationQuery` 的值是 `string | null`，
 * 可赋给 `LocationQueryRaw`（`string | number | null | undefined`）。
 */
export function buildQueryWithValues(
  query: LocationQueryRaw | null | undefined,
  values: Record<string, string | null | undefined>,
): LocationQueryRaw {
  const next: LocationQueryRaw = { ...(query ?? {}) }
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.length > 0) next[key] = value
    else delete next[key]
  }
  return next
}

/**
 * 期 / 赛季的稳定标识：`<version>-<期数里的数字>`。
 *
 * 与两个面板里既有的 `phaseSelectionKey` / `seasonSelectionKey` 完全一致 ——
 * 这里抽出来是为了让 URL 与「跨数据重载还原选中项」用**同一个**身份，
 * 避免出现两套 key 而互相对不上。
 */
export function periodSelectionKey(period: { version: string; phase: string }): string {
  const phaseNumber = period.phase.replace(/\D/g, '')
  return `${period.version}-${phaseNumber || period.phase}`
}

/**
 * 在列表里按稳定标识找下标；找不到返回 -1。
 * 供「从 URL 还原选中项」使用。
 */
export function findIndexBySelectionKey<T extends { version: string; phase: string }>(
  list: readonly T[],
  key: string | undefined,
): number {
  if (!key) return -1
  return list.findIndex((item) => periodSelectionKey(item) === key)
}
