export interface DeductionMonster {
  name: string
  hp: number
  defense: number
  level: number
  weakness: string | null
  resistance: string | null
  /** 本地 Boss 图片路径（/boss_image/...），可能为空 */
  boss_image?: string | null
}

export interface DeductionFieldBuff {
  name: string
  text?: string
  image?: string | null
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface DeductionLayer {
  name: string
  monsters: DeductionMonster[]
  /** 区域增益（boss_info 场地 Buff，与危局同源），仅 boss 层存在 */
  fieldBuff?: DeductionFieldBuff | null
}

export interface DeductionBuff {
  title: string
  desc: string | null
  /** 与 buff 表同名匹配的图标（/buff_image/...），可能为空 */
  buff_image?: string | null
}

export interface DeductionNode {
  nodeId: string
  name: string
  /** 1=剧情(PLOT) 2=战斗(STAGE) 3=最终战(LAST STAGE) 4=开场(INTRO) 5=剧情变体 */
  type: number
  prevNode: string | null
  storyText: string | null
  layers: DeductionLayer[]
  buffs: DeductionBuff[]
}

export interface DeductionPeriod {
  periodId: string
  phase: string
  /** 期数显示名（如 临界推演：歧路回响），可能为空 */
  periodName?: string | null
  nodes: DeductionNode[]
}

/** 期数展示名：有 period_name 用之，否则回退「推演 <期数id>」 */
export function deductionPeriodDisplay(
  period: { periodId: string; periodName?: string | null },
): string {
  const name = period.periodName?.trim()
  return name || `推演 ${period.periodId}`
}

/** 故事类节点：开场 / 剧情（含变体 type 5） */
export function isDeductionStoryNode(type: number): boolean {
  return type === 1 || type === 4 || type === 5
}

/** 战斗类节点：战斗 / 最终战 */
export function isDeductionBattleNode(type: number): boolean {
  return type === 2 || type === 3
}

export function deductionNodeTypeLabel(type: number): string {
  switch (type) {
    case 1:
      return '剧情'
    case 2:
      return '战斗'
    case 3:
      return '最终战'
    case 4:
      return '开场'
    case 5:
      return '剧情'
    default:
      return `节点 ${type}`
  }
}

export async function fetchDeductionPhases(): Promise<DeductionPeriod[]> {
  const response = await fetch('/api/deduction/phases')
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }
  const json = (await response.json()) as {
    code: number
    message: string
    data: DeductionPeriod[]
  }
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取临界推演数据失败')
  }
  return json.data
}

export interface DeductionPeriodStats {
  period: DeductionPeriod
  totalHp: number
  monsterCount: number
  battleNodeCount: number
  storyNodeCount: number
  buffCount: number
}

export function deductionPeriodStats(period: DeductionPeriod): DeductionPeriodStats {
  let totalHp = 0
  let monsterCount = 0
  let battleNodeCount = 0
  let storyNodeCount = 0
  const buffNames = new Set<string>()
  for (const node of period.nodes) {
    if (isDeductionBattleNode(node.type)) battleNodeCount++
    else if (isDeductionStoryNode(node.type)) storyNodeCount++
    for (const buff of node.buffs) buffNames.add(buff.title)
    for (const layer of node.layers) {
      for (const monster of layer.monsters) {
        totalHp += Number(monster.hp) || 0
        monsterCount++
      }
    }
  }
  return {
    period,
    totalHp,
    monsterCount,
    battleNodeCount,
    storyNodeCount,
    buffCount: buffNames.size,
  }
}

export interface DeductionBuffOverview {
  title: string
  desc: string | null
  buff_image: string | null
  periods: string[]
}

/** 跨期数去重收集所有可选增益 */
export function collectDeductionBuffs(periods: DeductionPeriod[]): DeductionBuffOverview[] {
  const map = new Map<string, DeductionBuffOverview>()
  for (const period of periods) {
    for (const node of period.nodes) {
      for (const buff of node.buffs) {
        const existing = map.get(buff.title)
        if (existing) {
          if (!existing.periods.includes(period.periodId)) existing.periods.push(period.periodId)
        } else {
          map.set(buff.title, {
            title: buff.title,
            desc: buff.desc,
            buff_image: buff.buff_image ?? null,
            periods: [period.periodId],
          })
        }
      }
    }
  }
  return [...map.values()]
}

