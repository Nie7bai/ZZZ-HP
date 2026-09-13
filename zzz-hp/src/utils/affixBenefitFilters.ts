/**
 * 收益表筛选状态的持久化（本机浏览器）。
 *
 * 为什么要存：分组多选与「隐藏无收益」是**长期偏好**，不该每次打开页面都重调一遍 ——
 * 尤其「隐藏无收益」默认开着，刷新后忽然冒出一堆 0% 的行会显得像 bug。
 * 用户 2026-09-13 口径：「这一行的几个按钮的状态，能不能进浏览器存储」。
 *
 * **「同名折叠」不进存档**（用户 2026-09-13 第 2 轮口径）：它是常开的显示规则，不是偏好，
 * 没有开关可存。老存档里遗留的 `collapseDuplicates` 字段读到即忽略（见 `coerceAffixBenefitFilters`）。
 *
 * 只存本机：换设备 / 清缓存回默认，与词条库（同样存 localStorage）同一处境。
 * 键里**不带库 id** —— 分组筛选对所有库共用一套（同名组在不同库里含义一致，
 * 通常正是想要的行为；要各记各的得把库 id 写进键里，目前没这需求）。
 *
 * 跨库共用带来的「残名」问题（组改名 / 删掉后名字还躺在存档里）由
 * `pruneAffixBenefitFilters()` 解决，见那里。
 */
import { resolveAffixLibraryAll, type AffixLibraryStore } from '@/utils/affixLibrary'

/** 收益表筛选状态 */
export interface AffixBenefitFilters {
  /** 「隐藏无收益」：只留收益率 > 0 的条目。默认 **true**（用户 2026-09-13：改为默认开着） */
  hideNoBenefit: boolean
  /** 被关掉的分组名（空数组 = 全显示）；未分组条目用空串表示 */
  hiddenGroups: string[]
}

export const AFFIX_BENEFIT_FILTERS_STORAGE_KEY = 'zzz-hp-affix-benefit-filters'

/** 默认视图：隐藏无收益开着、不关闭任何分组 */
export function createDefaultAffixBenefitFilters(): AffixBenefitFilters {
  return { hideNoBenefit: true, hiddenGroups: [] }
}

/**
 * 把任意来源的对象收成合法筛选状态。
 *
 * 字段缺失 / 类型不对一律回落默认值：存档是用户可改的（DevTools 一行就能写坏），
 * 坏一个字段不该让整张表消失。
 *
 * 只挑认识的字段（`hideNoBenefit` / `hiddenGroups`）—— 老存档里的 `collapseDuplicates`
 * 之类遗留字段自然被丢掉，既不影响其它字段，也不会把废弃语义写回存档。
 */
export function coerceAffixBenefitFilters(raw: unknown): AffixBenefitFilters {
  const fallback = createDefaultAffixBenefitFilters()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const item = raw as Record<string, unknown>
  return {
    hideNoBenefit:
      typeof item.hideNoBenefit === 'boolean' ? item.hideNoBenefit : fallback.hideNoBenefit,
    hiddenGroups: Array.isArray(item.hiddenGroups)
      ? item.hiddenGroups.filter((name): name is string => typeof name === 'string')
      : fallback.hiddenGroups,
  }
}

/** 读存档；没有 / 坏了都回落默认（不抛错，页面照常渲染） */
export function loadAffixBenefitFilters(): AffixBenefitFilters {
  try {
    const raw = localStorage.getItem(AFFIX_BENEFIT_FILTERS_STORAGE_KEY)
    if (!raw) return createDefaultAffixBenefitFilters()
    return coerceAffixBenefitFilters(JSON.parse(raw))
  } catch {
    return createDefaultAffixBenefitFilters()
  }
}

/** 写存档；配额满 / 隐私模式静默忽略（与词条库同一策略） */
export function saveAffixBenefitFilters(filters: AffixBenefitFilters): void {
  try {
    localStorage.setItem(AFFIX_BENEFIT_FILTERS_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // 静默忽略：存不下只是下次回默认，不影响本次使用
  }
}

/**
 * 「现在还存在的分组名」—— 从**整份存档的所有库**收集，含未分组的空串。
 *
 * 为什么要取并集而不是只取当前激活那套：分组筛选是**跨库共用**的（键里不带库 id）。
 * 只看当前库的话，切到一套没有「5号位」的库时，就会把这个筛选当残名删掉，
 * 切回去那个组又是显示状态 —— 用户的设置悄悄没了。
 *
 * 条目上的组名也要收：老存档 / 手改过的导入文件里出现过「条目引用了组、
 * 但组表里没登记」的情况（读盘时会被 `withReferencedGroupsBackfilled` 补上，
 * 这里不依赖那个补组结果，直接按条目取，谁都漏不掉）。
 */
export function collectAffixBenefitKnownGroups(store: AffixLibraryStore): Set<string> {
  const names = new Set<string>()
  for (const set of store.sets) {
    for (const group of set.state.groups) names.add(group.name)
    for (const entry of resolveAffixLibraryAll(set.state)) names.add(entry.group)
  }
  return names
}

/**
 * 剪掉存档里**已经不存在**的分组名（组被改名 / 删掉以后留下的残名）。
 *
 * 不剪会怎样：残名平时无害（等于没筛），但将来又建了同名分组它会**悄悄复活** ——
 * 用户 2026-09-13 指出的正是这条，要求「不能留」。
 *
 * 没有可剪的时候**原样返回同一个对象**：调用方据此判断「要不要落盘」，
 * 避免每次库一变动就写一次无意义的存档。
 */
export function pruneAffixBenefitFilters(
  filters: AffixBenefitFilters,
  knownGroups: Iterable<string>,
): AffixBenefitFilters {
  const known = knownGroups instanceof Set ? knownGroups : new Set(knownGroups)
  const next = filters.hiddenGroups.filter((name) => known.has(name))
  return next.length === filters.hiddenGroups.length ? filters : { ...filters, hiddenGroups: next }
}
