/**
 * 收益表筛选状态的持久化（本机浏览器）。
 *
 * 为什么要存：这一行的开关（同名折叠 / 隐藏无收益 / 分组多选）是**长期偏好**，
 * 不该每次打开页面都重调一遍 —— 尤其「隐藏无收益」默认开着，刷新后忽然冒出一堆
 * 0% 的行会显得像 bug。用户 2026-09-13 口径：「这一行的几个按钮的状态，能不能进浏览器存储」。
 *
 * 只存本机：换设备 / 清缓存回默认，与词条库（同样存 localStorage）同一处境。
 * 键里**不带库 id** —— 分组筛选对所有库共用一套（同名组在不同库里含义一致，
 * 通常正是想要的行为；要各记各的得把库 id 写进键里，目前没这需求）。
 */

/** 收益表筛选状态 */
export interface AffixBenefitFilters {
  /** 「隐藏无收益」：只留收益率 > 0 的条目。默认 **true**（用户 2026-09-13：改为默认开着） */
  hideNoBenefit: boolean
  /** 「同名折叠」：同一效果的条目只显示一条（仅显示层，不影响计算）。默认 **true** */
  collapseDuplicates: boolean
  /** 被关掉的分组名（空数组 = 全显示）；未分组条目用空串表示 */
  hiddenGroups: string[]
}

export const AFFIX_BENEFIT_FILTERS_STORAGE_KEY = 'zzz-hp-affix-benefit-filters'

/** 默认视图：两个开关都开着、不关闭任何分组 */
export function createDefaultAffixBenefitFilters(): AffixBenefitFilters {
  return { hideNoBenefit: true, collapseDuplicates: true, hiddenGroups: [] }
}

/**
 * 把任意来源的对象收成合法筛选状态。
 *
 * 字段缺失 / 类型不对一律回落默认值：存档是用户可改的（DevTools 一行就能写坏），
 * 坏一个字段不该让整张表消失。
 */
export function coerceAffixBenefitFilters(raw: unknown): AffixBenefitFilters {
  const fallback = createDefaultAffixBenefitFilters()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const item = raw as Record<string, unknown>
  return {
    hideNoBenefit:
      typeof item.hideNoBenefit === 'boolean' ? item.hideNoBenefit : fallback.hideNoBenefit,
    collapseDuplicates:
      typeof item.collapseDuplicates === 'boolean'
        ? item.collapseDuplicates
        : fallback.collapseDuplicates,
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
