import { fetchAffixPreset } from '@/api/affixPreset'
import {
  freezePendingAffixLibrarySets,
  parseAffixPresetEntries,
  parseAffixPresetGroups,
  setServerAffixPreset,
  type AffixLibraryEntry,
  type AffixLibraryGroup,
} from '@/utils/affixLibrary'

/**
 * 拉取官方预设词条库（服务端唯一来源）。
 *
 * 口径（用户 2026-09-12 拍板）：官方预设由管理员在数据库维护，用户侧只读；
 * 用户自己的词条库在 localStorage，不进方案、管理员侧看不到。
 * 见 `dev-docs/affix-optimizer-impl-log.md` 步骤 33。
 *
 * 设计取舍：
 * - **不阻塞首屏**：拉取是异步的，先按代码里的构造器渲染，拿到再切过去
 *   （`setServerAffixPreset` 写的是响应式快照，依赖它的 computed 会自动重算）；
 * - **失败静默回落**：后端没起 / 网络不通时保持构造器那份，计算照常。
 *   用户口径是「离线了就别用了」，但**兜底要留到入库验证通过为止**
 *   （原话「丢掉等会再说」），所以这里不弹错、不重试刷屏；
 * - **同一会话只拉一次**：`inflight` 复用；失败则清空，下次进页面可以再试。
 *
 * 拿到快照后顺手把**还挂着过渡态**（`'follow'`）的用户库冻成独立（`freezePendingAffixLibrarySets`）：
 * 官方改不动用户手里的库，跟随是假的（用户 2026-09-13 口径「你不独立，怎么跟官方维护」）。
 * 时机必须是这里 —— 早于快照会把代码兜底当成官方预设冻进去。
 */

let inflight: Promise<number> | null = null

/** 拉一次（已拉过则复用同一个 Promise）。返回被跳过的脏条目数。 */
export function ensureAffixPresetLoaded(): Promise<number> {
  if (!inflight) {
    inflight = fetchAffixPreset()
      .then((snapshot) => {
        const skipped = setServerAffixPreset(snapshot)
        freezePendingAffixLibrarySets()
        return skipped
      })
      .catch(() => {
        // 拉失败：保持代码兜底那份，并允许下次再试
        inflight = null
        return 0
      })
  }
  return inflight
}

/** 强制重新拉（管理端改完官方预设后，本页要立刻跟上） */
export function reloadAffixPreset(): Promise<number> {
  inflight = null
  return ensureAffixPresetLoaded()
}

/**
 * 拉**指定的那套方案**并解析成条目 / 分组（新建库时「从哪个方案复制」走这里）。
 *
 * 为什么单独一条路：全局快照（`setServerAffixPreset`）装的是**默认方案**，计算页常驻用它。
 * 用户临时想看别的方案不该把全局那份顶掉 —— 顶掉之后计算页会瞬间换成另一套词条。
 * 所以这里只把内容交给调用方，不碰全局状态。
 *
 * 失败就抛错：调用方（新建库）据此**不建库**并如实提示，而不是拿半份内容凑一个库出来。
 */
export async function loadAffixPresetScheme(scheme: string): Promise<{
  entries: AffixLibraryEntry[]
  groups: AffixLibraryGroup[]
  skipped: number
}> {
  const snapshot = await fetchAffixPreset(scheme)
  const { entries, skipped } = parseAffixPresetEntries(
    Array.isArray(snapshot.entries) ? snapshot.entries : [],
  )
  const groups = parseAffixPresetGroups(Array.isArray(snapshot.groups) ? snapshot.groups : [])
  return { entries, groups, skipped }
}
