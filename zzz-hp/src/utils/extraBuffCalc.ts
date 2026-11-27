import type { BuffEffect } from '@/types/calculator'
import type {
  ExtraBuffApplySlot,
  ExtraBuffGain,
  ExtraBuffSlotIndex,
} from '@/types/extraBuff'
import { createEmptyBuffEffect, normalizeBuffEffect } from '@/utils/buffEffect'
import { buildEffectRows } from '@/utils/buffEffectRows'

export type { ExtraBuffApplySlot, ExtraBuffGain, ExtraBuffSlotIndex }

/** 默认卡片名（Spec §3.1 第 2 项） */
const DEFAULT_EXTRA_GAIN_NAME = '自定义增益'

function newGainId(): string {
  return `extra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isSlotIndex(value: unknown): value is ExtraBuffSlotIndex {
  return value === 0 || value === 1 || value === 2
}

function readApplySlot(value: unknown): ExtraBuffApplySlot | null {
  if (value === 'team') return 'team'
  if (isSlotIndex(value)) return value
  return null
}

function normalizeGainName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || DEFAULT_EXTRA_GAIN_NAME
}

/** 深拷贝一条效果（不持有原对象里的数组/对象引用） */
function cloneEffect(effect: BuffEffect): BuffEffect {
  const clone: BuffEffect = {
    ...effect,
    teammateProfessions: effect.teammateProfessions?.slice(),
    skillTargets: effect.skillTargets?.map((item) => ({ ...item })),
    elementFilter: Array.isArray(effect.elementFilter) ? [...effect.elementFilter] : effect.elementFilter,
    convert: effect.convert ? { ...effect.convert } : undefined,
    conditions: effect.conditions?.damageTypes
      ? { damageTypes: [...effect.conditions.damageTypes] }
      : undefined,
    teamProfessionValues: effect.teamProfessionValues
      ? [...effect.teamProfessionValues]
      : effect.teamProfessionValues ?? null,
  }
  return clone
}

/** `applySlot` 的派生目标（Spec §3.1 第 7 项）：team → 'team'，数字 → 'self' */
function applyTargetOf(applySlot: ExtraBuffApplySlot): BuffEffect['applyTarget'] {
  return applySlot === 'team' ? 'team' : 'self'
}

/**
 * 卡片结构校验：恰好一行、无字段冲突、效果 id 唯一且与卡片 id 不同（Spec §3.1 第 4–5 项）。
 * 不通过返回原因文本，通过返回 null。
 */
function validateCardEffects(
  cardId: string,
  effects: readonly BuffEffect[],
): string | null {
  if (!effects.length) return 'effects 不能为空'
  const ids = new Set<string>()
  for (const effect of effects) {
    if (!effect.id) return '底层效果缺少 id'
    if (effect.id === cardId) return '底层效果 id 不能与卡片 id 相同'
    if (ids.has(effect.id)) return '底层效果 id 重复'
    ids.add(effect.id)
  }
  const rows = buildEffectRows(effects)
  if (rows.length !== 1) return `effects 必须聚成恰好一行（实际 ${rows.length} 行）`
  if (rows[0]!.issues.length) {
    return `同一卡片内的条件不一致：${rows[0]!.issues.map((item) => item.label).join(' / ')}`
  }
  return null
}

/**
 * 生成一张默认卡片（Spec §3.2 第 1 项）。
 *
 * 产物是**可编辑配置**：不承诺冗余字段已达到读取归一化后的形式；零值配置只在恢复时按共享规则处理。
 * 覆盖值不符合 Spec §3.1 时抛 `TypeError`，不静默丢弃配置后返回默认卡片。
 */
export function createExtraBuffGain(overrides: Partial<ExtraBuffGain> = {}): ExtraBuffGain {
  const id = typeof overrides.id === 'string' && overrides.id.trim() ? overrides.id.trim() : newGainId()
  const applySlot = overrides.applySlot === undefined ? 0 : readApplySlot(overrides.applySlot)
  if (applySlot == null) {
    throw new TypeError(`额外 Buff 的作用槽位非法：${String(overrides.applySlot)}`)
  }
  const sourceSlot = overrides.sourceSlot === undefined ? 0 : overrides.sourceSlot
  if (!isSlotIndex(sourceSlot)) {
    throw new TypeError(`额外 Buff 的来源槽位非法：${String(sourceSlot)}`)
  }

  const rawEffects = overrides.effects
  let effects: BuffEffect[]
  if (Array.isArray(rawEffects) && rawEffects.length) {
    effects = rawEffects.map((effect) =>
      createEmptyBuffEffect({
        ...effect,
        applyTarget: applyTargetOf(applySlot),
      }),
    )
  } else if (rawEffects != null && (!Array.isArray(rawEffects) || !rawEffects.length)) {
    throw new TypeError('额外 Buff 的 effects 必须是非空数组')
  } else {
    effects = [
      createEmptyBuffEffect({
        stat: 'dmgBonus',
        kind: 'fixed',
        value: 0,
        enabledDefault: true,
        applyTarget: applyTargetOf(applySlot),
      }),
    ]
  }

  const issue = validateCardEffects(id, effects)
  if (issue) throw new TypeError(`额外 Buff 结构不合法：${issue}`)

  return {
    id,
    name: normalizeGainName(overrides.name),
    applySlot,
    sourceSlot,
    effects,
  }
}

/**
 * 读取一条数据的归一化结果（Spec §3.2 第 2 项）。
 *
 * - 只接受**新结构**；旧扁平条目（顶层 stat/value）缺 effects → `null`（由上层计数丢弃）。
 * - 底层效果走共享 `normalizeBuffEffect`；它返回 null（例如零值倍率修正）则整卡无效。
 * - 已有的合法效果 id 保持不变；缺 id 由共享函数生成，不另加额外 Buff 专属拒绝规则。
 * - 不把非法槽位静默改成本次编辑角色。
 */
export function normalizeExtraGain(raw: unknown): ExtraBuffGain | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (!id) return null

  const applySlot = readApplySlot(entry.applySlot)
  if (applySlot == null) return null
  if (!isSlotIndex(entry.sourceSlot)) return null

  const rawEffects = entry.effects
  if (!Array.isArray(rawEffects) || !rawEffects.length) return null

  const effects: BuffEffect[] = []
  for (const item of rawEffects) {
    const normalized = normalizeBuffEffect(item)
    if (!normalized) return null
    effects.push({ ...normalized, applyTarget: applyTargetOf(applySlot) })
  }

  const issue = validateCardEffects(id, effects)
  if (issue) return null

  return {
    id,
    name: normalizeGainName(entry.name),
    applySlot,
    sourceSlot: entry.sourceSlot,
    effects,
  }
}

/**
 * 批量归一化（Spec §3.2 第 3 项）：保留合法条目的原顺序，逐张计数丢弃。
 * 后出现的重复卡片 id、跨卡片重复的效果 id，均整张丢弃并 +1。
 */
export function normalizeExtraGains(raw: unknown): {
  gains: ExtraBuffGain[]
  discardedCount: number
} {
  if (!Array.isArray(raw)) return { gains: [], discardedCount: 0 }
  const gains: ExtraBuffGain[] = []
  const cardIds = new Set<string>()
  const effectIds = new Set<string>()
  let discardedCount = 0
  for (const item of raw) {
    const gain = normalizeExtraGain(item)
    if (!gain || cardIds.has(gain.id)) {
      discardedCount += 1
      continue
    }
    const conflict = gain.effects.some((effect) => effectIds.has(effect.id))
    if (conflict) {
      discardedCount += 1
      continue
    }
    cardIds.add(gain.id)
    for (const effect of gain.effects) effectIds.add(effect.id)
    gains.push(gain)
  }
  return { gains, discardedCount }
}

/**
 * 序列化（Spec §3.2 第 4 项）：只做完整深拷贝。
 *
 * 不归一化、不清零冗余值、不丢弃零值卡片、不生成新 id、不改顺序、不截断精度。
 */
export function serializeExtraGains(gains: readonly ExtraBuffGain[]): ExtraBuffGain[] {
  return gains.map((gain) => ({
    id: gain.id,
    name: gain.name,
    applySlot: gain.applySlot,
    sourceSlot: gain.sourceSlot,
    effects: gain.effects.map((effect) => cloneEffect(effect)),
  }))
}

/** 受益槽位（Spec §3.2 第 5 项）：只读已归一化的 `applySlot` */
export function resolveExtraGainApplySlot(
  gain: Pick<ExtraBuffGain, 'applySlot'>,
): ExtraBuffApplySlot {
  return readApplySlot(gain?.applySlot) ?? 0
}

/** 该卡片是否作用于某个槽位（全队 = 0/1/2 全部命中） */
export function extraGainAppliesToSlot(
  gain: Pick<ExtraBuffGain, 'applySlot'>,
  slotIndex: number,
): boolean {
  const applySlot = resolveExtraGainApplySlot(gain)
  if (applySlot === 'team') return isSlotIndex(slotIndex)
  return applySlot === slotIndex
}

/**
 * 卡片 → 运行期效果（Spec §3.2 第 6 项）：每条底层效果一份深拷贝。
 * 统一派生 `applyTarget` 并打上 `extraGain` 标记；不写死 `kind`、不缩减条件。
 */
export function extraGainToEffects(gain: ExtraBuffGain): BuffEffect[] {
  const applySlot = resolveExtraGainApplySlot(gain)
  return gain.effects.map((effect) => ({
    ...cloneEffect(effect),
    applyTarget: applyTargetOf(applySlot),
    extraGain: true,
  }))
}