// ---------------------------------------------------------------------------
// 危局同款数据形状适配（复用 HpLineChartPanel / PhaseComparePanel /
// BuffOverviewPanel / BuffComparePanel 渲染）
// ---------------------------------------------------------------------------

import type { BossOption, HpChartPoint } from '@/api/crisisAssault'
import type { BuffInfo, PhaseData } from '@/types/history'
import { splitBuffLines } from '@/utils/gameData'

/** 推演各战斗节点总血量 → 折线图点（节点对比，而非整期汇总） */
export async function fetchDeductionHpChart(): Promise<HpChartPoint[]> {
  const periods = await fetchDeductionPhases()
  const points: HpChartPoint[] = []
  for (const period of periods) {
    for (const node of period.nodes) {
      if (!isDeductionBattleNode(node.type)) continue
      const nodeHp = node.layers.reduce(
        (sum, layer) =>
          sum + layer.monsters.reduce((s, m) => s + (Number(m.hp) || 0), 0),
        0,
      )
      points.push({
        label: `推演${period.periodId}·${node.name}`,
        dateRange: '',
        totalHp: nodeHp,
        version: period.periodId,
        phase: period.phase,
      })
    }
  }
  return points
}

/** 推演中出现过的怪物（按节点数据去重，带图片），供单独怪物对比选择 */
export async function fetchDeductionBossList(): Promise<BossOption[]> {
  const periods = await fetchDeductionPhases()
  const byName = new Map<string, string | null>()
  for (const period of periods) {
    for (const node of period.nodes) {
      for (const layer of node.layers) {
        for (const monster of layer.monsters) {
          if (!monster.name) continue
          // 首见即记录图片（展示侧已按节点JSON/boss表/boss_info 解析过 boss_image）
          if (!byName.has(monster.name)) byName.set(monster.name, monster.boss_image ?? null)
        }
      }
    }
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh'))
    .map(([boss_name, boss_image]) => ({ boss_name, boss_image }))
}

/** 某怪物在推演各期出现的总血量（按期汇总） */
export async function fetchDeductionBossChart(bossName: string): Promise<HpChartPoint[]> {
  const periods = await fetchDeductionPhases()
  const points: HpChartPoint[] = []
  for (const period of periods) {
    let hp = 0
    for (const node of period.nodes) {
      for (const layer of node.layers) {
        for (const monster of layer.monsters) {
          if (monster.name === bossName) hp += Number(monster.hp) || 0
        }
      }
    }
    if (hp > 0) {
      points.push({
        label: `推演${period.periodId}`,
        dateRange: '',
        totalHp: hp,
        version: period.periodId,
        phase: period.phase,
      })
    }
  }
  return points
}

/** 推演期数 → 危局 PhaseData（Buff 按节点细分，带 groupLabel） */
export function deductionPhasesToPhaseData(periods: DeductionPeriod[]): PhaseData[] {
  return periods.map((period) => {
    const stats = deductionPeriodStats(period)
    const buffs: BuffInfo[] = []
    for (const node of period.nodes) {
      if (!isDeductionBattleNode(node.type)) continue
      const seenInNode = new Set<string>()
      for (const buff of node.buffs) {
        if (seenInNode.has(buff.title)) continue
        seenInNode.add(buff.title)
        buffs.push({
          name: buff.title,
          icon: '✦',
          lines: splitBuffLines(buff.desc),
          imageUrl: buff.buff_image ?? undefined,
          buffIndex: buffs.length + 1,
          isEmpty: false,
          groupLabel: node.name,
        })
      }
    }
    return {
      id: `dd-${period.periodId}`,
      version: period.periodId,
      phase: deductionPeriodDisplay(period),
      dateRange: '',
      tid: '—',
      rawHp: String(stats.totalHp),
      totalHp: stats.totalHp,
      buffs,
      enemies: [],
    }
  })
}
