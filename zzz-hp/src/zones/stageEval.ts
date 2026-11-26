/**
 * 阶段模块求值（Phase 4f-3）。
 *
 * 只处理**运行时新增/替换**、现有内置值里没有的阶段；内置阶段仍用 damageCalc 的原值。
 * 白名单模块，不执行任意表达式。
 */
export interface StageValueContext {
  panel?: Record<string, number | undefined | null>
  enemyInput?: Record<string, number | undefined | null>
  customMods?: Record<string, number> | null
}

export interface EvaluableStage {
  id: string
  kind: 'source' | 'multiplier' | 'combine' | 'final'
  module?: string
  inputs?: readonly string[]
  params?: Record<string, unknown>
}

function readNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function numericInputs(stage: EvaluableStage, values: Record<string, number | undefined>): number[] {
  return (stage.inputs ?? [])
    .map((input) => readNumber(values[input]))
    .filter((value): value is number => value != null)
}

/**
 * 返回阶段值；未知模块 / 缺参数 / 输入不足时返回 null（该阶段跳过，不影响结算）。
 */
export function evaluateStageValue(
  stage: EvaluableStage,
  values: Record<string, number | undefined>,
  context: StageValueContext = {},
): number | null {
  const params = stage.params ?? {}
  const module = String(stage.module ?? '')

  if (module === 'constant') return readNumber(params.value)

  if (module === 'panelField' || module === 'panel.field') {
    const field = String(params.field ?? '')
    return field ? readNumber(context.panel?.[field]) : null
  }

  if (module === 'enemyField' || module === 'enemy.field') {
    const field = String(params.field ?? '')
    return field ? readNumber(context.enemyInput?.[field]) : null
  }

  if (module === 'percentSum') {
    const statKeys = Array.isArray(params.statKeys)
      ? params.statKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : []
    if (!statKeys.length) return null
    let percent = 0
    for (const key of statKeys) {
      const value = readNumber(context.customMods?.[key])
      if (value != null) percent += value
    }
    let factor = 1 + percent / 100
    const cap = readNumber(params.cap)
    if (cap != null && cap > 0) factor = Math.min(factor, cap)
    const floor = readNumber(params.floor)
    if (floor != null) factor = Math.max(factor, floor)
    if (params.allowNegative === false) factor = Math.max(0, factor)
    return factor
  }

  const inputs = numericInputs(stage, values)

  if (module === 'add' || module === 'sum') {
    if (!inputs.length) return null
    return inputs.reduce((sum, value) => sum + value, 0)
  }
  if (module === 'multiply' || module === 'product') {
    if (!inputs.length) return null
    return inputs.reduce((product, value) => product * value, 1)
  }
  if (module === 'min') {
    if (!inputs.length) return null
    return Math.min(...inputs)
  }
  if (module === 'max') {
    if (!inputs.length) return null
    return Math.max(...inputs)
  }

  return null
}
