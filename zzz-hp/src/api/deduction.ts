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
  /** 是否 Boss 关：true=Boss 层（危局数据源），false/缺省=小怪层（shiyu 数据源） */
  isBoss?: boolean
  /** 多结局标签（如 结局1），nanoka 按可选 Buff 包归并 */
  ending?: string | null
  /** 绑定的 boss_info 场地 Buff 套 id；空则自动取默认/第一套 */
  fieldBuffSetId?: string | null
  /** 可选场地 Buff 套列表（管理端选择器用，由后端按 Boss 名解析） */
  fieldBuffSets?: Array<{ id: string; label?: string | null; name: string }> | null
  /** 区域增益（boss_info 场地 Buff，与危局同源），仅 boss 层存在 */
  fieldBuff?: DeductionFieldBuff | null
}

export interface DeductionBuff {
  title: string
  desc: string | null
  /** 与 buff 表同名匹配的图标（/buff_image/...），可能为空 */
  buff_image?: string | null
  /** 计算器结构化效果（可选，同步写入 buff 表 effect_blocks） */
  effect_blocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface DeductionNode {
  nodeId: string
  name: string
  /** 1=剧情(PLOT) 2=战斗(STAGE) 3=最终战(LAST STAGE) 4=开场(INTRO) 5=剧情变体 */
  type: number
  prevNode: string | null
  storyText: string | null
  /** 剧情选项（nanoka story_event.choice）：{ name, desc }，desc 常为解锁条件 */
  storyOptions?: { name: string; desc: string | null }[]
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
  // 类型已简化：战斗(2/3) / 剧情(1/4/5) 两种
  return isDeductionBattleNode(type) ? '战斗' : '剧情'
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

/**
 * 是否 Boss 层（与后端 layerNameIsBoss / resolveLayerIsBoss 对齐）：
 * - isBoss===true
 * - 或层名含 STAGE / LAST
 * - 或「结局N · Boss名」（排除「结局N · 4-1」这类前战波次）
 * 前战节点（STAGE 01 等）同样可能是 Boss，不只 LAST STAGE。
 */
export function isDeductionBossLayer(layer: {
  isBoss?: boolean
  name?: string | null
}): boolean {
  if (layer.isBoss === true) return true
  const s = String(layer.name ?? '').trim()
  if (!s) return false
  const endingWave = s.match(/^结局\d+\s*·\s*(.+)$/)
  if (endingWave) {
    return !/^\d+-\d+$/.test(endingWave[1].trim())
  }
  return /STAGE|LAST/i.test(s)
}

/** 节点内 Boss 层；若都未标出，回退为最后一层（该关仍有 Boss） */
export function deductionNodeBossLayers(node: DeductionNode): DeductionLayer[] {
  const layers = node.layers ?? []
  const marked = layers.filter((layer) => isDeductionBossLayer(layer))
  if (marked.length) return marked
  if (!layers.length) return []
  return [layers[layers.length - 1]!]
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
import { convertHpToDefense953, roundConvertedHp } from '@/utils/defenseHpConvert'
import { splitBuffLines } from '@/utils/gameData'

function monsterHpConverted953(monster: DeductionMonster): number {
  return roundConvertedHp(convertHpToDefense953(Number(monster.hp) || 0, Number(monster.defense) || 0))
}

/** 当期 Boss 怪物数：各战斗节点的 Boss 层（含 STAGE 01 等前序节点，不限 LAST STAGE） */
function deductionPeriodBossCount(period: DeductionPeriod): number {
  let count = 0
  for (const node of period.nodes) {
    if (!isDeductionBattleNode(node.type)) continue
    for (const layer of deductionNodeBossLayers(node)) {
      count += layer.monsters.length
    }
  }
  return count
}

function deductionPeriodHpTotals(period: DeductionPeriod): {
  totalHp: number
  totalHpConverted953: number
  bossCount: number
} {
  let totalHp = 0
  let totalHpConverted953 = 0
  for (const node of period.nodes) {
    for (const layer of node.layers) {
      for (const monster of layer.monsters) {
        totalHp += Number(monster.hp) || 0
        totalHpConverted953 += monsterHpConverted953(monster)
      }
    }
  }
  return { totalHp, totalHpConverted953, bossCount: deductionPeriodBossCount(period) }
}

/**
 * 血量折线图：每期一点 = 当期全部节点总血量 / 当期 Boss 总数
 *（含 953 防御换算均值）
 */
export async function fetchDeductionPeriodHpChart(): Promise<HpChartPoint[]> {
  const periods = await fetchDeductionPhases()
  const points: HpChartPoint[] = []
  for (const period of periods) {
    const { totalHp, totalHpConverted953, bossCount } = deductionPeriodHpTotals(period)
    if (bossCount <= 0) continue
    points.push({
      label: deductionPeriodDisplay(period),
      dateRange: '',
      totalHp: Math.round(totalHp / bossCount),
      totalHpConverted953: Math.round(totalHpConverted953 / bossCount),
      version: period.periodId,
      phase: period.phase,
    })
  }
  return points
}

/** 节点对比折线图：各战斗节点总血量（含 953 换算） */
export async function fetchDeductionNodeHpChart(): Promise<HpChartPoint[]> {
  const periods = await fetchDeductionPhases()
  const points: HpChartPoint[] = []
  for (const period of periods) {
    for (const node of period.nodes) {
      if (!isDeductionBattleNode(node.type)) continue
      let nodeHp = 0
      let nodeHp953 = 0
      for (const layer of node.layers) {
        for (const monster of layer.monsters) {
          nodeHp += Number(monster.hp) || 0
          nodeHp953 += monsterHpConverted953(monster)
        }
      }
      points.push({
        label: `推演${period.periodId}·${node.name}`,
        dateRange: '',
        totalHp: nodeHp,
        totalHpConverted953: nodeHp953,
        version: period.periodId,
        phase: period.phase,
      })
    }
  }
  return points
}

/** @deprecated 使用 fetchDeductionNodeHpChart；保留别名以免旧引用断裂 */
export async function fetchDeductionHpChart(): Promise<HpChartPoint[]> {
  return fetchDeductionNodeHpChart()
}

/** 推演终局 Boss 列表（单独怪物对比用） */
export async function fetchDeductionBossList(): Promise<BossOption[]> {
  const periods = await fetchDeductionPhases()
  const byName = new Map<string, { image: string | null }>()
  for (const period of periods) {
    for (const node of period.nodes) {
      if (!isDeductionBattleNode(node.type)) continue
      for (const layer of deductionNodeBossLayers(node)) {
        for (const monster of layer.monsters) {
          if (!monster.name) continue
          const name = String(monster.name)
          const rec = byName.get(name) ?? { image: null }
          if (!rec.image && monster.boss_image) rec.image = monster.boss_image
          byName.set(name, rec)
        }
      }
    }
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh'))
    .map(([boss_name, rec]) => ({ boss_name, boss_image: rec.image }))
}

/** 某怪物在推演各期出现的总血量（按期汇总，含 953 换算） */
export async function fetchDeductionBossChart(bossName: string): Promise<HpChartPoint[]> {
  const periods = await fetchDeductionPhases()
  const points: HpChartPoint[] = []
  for (const period of periods) {
    let hp = 0
    let hp953 = 0
    for (const node of period.nodes) {
      if (!isDeductionBattleNode(node.type)) continue
      for (const layer of deductionNodeBossLayers(node)) {
        for (const monster of layer.monsters) {
          if (monster.name === bossName) {
            hp += Number(monster.hp) || 0
            hp953 += monsterHpConverted953(monster)
          }
        }
      }
    }
    if (hp > 0) {
      points.push({
        label: `推演${period.periodId}`,
        dateRange: '',
        totalHp: hp,
        totalHpConverted953: hp953,
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
          effectBlocks: buff.effect_blocks ?? null,
          buffText: buff.desc ?? undefined,
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
