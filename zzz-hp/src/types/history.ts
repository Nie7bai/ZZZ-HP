export type ModeKey = 'crisis-assault' | 'defense' | 'deduction'

export interface BuffInfo {
  name: string
  icon: string
  lines: string[]
  imageUrl?: string
  recordId?: number
  buffIndex?: number
  buffText?: string
  isEmpty?: boolean
  /** 计算器结构化效果块 */
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
  /** 归属分组（推演按节点细分时用，如节点名 STAGE 01） */
  groupLabel?: string
}

export interface EnemySlot {
  label: string
  subStats: string
  bossName?: string
  imageUrl?: string
  hp: string
  hpValue?: number
  /** 换算到 953 防御的等效血量文案 */
  hpConverted953?: string
  hpConverted953Value?: number
  altHp: string
  elements: string[]
  defense?: number
  weakness?: string
  /** 失衡时间（秒） */
  staggerTime?: number | null
  resistance?: string
  /** 高抗性（40%）属性，为 resistance 的子集。见 dev-docs/boss-resistance-level.md */
  resistanceHigh?: string
  /** 得分机制生效值（本期覆盖优先，否则怪物库默认；危局详情显示在场地 Buff 上方） */
  scoringNote?: string | null
  /** 本期覆盖值（空 = 沿用怪物库） */
  scoringNoteOverride?: string | null
  /** 怪物库默认值 */
  scoringNoteDefault?: string | null
  /** 危局多套弱点/抗性的当期绑定 id（怪物库配置）；null 表示沿用单套字段 */
  weaknessSetId?: string | null
  /** 绑定套的展示标签（如「第一阶段」），用于卡片/详情标注 */
  weaknessSetLabel?: string | null
  /** 敌方失衡易伤区基础乘数（1.5 = 150%），来自 boss / boss_info */
  staggerMultiplier?: number | null
  /** 异常条系数（初始异常积蓄 = 基础异常条 × 系数），来自 boss_info；缺失时前端按 1 兜底 */
  anomalyBarCoefficient?: number | null
  footer?: string
  /** 怪物危局基础血量 */
  crisisBaseHp?: number | null
  /** 危局血量系数整数百分比 */
  hpCoeffPercent?: number | null
  /** 危局血量系数展示，如 150% */
  hpCoeffLabel?: string | null
  /** 是否为绝境房间（3.1+） */
  isHardRoom?: boolean
  /** boss 表记录 ID（管理端编辑用） */
  recordId?: number
  /** 危局房间码：1 / 2 / 3 / 4（绝境） */
  room?: string
  /** 当期绑定的场地 Buff 套 id（管理端） */
  fieldBuffSetId?: string | null
  /** Boss 场地 Buff（API 已按当期绑定解析） */
  fieldBuff?: {
    name: string
    text?: string
    imageUrl?: string
    effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
  } | null
  /** 该槽位尚无怪物数据 */
  isEmpty?: boolean
}

export interface PhaseData {
  id: string
  /** 版本号，如 3.1 */
  version: string
  /** 展示用期数文案，如「第 1 期」 */
  phase: string
  dateRange: string
  tid: string
  rawHp: string
  totalHp?: number
  /** 换算到 953 防御的总血量文案 */
  rawHpConverted953?: string
  totalHpConverted953?: number
  /** 绝境模式总血量（不计入普通总血量） */
  rawHardHp?: string
  hardTotalHp?: number
  rawHardHpConverted953?: string
  hardTotalHpConverted953?: number
  /** 开始日期晚于今天，仅管理员可见 */
  isHidden?: boolean
  /** 管理端软删除：已删除未清理 */
  pendingCleanup?: boolean
  deletedAt?: string | null
  buffs: BuffInfo[]
  enemies: EnemySlot[]
}

export const modeTitles: Record<ModeKey, string> = {
  'crisis-assault': '危局强袭战',
  defense: '式舆防卫战',
  deduction: '临界推演',
}
