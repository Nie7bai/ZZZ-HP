import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { ResolvedHit } from '@/utils/resolvedHit'
import { getHitSkipReason } from '@/utils/resolvedHit'
import { summarizeDamageByOwner } from '@/utils/damageEventOwner'
import {
  evaluateOptimalEventDetail,
  type OptimalEventEvalDetail,
  type OptimalEvalContext,
} from '@/utils/optimalAffixAlloc'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'

/** 计算过程页签的单条事件行 */
export interface DamageProcessEventRow {
  hit: ResolvedHit
  eventId: string
  displayName: string
  detail: OptimalEventEvalDetail | null
  skipReason: string | null
}

/** 计算过程数据源：由调用方提供「当前评估结果」与「纳入统计的事件 id」 */
export interface DamageProcessSource {
  /** 当前上下文（事件明细按它重算） */
  ctx: ComputedRef<OptimalEvalContext>
  /** 当前评估结果的局外面板；为空时按 ctx + counts 兜底 */
  external: ComputedRef<PanelStats | null | undefined>
  /** 总伤期望（产生者占比区顶部数值） */
  grandTotal: ComputedRef<number>
  /** 事件明细列表（用于推导占比与跳过原因） */
  eventLines: ComputedRef<Array<{ eventId: string; displayName: string; total: number; perHit: number }> | null | undefined>
  /**
   * 纳入统计的事件 id：
   * - `null` = 统计全部事件（词条分配模式：不按柱图事件集过滤）
   * - 数组（含空数组）= 只统计其中的事件；空数组即不统计任何事件
   */
  selectedEventIds: ComputedRef<readonly string[] | null> | Ref<string[] | null>,
  /** 总伤标题，如「异常伤害事件总伤期望」 */
  totalLabel: ComputedRef<string>
  /** 是否有招式流程事件 */
  hasEvents: ComputedRef<boolean>
  /** 本区是否处于激活状态（未激活时不做重算） */
  active: ComputedRef<boolean>
  /** 用于在切换子页签时按需重算 */
  enabled: ComputedRef<boolean>
  hits: ComputedRef<ResolvedHit[] | undefined>
  agents: ComputedRef<AgentBuffDoc[]>
  teamSlots: ComputedRef<TeamSlot[]>
  /** 从产生者占比点选事件后要切到的页签（可选） */
  onSelectEvent?: (eventId: string) => void
}

/**
 * 计算过程页签的数据源：产生者占比 + 事件明细。
 *
 * 扫掠柱图与词条分配两个模式共用同一套展示与统计口径，
 * 差异只在「纳入统计的事件集合」和「当前评估结果」由调用方注入。
 */
export function useDamageProcessEvents(source: DamageProcessSource) {
  const selectedEventId = ref<string | null>(null)

  const hitById = computed(() => new Map((source.hits.value ?? []).map((hit) => [hit.id, hit])))

  /** 纳入统计的事件 id 集合；null 表示全部事件 */
  const scopeIds = computed(() => {
    const ids = source.selectedEventIds.value
    if (ids == null) return null
    return new Set<string>(ids)
  })

  function inScope(eventId: string) {
    const scope = scopeIds.value
    return scope == null || scope.has(eventId)
  }

  function displayNameOf(hit: ResolvedHit) {
    const ownerName = source.agents.value.find((item) => item.id === hit.ownerAgentId)?.name
    return `${ownerName ? `${ownerName} · ` : ''}${hit.skill.name}`
  }

  function skipReasonOf(hit: ResolvedHit) {
    return getHitSkipReason(hit, {
      teamSlots: source.teamSlots.value,
      agents: source.agents.value,
    })
  }

  /** 事件明细行：仅在页签可见时重算 */
  const eventRows = computed((): DamageProcessEventRow[] => {
    if (!source.enabled.value || !source.active.value || !source.hasEvents.value) return []
    const ctx = source.ctx.value
    const external = source.external.value
    if (!ctx || !external) return []
    return (source.hits.value ?? [])
      .filter((hit) => inScope(hit.id))
      .map((hit) => {
        const skipReason = skipReasonOf(hit)
        return {
          hit,
          eventId: hit.id,
          displayName: displayNameOf(hit),
          detail: skipReason ? null : evaluateOptimalEventDetail(ctx, external, hit),
          skipReason,
        }
      })
  })

  watch(
    eventRows,
    (rows) => {
      const selectable = rows.filter((row) => row.detail)
      if (!selectable.length) {
        selectedEventId.value = null
        return
      }
      if (!selectable.some((row) => row.eventId === selectedEventId.value)) {
        selectedEventId.value = selectable[0]!.eventId
      }
    },
    { immediate: true },
  )

  const selectedRow = computed(
    () => eventRows.value.find((row) => row.eventId === selectedEventId.value) ?? null,
  )

  const selectedDetail = computed(() => selectedRow.value?.detail ?? null)

  /** 产生者伤害占比：只统计纳入口径的事件 */
  const ownerShareSummary = computed(() => {
    if (!source.hasEvents.value) return null
    const lines = source.eventLines.value
    if (!lines?.length) return null
    const scoped = lines.filter((line) => inScope(line.eventId))
    if (!scoped.length) return null
    const summary = summarizeDamageByOwner(
      scoped
        .map((line) => {
          const hit = hitById.value.get(line.eventId)
          if (!hit) return null
          return {
            ownerAgentId: hit.ownerAgentId,
            eventId: line.eventId,
            displayName: line.displayName,
            total: line.total,
            perHit: line.perHit,
            count: hit.count,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item != null),
      (id) => source.agents.value.find((item) => item.id === id),
    )
    return { ...summary, grandTotal: source.grandTotal.value }
  })

  /** 未能计入总伤的事件（缺双代理人等） */
  const skippedEvents = computed(() => {
    if (!source.hasEvents.value) return []
    const computedIds = new Set(
      (source.eventLines.value ?? [])
        .filter((line) => inScope(line.eventId))
        .map((line) => line.eventId),
    )
    return (source.hits.value ?? [])
      .filter((hit) => inScope(hit.id) && !computedIds.has(hit.id))
      .map((hit) => ({
        eventId: hit.id,
        displayName: displayNameOf(hit),
        reason: skipReasonOf(hit) ?? '无法计算',
      }))
  })

  function selectEvent(eventId: string) {
    const row = eventRows.value.find((item) => item.eventId === eventId)
    if (!row?.detail) return
    source.onSelectEvent?.(eventId)
    selectedEventId.value = eventId
  }

  return {
    selectedEventId,
    eventRows,
    selectedDetail,
    ownerShareSummary,
    skippedEvents,
    selectEvent,
  }
}
