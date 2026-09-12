import { fetchAffixPreset } from '@/api/affixPreset'
import { setServerAffixPreset } from '@/utils/affixLibrary'

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
 */

let inflight: Promise<number> | null = null

/** 拉一次（已拉过则复用同一个 Promise）。返回被跳过的脏条目数。 */
export function ensureAffixPresetLoaded(): Promise<number> {
  if (!inflight) {
    inflight = fetchAffixPreset()
      .then((snapshot) => setServerAffixPreset(snapshot))
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
