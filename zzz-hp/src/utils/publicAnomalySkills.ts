import type { Skill } from '@/types/calculator'

/**
 * 公共预设只有「属性异常」，按元素各一条。异放/紊乱/乱流/耀变不是公共预设。
 *
 * 倍率写在招式 `baseMult` 上，与角色面板默认值同一套数字，不再额外 ×10 / ×20。
 * 无流明、无霜（霜未作为独立属性开放）。
 */
export const PUBLIC_ANOMALY_SKILLS = [
  { id: 'sk-public-anomaly-wind', element: '风', name: '风属性异常', baseMult: 1250, sortOrder: 10 },
  { id: 'sk-public-anomaly-fire', element: '火', name: '火属性异常', baseMult: 50, sortOrder: 20 },
  { id: 'sk-public-anomaly-electric', element: '电', name: '电属性异常', baseMult: 125, sortOrder: 30 },
  { id: 'sk-public-anomaly-physical', element: '物理', name: '物理属性异常', baseMult: 713, sortOrder: 40 },
  { id: 'sk-public-anomaly-ether', element: '以太', name: '以太属性异常', baseMult: 62.5, sortOrder: 50 },
  { id: 'sk-public-anomaly-ice', element: '冰', name: '冰属性异常', baseMult: 500, sortOrder: 60 },
] as const

/** 已下线的公共属性异常 id（启动合并时剔除，避免旧库残留） */
const RETIRED_PUBLIC_ANOMALY_IDS = new Set(['sk-public-anomaly-frost'])

export type PublicAnomalyElement = (typeof PUBLIC_ANOMALY_SKILLS)[number]['element']

export const PUBLIC_ANOMALY_ELEMENTS = PUBLIC_ANOMALY_SKILLS.map((item) => item.element)

function toPublicAnomalySkill(def: (typeof PUBLIC_ANOMALY_SKILLS)[number]): Skill {
  return {
    id: def.id,
    name: def.name,
    agentId: '',
    source: 'preset',
    damageType: 'anomaly',
    skillTypes: [],
    buffAnchorId: null,
    baseMult: def.baseMult,
    baseMultFactor: 100,
    settlementMult: 0,
    element: def.element,
  }
}

/** 保证公共属性异常一定在库里；已有同 id 的用这份倍率/元素覆盖。 */
export function mergePublicAnomalyPresets(existing: Skill[]): Skill[] {
  const canonicalIds = new Set<string>(PUBLIC_ANOMALY_SKILLS.map((item) => item.id))
  const others = existing.filter(
    (item) => !canonicalIds.has(item.id) && !RETIRED_PUBLIC_ANOMALY_IDS.has(item.id),
  )
  return [...PUBLIC_ANOMALY_SKILLS.map(toPublicAnomalySkill), ...others]
}
