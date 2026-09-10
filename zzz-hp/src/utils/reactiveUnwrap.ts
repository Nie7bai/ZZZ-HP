import { isProxy, toRaw } from 'vue'

/**
 * 深解包 Vue 响应式代理：把代理换成它背后的普通对象，**不改变任何数据**。
 *
 * ## 为什么需要
 *
 * 计算器引擎（面板聚合、buff 解析、伤害结算）会对同一批数据做海量属性读取。
 * 若这些数据是 `reactive()` 代理，**每次属性读取都要过一遍 Proxy 陷阱**
 * （依赖收集 / 反射转发），实测会慢 3 倍以上。
 *
 * 实测（2026-09-10，42 招式真实方案，浏览器）：
 *
 * | 数据形态 | 单次评估 |
 * |---|---|
 * | 应用传入的响应式数据 | 16.4 ms |
 * | 深解包后 | **5.3 ms** |
 *
 * node 里同一份数据的成本是 5.8ms，即解包后回到「无代理开销」的水平。
 *
 * ## 行为与安全性
 *
 * - **只换引用，不改值**：解包后读写的是同一份底层数据。
 *   编辑器/面板写入仍走响应式链路，因此**不会**出现「面板改了但计算不更新」。
 * - **就地解包**：递归把容器内的槽位从代理替换为其底层对象。
 *   这是必要的 —— 只解包顶层数组不够，引擎还会深入读 `agents[i].basePanel.atk`
 *   这类嵌套字段。
 * - 只递归「数组」与「纯对象」（`Object.create(null)` 或 `{}` 字面量）。
 *   `Map`/`Set`/`Date`/类实例/函数一律原样返回，避免破坏它们的方法与语义。
 * - 冻结对象跳过（不可写）；单个属性写入失败不影响整体（try/catch 兜底）。
 * - 用 `WeakMap` 记录已处理对象，天然处理环形引用，也避免重复遍历。
 *
 * ## 什么时候不该用
 *
 * 若调用方**依赖**「读到的是代理」来触发自己的依赖收集，则不可替换。
 * 当前只用于「把数据交给纯计算引擎」的场景，引擎只读不写、不参与依赖收集。
 */
export function deepUnwrapReactive<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (value === null || typeof value !== 'object') return value

  const asObject = value as unknown as object
  if (seen.has(asObject)) return seen.get(asObject) as T

  const target = isProxy(asObject) ? toRaw(asObject) : asObject
  seen.set(asObject, target)
  // 代理与底层对象都登记，避免同一对象的两种形态被各走一遍
  if (target !== asObject) seen.set(target as object, target)

  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i += 1) {
      const unwrapped = deepUnwrapReactive((target as unknown[])[i], seen)
      if ((target as unknown[])[i] !== unwrapped) {
        try {
          ;(target as unknown[])[i] = unwrapped
        } catch {
          /* 冻结/只读数组：保持原值即可 */
        }
      }
    }
    return target as T
  }

  // 只处理纯对象，避免动到 Map / Date / 类实例的方法
  const proto = Object.getPrototypeOf(target)
  if (proto !== null && proto !== Object.prototype) return target as T
  if (Object.isFrozen(target)) return target as T

  for (const key of Object.keys(target)) {
    const child = (target as Record<string, unknown>)[key]
    const unwrapped = deepUnwrapReactive(child, seen)
    if (child !== unwrapped) {
      try {
        ;(target as Record<string, unknown>)[key] = unwrapped
      } catch {
        /* 只读属性：保持原值即可 */
      }
    }
  }
  return target as T
}
