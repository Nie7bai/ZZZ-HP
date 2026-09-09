import type { SkillCategoryId, SkillMatchCoord, SkillTypeId } from '@/types/calculator'

/**
 * 招式类型相关的清单与映射。
 *
 * 与旧数据的关系：Buff 的限定项仍是 `{ category, subcategoryId }` 旧坐标，
 * 这里通过 SKILL_TYPE_COORD 把类型翻译回旧坐标，因此**不需要改动任何 Buff 数据**。
 */
export const SKILL_TYPE_OPTIONS: { id: SkillTypeId; label: string }[] = [
  { id: 'basic', label: '普通攻击' },
  { id: 'dodge', label: '闪避' },
  { id: 'dash', label: '冲刺攻击' },
  { id: 'dodgeCounter', label: '闪避反击' },
  { id: 'assist', label: '支援技' },
  { id: 'special', label: '特殊技' },
  { id: 'specialBasic', label: '普通特殊技' },
  { id: 'specialEnhanced', label: '强化特殊技' },
  { id: 'chain', label: '连携技' },
  { id: 'ultimate', label: '终结技' },
  { id: 'followUp', label: '追加攻击' },
]

/** 旧公共招式小类 id，现作为对应类型的匹配坐标（这些记录仍留在库里，不删） */
export const LEGACY_PUBLIC_SUBCATEGORY_ID = {
  dash: 'all-dodge-ms0dnpmr',
  dodgeCounter: 'all-dodge-ms4e5xea',
  specialEnhanced: 'all-special-ms0fcqv7',
} as const

/** 子类型自动满足父类型，避免管理员手动勾两遍 */
const SKILL_TYPE_IMPLIES: Partial<Record<SkillTypeId, SkillTypeId[]>> = {
  dash: ['dodge'],
  dodgeCounter: ['dodge'],
  specialBasic: ['special'],
  specialEnhanced: ['special'],
}

/**
 * 计算页标签展示：有小类时隐藏对应大类。
 * 例：勾了「强化特殊技」会蕴含「特殊技」，标签只显示「强化特殊技」。
 */
export function skillTypeLabelsForDisplay(types: SkillTypeId[] | null | undefined): string[] {
  const set = new Set(types ?? [])
  const hideParents = new Set<SkillTypeId>()
  for (const type of set) {
    for (const parent of SKILL_TYPE_IMPLIES[type] ?? []) hideParents.add(parent)
  }
  return SKILL_TYPE_OPTIONS.filter((item) => set.has(item.id) && !hideParents.has(item.id)).map(
    (item) => item.label,
  )
}

/**
 * 类型 → 旧坐标。`followUp` 不走坐标，走 `isFollowUp` 标志。
 *
 * 注：`specialBasic`（普通特殊技）没有对应的旧公共小类，故与 `special` 同坐标；
 * 旧 Buff 数据也无法单独限定「只普通特殊技」，此为已知限制。
 */
const SKILL_TYPE_COORD: Partial<Record<SkillTypeId, SkillMatchCoord>> = {
  basic: { category: 'basic', subcategoryId: null },
  dodge: { category: 'dodge', subcategoryId: null },
  dash: { category: 'dodge', subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.dash },
  dodgeCounter: { category: 'dodge', subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.dodgeCounter },
  assist: { category: 'assist', subcategoryId: null },
  special: { category: 'special', subcategoryId: null },
  specialBasic: { category: 'special', subcategoryId: null },
  specialEnhanced: {
    category: 'special',
    subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.specialEnhanced,
  },
  chain: { category: 'chain', subcategoryId: null },
  ultimate: { category: 'ultimate', subcategoryId: null },
}

/** 旧公共小类 id → 对应招式类型（迁移时把「选了公共小类」还原成「勾了类型」） */
export function skillTypeFromLegacyPublicSubcategory(
  subcategoryId: string | null | undefined,
): SkillTypeId | null {
  if (!subcategoryId) return null
  for (const [type, id] of Object.entries(LEGACY_PUBLIC_SUBCATEGORY_ID)) {
    if (id === subcategoryId) return type as SkillTypeId
  }
  return null
}

/** 旧招式大类 → 招式类型（同名，仅做一次收窄） */
export function skillTypeFromLegacyCategory(categoryId: SkillCategoryId): SkillTypeId {
  return categoryId as SkillTypeId
}

/** 展开蕴含关系后的类型集合 */
export function expandSkillTypes(types: SkillTypeId[] | null | undefined): SkillTypeId[] {
  const result = new Set<SkillTypeId>()
  for (const type of types ?? []) {
    result.add(type)
    for (const implied of SKILL_TYPE_IMPLIES[type] ?? []) result.add(implied)
  }
  return [...result]
}

export function skillTypesIncludeFollowUp(types: SkillTypeId[] | null | undefined): boolean {
  return (types ?? []).includes('followUp')
}

/**
 * 把一条招式翻译成 Buff 匹配坐标集合。
 *
 * - 每个类型出一个坐标（小类为空 = 该类型全部招式）
 * - 有增益锚点时，为每个类型再出一个带锚点的坐标，
 *   使「限定到具体某招」的 Buff 能命中
 */
export function buildSkillMatchCoords(options: {
  skillTypes?: SkillTypeId[] | null
  buffAnchorId?: string | null
  /** 锚点自身所属大类（来自旧小类记录）。给出时锚点坐标更精确 */
  buffAnchorCategory?: SkillCategoryId | null
}): SkillMatchCoord[] {
  const expanded = expandSkillTypes(options.skillTypes)
  const anchorId = options.buffAnchorId?.trim() || null
  const categories = new Set<SkillCategoryId>()
  const coords: SkillMatchCoord[] = []
  const seen = new Set<string>()

  const push = (coord: SkillMatchCoord) => {
    const key = `${coord.category}|${coord.subcategoryId ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    coords.push(coord)
  }

  for (const type of expanded) {
    const coord = SKILL_TYPE_COORD[type]
    if (!coord) continue
    categories.add(coord.category)
    push(coord)
  }

  if (anchorId) {
    // 锚点自身大类优先；未知时挂到该招式的所有大类下，保证旧 Buff 仍能命中
    const anchorCategories = options.buffAnchorCategory
      ? [options.buffAnchorCategory]
      : [...categories]
    for (const category of anchorCategories) push({ category, subcategoryId: anchorId })
  }

  return coords
}
