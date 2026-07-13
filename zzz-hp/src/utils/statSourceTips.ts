import type { BuffStatKey, BuffStatModifiers } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { BuffModSource } from '@/utils/panelBuffCalc'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'

export interface StatSourceGroup {
  label: string
  items: string[]
  /** 加减过程组占满整行展示 */
  fullWidth?: boolean
}

function formatSigned(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
}

function formatProcessNumber(value: number, precision = 2) {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  const text = Math.round(value * 10 ** precision) / 10 ** precision
  return String(text).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

/** 面板百分点 → 乘区小数，用于展示：33% = 0.33 */
export function formatPercentAsRatio(percent: number, precision = 4) {
  return formatProcessNumber(percent / 100, precision)
}

function fieldLabel(key: BuffStatKey) {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === key)
  return field ? buffStatFieldLabel(field) : key
}

function valueUnitSuffix(key: BuffStatKey) {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === key)
  if (!field) return ''
  if (key === 'anomalyDuration') return 's'
  return field.unit === 'percent' ? '%' : ''
}

function collectItemsFromMods(mods: BuffStatModifiers, keys: BuffStatKey[]) {
  const items: string[] = []
  for (const key of keys) {
    const value = mods[key]
    if (!value) continue
    items.push(`${fieldLabel(key)} ${formatSigned(value)}`)
  }
  return items
}

function resolveExternalKey(
  key: BuffStatKey,
  externalPanel: PanelStats,
  externalKeyMap?: Partial<Record<BuffStatKey, keyof PanelStats | null>>,
): keyof PanelStats | null {
  if (externalKeyMap && key in externalKeyMap) {
    return externalKeyMap[key] ?? null
  }
  return (key as keyof PanelStats) in externalPanel ? (key as keyof PanelStats) : null
}

/** 生成「局外 + 各来源 ± 贡献 = 合计」的加减过程 */
export function buildAdditiveProcessItems(options: {
  key: BuffStatKey
  externalPanel: PanelStats
  sources: BuffModSource[]
  externalKeyMap?: Partial<Record<BuffStatKey, keyof PanelStats | null>>
  /** 传入则用于等式右侧，否则用局外 + 各来源加总 */
  finalValue?: number
}): string[] {
  const mapped = resolveExternalKey(options.key, options.externalPanel, options.externalKeyMap)
  if (mapped == null) return []

  const unit = valueUnitSuffix(options.key)
  const base = options.externalPanel[mapped]
  const steps: string[] = []
  const terms: string[] = []

  steps.push(`局外基数 ${formatProcessNumber(base)}${unit}`)
  terms.push(formatProcessNumber(base))

  for (const source of options.sources) {
    const value = source.mods[options.key]
    if (!value) continue
    steps.push(`${source.label} ${formatSigned(value)}${unit}`)
    terms.push(formatSigned(value))
  }

  if (terms.length <= 1) return []

  const total =
    options.finalValue ??
    base + options.sources.reduce((sum, source) => sum + (source.mods[options.key] ?? 0), 0)

  steps.push(`${terms.join(' ')} = ${formatProcessNumber(total)}${unit}`)
  return steps
}

/** 局内攻击力：局外 × (1 + 局内攻击%) + 固定攻击 */
export function buildAtkPanelProcessItems(options: {
  externalAtk: number
  finalAtk: number
  sources: BuffModSource[]
}): string[] {
  let totalPercent = 0
  let totalFlat = 0
  const steps: string[] = [`局外攻击 ${formatProcessNumber(options.externalAtk)}`]

  for (const source of options.sources) {
    const pct = source.mods.inCombatAtkPercent
    const flat = source.mods.atk
    if (pct) {
      steps.push(`${source.label} 局内攻击力 ${formatSigned(pct)}%`)
      totalPercent += pct
    }
    if (flat) {
      steps.push(`${source.label} 攻击力（数值） ${formatSigned(flat)}`)
      totalFlat += flat
    }
  }

  if (!totalPercent && !totalFlat) return []

  const afterPercent = options.externalAtk * (1 + totalPercent / 100)

  if (totalPercent) {
    steps.push(
      `${formatProcessNumber(options.externalAtk)} × (1 + ${formatProcessNumber(totalPercent)}%) = ${formatProcessNumber(afterPercent)}`,
    )
  }

  if (totalFlat) {
    const baseForFlat = totalPercent ? afterPercent : options.externalAtk
    steps.push(
      `${formatProcessNumber(baseForFlat)} + ${formatProcessNumber(totalFlat)} = ${formatProcessNumber(options.finalAtk)}`,
    )
  } else if (totalPercent) {
    steps[steps.length - 1] = `${formatProcessNumber(options.externalAtk)} × (1 + ${formatProcessNumber(totalPercent)}%) = ${formatProcessNumber(options.finalAtk)}`
  }

  return steps
}

