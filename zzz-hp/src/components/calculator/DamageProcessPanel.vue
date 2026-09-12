<script setup lang="ts">
import DamageOwnerShareBlock from '@/components/calculator/DamageOwnerShareBlock.vue'
import DamageResultDetail from '@/components/calculator/DamageResultDetail.vue'
import type { DamageOwnerShareSummary } from '@/utils/damageEventOwner'
import type { DamageEnemyInput } from '@/utils/enemyResistance'
import type { OptimalEventEvalDetail } from '@/utils/optimalAffixAlloc'

/**
 * 计算过程面板：产生者占比 + 选中事件的乘区明细。
 *
 * 扫掠柱图与词条分配共用同一份实现，调用方只注入数据与口径，
 * 不重复维护 DamageResultDetail 的 30 余个入参。
 */
defineProps<{
  /** 是否处于招式流程模式（无事件时走空态提示） */
  hasEvents: boolean
  /** 产生者占比数据；为空显示空态 */
  summary: DamageOwnerShareSummary | null | undefined
  /** 未能计入总伤的事件 */
  skippedEvents?: Array<{ eventId: string; displayName: string; reason: string }>
  /** 当前选中事件的明细；为空提示点选 */
  detail: OptimalEventEvalDetail | null
  selectedEventId?: string | null
  totalLabel?: string
  hint?: string
  /** 无事件时的提示文案 */
  noEventsHint?: string
  enemyInput: DamageEnemyInput
  isMb: boolean
}>()

const emit = defineEmits<{
  'select-event': [eventId: string]
}>()
</script>

<template>
  <template v-if="hasEvents">
    <DamageOwnerShareBlock
      :summary="summary ?? { shares: [], grandTotal: 0 }"
      :selected-event-id="selectedEventId"
      :total-label="totalLabel"
      :skipped-events="skippedEvents"
      :hint="hint"
      @select-event="emit('select-event', $event)"
    />
    <DamageResultDetail
      v-if="detail"
      :calc-parts="detail.result"
      :final-panel="detail.finalPanel"
      :external-panel="detail.external"
      :sources="detail.breakdown.sources"
      :pierce-mod="detail.breakdown.totalMods.pierce"
      :pierce-power="detail.piercePower"
      :enemy-input="enemyInput"
      :is-mb="isMb"
      :show="detail.kind === 'direct' ? 'direct' : 'anomaly'"
      :anomaly-sub-kind="detail.anomalySubKind"
      :producer-final-panel="detail.producerFinalPanel"
      :producer-external-panel="detail.producerExternalPanel"
      :producer-sources="detail.producerBreakdown?.sources"
      :producer-agent-label="detail.producerAgentLabel"
      :bonus-final-panel="detail.bonusFinalPanel"
      :bonus-external-panel="detail.bonusExternalPanel"
      :bonus-sources="detail.bonusBreakdown?.sources"
      :defense-trigger-final-panel="detail.defenseTriggerFinalPanel"
      :defense-trigger-external-panel="detail.defenseTriggerExternalPanel"
      :defense-trigger-sources="detail.defenseTriggerBreakdown?.sources"
      :defense-trigger-agent-label="detail.defenseTriggerAgentLabel"
      :base-agent-label="detail.baseAgentLabel"
      :bonus-agent-label="detail.bonusAgentLabel"
      :mutation-agent-label="detail.mutationAgentLabel"
      :mutation-final-panel="detail.mutationFinalPanel"
      :mutation-external-panel="detail.mutationExternalPanel"
      :mutation-sources="detail.mutationSources"
      :remiel-self-atk-source-items="detail.remielSelfAtkSourceItems"
      :remiel-self-mastery-source-items="detail.remielSelfMasterySourceItems"
      :remiel-self-external-panel="detail.remielSelfExternalPanel"
      :remiel-self-sources="detail.remielSelfSources"
      :remiel-self-final-panel="detail.remielSelfFinalPanel"
      :remiel-is-mb="detail.remielIsMb"
    />
    <p v-else-if="summary || skippedEvents?.length" class="hint">
      在上方「产生者伤害占比」中点选事件，查看该事件的详细计算过程。
    </p>
    <p v-else class="hint">当前配置下暂无可用伤害事件，请检查产生角色与局外面板。</p>
  </template>
  <p v-else class="hint">{{ noEventsHint ?? '当前没有招式流程事件。' }}</p>
</template>

<style scoped>
.hint {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}
</style>
