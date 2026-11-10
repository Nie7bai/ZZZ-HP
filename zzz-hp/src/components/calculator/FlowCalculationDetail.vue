<script setup lang="ts">
import { buildEventValueTips } from '@/utils/eventDamageSourceTips'
import { computed } from 'vue'
import DamageResultDetail from '@/components/calculator/DamageResultDetail.vue'
import FlowZoneCalculation from '@/components/calculator/FlowZoneCalculation.vue'
import type { SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'
import { DAMAGE_EVENT_CRIT_MODE_OPTIONS } from '@/utils/damageEvent'
import { buildSkillBaseMultNote } from '@/utils/skillTalentLevels'
import { buildPipelineStageRows } from '@/zones/display'
import { getDamageChain } from '@/zones/pipeline'

const props = defineProps<{ calculation: SkillFlowCalculationDetail }>()
const sourceTips = computed(() => buildEventValueTips(props.calculation))
const detail = computed(() => props.calculation.evaluation)
const critModeLabel = computed(() =>
  DAMAGE_EVENT_CRIT_MODE_OPTIONS.find((mode) => mode.id === detail.value.hit.critMode)?.label,
)
const skillMultLevelNote = computed(() =>
  buildSkillBaseMultNote(detail.value.hit.skill, detail.value.hit.skillTalentLevel),
)
/** 计算合计：与招式流程详情同一套「期望 × 次数 = 合计」 */
const isAnomalyLine = computed(
  () => detail.value.kind !== 'direct' && detail.value.kind !== 'sharpen',
)
const damageSummary = computed(() => ({
  perHit: detail.value.perHit,
  count: detail.value.hit.count,
  total: detail.value.total,
}))

/** Phase 4d：完整计算链路（只读阶段视图，编辑仅在管理端） */
const pipelineStageRows = computed(() => buildPipelineStageRows(detail.value.result))
const pipelineChainLabel = computed(() => {
  const chainId = detail.value.result.pipeline?.chainId
  return (chainId && getDamageChain(chainId)?.label) || '完整计算链路'
})
const stageKindLabels: Record<string, string> = {
  source: '基础',
  multiplier: '乘数',
  combine: '合并',
  final: '结算',
}
</script>

<template>
  <section class="flow-calculation-detail" aria-label="本条流程计算过程">
    <p class="calculation-context">
      {{ detail.displayName }} · {{ detail.hit.staggerPhase === 'stagger' ? '失衡期' : '非失衡期' }}
      · {{ critModeLabel }}
      · 事件元素 {{ detail.eventElement ?? '待选择' }}
    </p>
    <FlowZoneCalculation
      :calculation="calculation"
      :summary="damageSummary"
      :group-by-actor="isAnomalyLine"
      :producer-label="detail.producerAgentLabel"
      :trigger-label="detail.defenseTriggerAgentLabel"
      empty-hint="本段计算过程暂不可用，请检查当前面板来源。"
    />
    <details class="pipeline-stages" open>
      <summary>{{ pipelineChainLabel }}</summary>
      <ol class="pipeline-stage-list">
        <li
          v-for="stage in pipelineStageRows"
          :key="stage.id"
          class="pipeline-stage"
          :class="`pipeline-stage--${stage.kind}`"
        >
          <span class="pipeline-stage-kind">{{ stageKindLabels[stage.kind] ?? stage.kind }}</span>
          <span class="pipeline-stage-label">{{ stage.label }}</span>
          <span class="pipeline-stage-value">{{ stage.valueText }}</span>
        </li>
      </ol>
    </details>
    <details class="calculation-more">
      <summary>完整公式与来源</summary>
      <p class="calculation-hint">悬停、聚焦或轻触公式中的数值，可查看计算组成与增益来源。</p>
      <DamageResultDetail
      :source-tips="sourceTips"
      :calc-parts="detail.result"
      :damage-input-usages="detail.damageInputUsages"
      :final-panel="detail.finalPanel"
      :external-panel="detail.external"
      :sources="detail.breakdown.sources"
      :pierce-mod="detail.breakdown.totalMods.pierce"
      :pierce-power="detail.piercePower"
      :enemy-input="calculation.enemyInput"
      :is-mb="calculation.isMb"
      :show="detail.kind === 'direct' || detail.kind === 'sharpen' ? 'direct' : 'anomaly'"
      :crit-mode="detail.hit.critMode"
      :anomaly-sub-kind="detail.anomalySubKind"
      :producer-final-panel="detail.producerFinalPanel"
      :producer-external-panel="detail.producerExternalPanel"
      :producer-sources="detail.producerBreakdown?.sources"
      :producer-agent-label="detail.producerAgentLabel"
      :bonus-final-panel="detail.bonusFinalPanel"
      :bonus-external-panel="detail.bonusExternalPanel"
      :bonus-sources="detail.bonusBreakdown?.sources"
      :skill-mult-level-note="skillMultLevelNote"
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
    </details>
  </section>
</template>

<style scoped>
.flow-calculation-detail {
  --calc-border: #d5dae3;
  --calc-text: #1c212a;
  --calc-muted: #697588;
  --calc-surface: #f8fafc;
  --calc-surface-2: #f1efe9;
  min-width: 0;
  padding: 0.85rem;
  border: 1px solid var(--calc-border, var(--color-border));
  border-radius: 8px;
  color: var(--calc-text, var(--color-text));
  background: var(--calc-surface, var(--color-background));
  font-weight: 400;
}
.flow-calculation-detail :deep(.formula-aligned-body) {
  flex-wrap: wrap;
  overflow-x: visible;
}
:global([data-theme='dark'] .flow-calculation-detail) {
  --calc-border: #2a2f37;
  --calc-text: #e8eaed;
  --calc-muted: #9aa3b0;
  --calc-surface: #171c26;
  --calc-surface-2: rgba(0, 0, 0, 0.25);
}
.calculation-context,
.calculation-hint {
  margin: 0 0 0.5rem;
  color: var(--calc-muted, var(--color-text));
  font-size: 0.8rem;
  line-height: 1.6;
}
.calculation-total {
  margin: 0 0 0.55rem;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}
.calculation-more {
  margin-top: 0.6rem;
  border-top: 1px dashed color-mix(in srgb, var(--color-border) 60%, transparent);
  padding-top: 0.45rem;
}
.calculation-more > summary {
  cursor: pointer;
  font-size: 0.74rem;
  color: var(--color-text-muted, #9aa3b0);
  list-style: none;
}
.calculation-more > summary::before {
  content: '▸ ';
}
.calculation-more[open] > summary::before {
  content: '▾ ';
}
.pipeline-stages {
  margin-top: 0.6rem;
  border-top: 1px dashed color-mix(in srgb, var(--color-border) 60%, transparent);
  padding-top: 0.45rem;
}
.pipeline-stages > summary {
  cursor: pointer;
  font-size: 0.74rem;
  color: var(--color-text-muted, #9aa3b0);
  list-style: none;
}
.pipeline-stages > summary::before {
  content: '▾ 完整计算链路 · ';
}
.pipeline-stage-list {
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.pipeline-stage {
  display: grid;
  grid-template-columns: 3.4rem minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: baseline;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}
.pipeline-stage-kind {
  color: var(--color-text-muted, #9aa3b0);
  font-size: 0.64rem;
}
.pipeline-stage--final {
  font-weight: 700;
}
.pipeline-stage--final .pipeline-stage-value {
  color: var(--color-accent, #7cc4ff);
}
</style>