/** 敌方基础 + 战斗增益 的加减过程 */
export function buildEnemyCombatProcessItems(options: {
  baseLabel: string
  baseValue: number
  sources: BuffModSource[]
  buffKey: BuffStatKey
  finalValue: number
  resultLabel?: string
}): string[] {
  const steps: string[] = []
  const terms: string[] = []

  steps.push(`${options.baseLabel} ${formatProcessNumber(options.baseValue)}`)
  terms.push(formatProcessNumber(options.baseValue))

  for (const source of options.sources) {
    const value = source.mods[options.buffKey]
    if (!value) continue
    steps.push(`${source.label} ${formatSigned(value)}%`)
    terms.push(`${formatSigned(value)}%`)
  }

  if (terms.length <= 1) return []

  const label = options.resultLabel ?? '合计'
  steps.push(`${terms.join(' ')} = ${label} ${formatProcessNumber(options.finalValue)}`)
  return steps
}

function appendAdditiveProcessGroup(
  groups: StatSourceGroup[],
  items: string[],
) {
  if (!items.length) return
  groups.push({ label: '加减过程', items, fullWidth: true })
}

/** 按指定 Buff 字段汇总：局外面板基数 + 各增益来源贡献 + 加减过程 */
export function buildStatSourceGroups(options: {
  keys: BuffStatKey[]
  externalPanel: PanelStats
  sources: BuffModSource[]
  /** 局外面板字段映射；默认与 keys 同名且存在于 PanelStats */
  externalKeyMap?: Partial<Record<BuffStatKey, keyof PanelStats | null>>
  extraGroups?: StatSourceGroup[]
  /** 传入则写入加减过程等式右侧 */
  finalValues?: Partial<Record<BuffStatKey, number>>
  /** 是否附加加减过程，默认 true */
  showAdditiveProcess?: boolean
}): StatSourceGroup[] {
  const groups: StatSourceGroup[] = []
  const externalItems: string[] = []
  const showProcess = options.showAdditiveProcess !== false

  for (const key of options.keys) {
    const mapped = resolveExternalKey(key, options.externalPanel, options.externalKeyMap)

    if (mapped == null) continue
    const value = options.externalPanel[mapped]
    if (!value) continue
    externalItems.push(`${fieldLabel(key)} ${value}`)
  }

  if (externalItems.length) {
    groups.push({ label: '局外面板', items: externalItems })
  }

  if (options.extraGroups?.length) {
    groups.push(...options.extraGroups)
  }

  for (const source of options.sources) {
    const items = collectItemsFromMods(source.mods, options.keys)
    if (!items.length) continue
    groups.push({ label: source.label, items })
  }

  if (showProcess) {
    const processItems: string[] = []
    for (const key of options.keys) {
      const keyItems = buildAdditiveProcessItems({
        key,
        externalPanel: options.externalPanel,
        sources: options.sources,
        externalKeyMap: options.externalKeyMap,
        finalValue: options.finalValues?.[key],
      })
      if (!keyItems.length) continue
      if (options.keys.length > 1) {
        processItems.push(`${fieldLabel(key)}：`)
      }
      processItems.push(...keyItems)
    }
    appendAdditiveProcessGroup(groups, processItems)
  }

  return groups
}
