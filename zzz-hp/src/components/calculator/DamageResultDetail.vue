<script setup lang="ts">
import type { ValueTipsKey } from '@/utils/eventDamageSourceTips'
import { computed } from 'vue'
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import DirectDamageFormulaAligned from '@/components/calculator/DirectDamageFormulaAligned.vue'
import type { PanelStats } from '@/types/calculatorPanel'
import type { DamageCalcResult } from '@/utils/damageCalc'
import type { EventDamageInputUsage } from '@/utils/panelBuffCalc'
import type { BuffModSource } from '@/utils/panelBuffCalc'
import { type StatSourceGroup } from '@/utils/statSourceTips'

import { formatCalcPlain } from '@/utils/calcNumberFormat'
import {
  buildAlignedAnomalyFormulaGroups,
  resolveAnomalyBaseWithMutation,
  type AnomalyFormulaAgentLabels,
} from '@/utils/anomalyFormulaDisplay'
import { buildAlignedDirectFormulaGroup } from '@/utils/directDamageDisplay'
import { staggerZoneLabel } from '@/utils/skillCalcZones'

import type { DamageEventCritMode } from '@/types/calculator'
import { DAMAGE_EVENT_CRIT_MODE_OPTIONS } from '@/utils/damageEvent'

const props = defineProps<{
  sourceTips: Record<ValueTipsKey, StatSourceGroup[]>
  calcParts: DamageCalcResult
  /**
   * 本事件实际采用了哪些面板字段（计算链路收敛 Spec §2.5 第 5 项）。
   * 提供时不再由本组件按伤害子类推断「该解释哪位角色」；缺省时退回旧推断（兼容未迁移的调用点）。
   */
  damageInputUsages?: EventDamageInputUsage[]
  finalPanel: PanelStats
  externalPanel: PanelStats
  sources: BuffModSource[]
  pierceMod: number
  piercePower: number
  enemyInput: {
    defense: number
    vulnerableMultiplier: number
    staggerMultiplier: number
    specialMultiplier: number
    level: number
    resistanceType?: import('@/utils/enemyResistance').EnemyResistanceType
    elementResistance?: import('@/utils/enemyResistance').ElementResistanceMap
  }
  isMb: boolean
  /** direct=通用乘区+直伤；anomaly=通用乘区+异常子类 */
  show: 'direct' | 'anomaly'
  critMode?: DamageEventCritMode
  anomalySubKind?: import('@/types/calculator').AnomalyDamageSubKind
  /** 紊乱/乱流：产生角色面板（用于倍率区来源提示） */
  producerFinalPanel?: PanelStats
  producerExternalPanel?: PanelStats
  producerSources?: BuffModSource[]
  producerAgentLabel?: string
  /** 异常基础乘区角色名 */
  baseAgentLabel?: string
  /** 增伤/倍率乘区角色名（招式持有者或异常类触发者） */
  bonusAgentLabel?: string
  /** 异化系数区角色名（蕾米埃尔） */
  mutationAgentLabel?: string
  /** 蕾米埃尔局内最终面板（异化系数来源） */
  mutationFinalPanel?: PanelStats
  mutationExternalPanel?: PanelStats
  mutationSources?: BuffModSource[]
  /** 本人耀变局内攻/精逐条来源 */
  remielSelfAtkSourceItems?: string[]
  remielSelfMasterySourceItems?: string[]
  remielSelfExternalPanel?: PanelStats
  remielSelfSources?: BuffModSource[]
  remielSelfFinalPanel?: PanelStats
  remielIsMb?: boolean
  /** 类型增伤/倍率面板（属性异常/异放/耀变=异常类触发者；缺省回落 finalPanel） */
  bonusFinalPanel?: PanelStats
  bonusExternalPanel?: PanelStats
  bonusSources?: BuffModSource[]
  /** 耀变倍率来源标注（招式 · 等级公式，如「普通攻击 Lv.16：200% + 10% × 16 = 360%」） */
  skillMultLevelNote?: string | null
  /** 减防/无视防御 tip（紊乱/乱流等：异常类触发者；缺省时属性异常/异放/耀变回落 bonus） */
  defenseTriggerFinalPanel?: PanelStats
  defenseTriggerExternalPanel?: PanelStats
  defenseTriggerSources?: BuffModSource[]
  defenseTriggerAgentLabel?: string
}>()

const anomalySubKind = computed(() => props.anomalySubKind ?? 'attributeAnomaly')
const critMode = computed(() => props.critMode ?? 'expected')
const critModeLabel = computed(() =>
  DAMAGE_EVENT_CRIT_MODE_OPTIONS.find((mode) => mode.id === critMode.value)?.label ?? '期望',
)

function formatNumber(v: number) {
  return Math.round(v).toLocaleString('en-US')
}






const displayVulnerableMultiplier = computed(() =>
  props.show === 'anomaly'
    ? props.calcParts.anomalyVulnerableMultiplier
    : props.calcParts.directVulnerableMultiplier,
)





const anomalyBaseWithMutation = computed(() => resolveAnomalyBaseWithMutation(props.calcParts))





interface AlignedFormulaTerm {
  label: string
  value: string
  tipsKey: ValueTipsKey
  /** 因子的实际输入方身份（与组标题不同时才标），如「异常类触发者 · 菲欧妮」 */
  ownerLabel?: string
}

type AlignedFormulaResultKey =
  | 'generalMultiplier'
  | 'directDamageExpected'
  | 'anomalyBaseExpected'
  | 'attributeAnomalyExpected'
  | 'anomalyReleaseExpected'
  | 'disorderExpected'
  | 'turbulenceExpected'
  | 'radianceExpected'

interface AlignedFormulaGroup {
  key: AlignedFormulaResultKey
  title: string
  hint?: string
  agentLabel?: string
  terms: AlignedFormulaTerm[]
  result: string
}

const alignedGeneralFormula = computed((): AlignedFormulaGroup => {
  const p = props.calcParts
  return {
    key: 'generalMultiplier',
    title: '公式',
    terms: [
      { label: '基础伤害', value: formatCalcPlain(p.baseDamage, 2), tipsKey: 'baseDamage' },
      { label: '增伤区', value: formatCalcPlain(p.dmgMultiplier), tipsKey: 'dmgMultiplier' },
      { label: '防御区', value: formatCalcPlain(p.defenseMultiplier), tipsKey: 'defenseMultiplier' },
      { label: '抗性区', value: formatCalcPlain(p.resistanceMultiplier), tipsKey: 'resistanceMultiplier' },
      { label: staggerZoneLabel(p), value: formatCalcPlain(p.staggerMultiplier), tipsKey: 'staggerMultiplier' },
    ],
    // 结果（蓝色加粗）与下面两行同口径：取整 + 千分号
    result: formatNumber(p.generalMultiplier),
  }
})

const alignedDirectFormula = computed(() =>
  buildAlignedDirectFormulaGroup(props.calcParts, formatCalcPlain, formatNumber, undefined, critMode.value),
)

const anomalyFormulaLabels = computed((): AnomalyFormulaAgentLabels => ({
  baseAgent: props.baseAgentLabel ?? props.producerAgentLabel,
  bonusAgent: props.bonusAgentLabel,
  mutationAgent: props.mutationAgentLabel,
}))

const alignedAnomalyFormulas = computed((): AlignedFormulaGroup[] =>
  buildAlignedAnomalyFormulaGroups(
    props.calcParts,
    anomalySubKind.value,
    props.calcParts.hasPolarDisorder ? '极性紊乱' : '紊乱伤害',
    formatCalcPlain,
    formatNumber,
    anomalyFormulaLabels.value,
    critMode.value,
  ) as AlignedFormulaGroup[],
)

const valueTips = computed(() => props.sourceTips)
/** 公式的结果与暴击乘区按本条结算口径解释；其余来源沿用完整面板明细。 */
const formulaValueTips = computed(() => {
  const tips = { ...valueTips.value }
  const direct = alignedDirectFormula.value
  const groups = props.show === 'direct' ? [direct] : alignedAnomalyFormulas.value
  for (const group of groups) {
    const segments = group === direct && direct.sumMultZones?.length
      ? direct.sumMultZones.map((zone) => [...direct.terms, zone])
      : [group.terms]
    tips[group.key] = [{
      label: group.key === 'anomalyBaseExpected' ? '异常基础计算' : `本条公式（${critModeLabel.value}）`,
      items: [
        segments.map((terms) => terms.map((term) => `${term.label} ${term.value}`).join(' × ')).join(' + '),
        `= ${group.result}`,
      ],
    }]
    for (const term of group.terms) {
      if (term.tipsKey === 'critMultiplier' || term.tipsKey.endsWith('CritZone')) {
        const key = term.tipsKey as ValueTipsKey
        tips[key] = [
          { label: '本条结算', items: [`${critModeLabel.value}：${term.label} = ${term.value}`] },
          ...valueTips.value[key],
        ]
      }
    }
  }
  return tips
})
</script>

<template>
  <div class="damage-result-detail">
    <h3 v-if="!calcParts.remielSelfRadianceActive" class="result-section-title">通用乘区 · 中间结果</h3>
    <p v-else class="result-subtotal">蕾米埃尔本人耀变不使用通用乘区，异常基础见下方公式。</p>
    <div v-if="!calcParts.remielSelfRadianceActive" class="formula-block formula-block--aligned">
      <div class="formula-aligned-group">
        <span class="formula-label formula-aligned-title">{{ alignedGeneralFormula.title }}</span>
        <div class="formula-aligned-body">
          <template
            v-for="(term, index) in alignedGeneralFormula.terms"
            :key="`general-${term.label}`"
          >
            <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
            <div class="formula-aligned-term formula-aligned-term--inline">
              <span class="formula-aligned-term-label">{{ term.label }}</span>
              <span class="formula-aligned-term-value">
                <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey]" />
              </span>
            </div>
          </template>
          <span class="formula-aligned-op" aria-hidden="true">→</span>
          <div class="formula-aligned-result">
            <StatValueWithSources
              :value="alignedGeneralFormula.result"
              :groups="valueTips[alignedGeneralFormula.key]"
            />
          </div>
        </div>
      </div>
    </div>
    <details v-if="!calcParts.remielSelfRadianceActive" class="calculation-parameters">
      <summary>通用乘区明细</summary>
      <div class="result-grid">
      <p>基础伤害（局内）：<StatValueWithSources :value="formatCalcPlain(calcParts.baseDamage, 2)" :groups="valueTips.baseDamage" /></p>
      <p>增伤区：<StatValueWithSources :value="formatCalcPlain(calcParts.dmgMultiplier)" :groups="valueTips.dmgMultiplier" /></p>
      <p>防御区：<StatValueWithSources :value="formatCalcPlain(calcParts.defenseMultiplier)" :groups="valueTips.defenseMultiplier" /></p>
      <p>抗性区：<StatValueWithSources :value="formatCalcPlain(calcParts.resistanceMultiplier)" :groups="valueTips.resistanceMultiplier" /></p>
      <p>易伤区（含增益）：<StatValueWithSources :value="formatCalcPlain(displayVulnerableMultiplier)" :groups="valueTips.vulnerableMultiplier" /></p>
      <p>{{ staggerZoneLabel(calcParts) }}（含增益）：<StatValueWithSources :value="formatCalcPlain(calcParts.staggerMultiplier)" :groups="valueTips.staggerMultiplier" /></p>
      <p class="result-subtotal">通用乘区：<StatValueWithSources :value="formatNumber(calcParts.generalMultiplier)" :groups="valueTips.generalMultiplier" /></p>
      </div>
    </details>

    <template v-if="show === 'direct'">
      <h3 class="result-section-title">{{ calcParts.useSharpenFormula ? '锐化' : '直伤' }}伤害 · {{ critModeLabel }}</h3>
      <div class="formula-block formula-block--aligned">
        <DirectDamageFormulaAligned
          :group="alignedDirectFormula"
          :value-tips="formulaValueTips"
        />
      </div>
      <details class="calculation-parameters">
        <summary>直伤乘区明细与期望值</summary>
        <div class="result-grid">
        <p>暴击率（计入上限 {{ calcParts.useSharpenFormula ? '2' : '1' }}）：<StatValueWithSources :value="formatCalcPlain(calcParts.critRateRatio)" :groups="valueTips.critRateRatio" /></p>
        <p>{{ calcParts.useSharpenFormula ? '锐爆区' : '暴击区' }}：<StatValueWithSources :value="formatCalcPlain(calcParts.critMultiplier)" :groups="valueTips.critMultiplier" /></p>
        <p>特殊乘区（含增益）：<StatValueWithSources :value="formatCalcPlain(calcParts.specialMultiplier)" :groups="valueTips.specialMultiplier" /></p>
        <p>直伤倍率区：<StatValueWithSources :value="formatCalcPlain(calcParts.directDmgMultZone)" :groups="valueTips.directDmgMultZone" /></p>
        <p v-if="calcParts.settlementDmgMultZone > 0">
          决算倍率区：<StatValueWithSources :value="formatCalcPlain(calcParts.settlementDmgMultZone)" :groups="valueTips.settlementDmgMultZone" />
        </p>
        <p>穿透率（计入）：<StatValueWithSources :value="formatCalcPlain(calcParts.penRateRatio)" :groups="valueTips.penRateRatio" /></p>
        <p>有效防御项：<StatValueWithSources :value="formatCalcPlain(calcParts.effectiveDefense)" :groups="valueTips.effectiveDefense" /></p>
        <p>贯穿力（局内）：<StatValueWithSources :value="Math.round(piercePower).toLocaleString('en-US')" :groups="valueTips.piercePower" /></p>
        <p class="result-total">直伤期望伤害：<StatValueWithSources :value="Math.round(calcParts.directDamageExpected).toLocaleString('en-US')" :groups="valueTips.directDamageExpected" /></p>
        </div>
      </details>
    </template>

    <template v-else>
      <h3 class="result-section-title">异常类伤害 · {{ critModeLabel }}</h3>
      <div class="formula-block formula-block--aligned">
        <div
          v-for="group in alignedAnomalyFormulas"
          :key="group.key"
          class="formula-aligned-group"
        >
          <span class="formula-label formula-aligned-title">
            <span v-if="group.agentLabel" class="formula-agent-label">{{ group.agentLabel }} · </span>
            {{ group.title }}
            <span v-if="group.hint" class="formula-aligned-hint">{{ group.hint }}</span>
          </span>
          <div class="formula-aligned-body">
            <template v-for="(term, index) in group.terms" :key="`${group.key}-${term.label}`">
              <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
              <div class="formula-aligned-term">
                <span class="formula-aligned-term-label">{{ term.label }}</span>
                <span class="formula-aligned-term-value">
                  <StatValueWithSources :value="term.value" :groups="formulaValueTips[term.tipsKey]" />
                </span>
                <span v-if="term.ownerLabel" class="formula-term-owner">{{ term.ownerLabel }}</span>
              </div>
            </template>
            <span class="formula-aligned-op" aria-hidden="true">→</span>
            <div class="formula-aligned-result">
              <StatValueWithSources :value="group.result" :groups="formulaValueTips[group.key]" />
            </div>
          </div>
        </div>
      </div>
      <details class="calculation-parameters">
        <summary>异常乘区明细与暴击对照</summary>
        <div class="result-grid">
        <h4 class="result-subsection-title">异常基础期望</h4>
        <p>精通区：<StatValueWithSources :value="formatCalcPlain(calcParts.masteryZone)" :groups="valueTips.masteryZone" /></p>
        <p>等级区：<StatValueWithSources :value="formatCalcPlain(calcParts.levelZone)" :groups="valueTips.levelZone" /></p>
        <p v-if="calcParts.mutationZone > 1">
          异化系数区：
          <StatValueWithSources :value="formatCalcPlain(calcParts.mutationZone)" :groups="valueTips.mutationZone" />
        </p>
        <p class="result-total">异常基础期望：<StatValueWithSources :value="Math.round(anomalyBaseWithMutation).toLocaleString('en-US')" :groups="valueTips.anomalyBaseExpected" /></p>

        <template v-if="anomalySubKind === 'attributeAnomaly'">
        <h4 class="result-subsection-title">属性异常伤害</h4>
        <p>属性异常增伤区：<StatValueWithSources :value="formatCalcPlain(calcParts.attributeAnomalyDmgBonusZone)" :groups="valueTips.attributeAnomalyDmgBonusZone" /></p>
        <p>属性异常倍率区：<StatValueWithSources :value="formatCalcPlain(calcParts.attributeAnomalyMultZone)" :groups="valueTips.attributeAnomalyMultZone" /></p>
        <p>属性异常暴击区（暴击率=0）：1</p>
        <p>属性异常暴击区（暴击率=1）：<StatValueWithSources :value="formatCalcPlain(calcParts.attributeAnomalyFullCritZone)" :groups="valueTips.attributeAnomalyCritZone" /></p>
        <p class="result-total">属性异常伤害（暴击率=0）：<StatValueWithSources :value="formatNumber(calcParts.attributeAnomalyExpectedNoCrit)" :groups="valueTips.attributeAnomalyExpected" /></p>
        <p class="result-total">属性异常伤害（暴击率=1）：<StatValueWithSources :value="formatNumber(calcParts.attributeAnomalyExpectedFullCrit)" :groups="valueTips.attributeAnomalyExpected" /></p>
        </template>

        <template v-else-if="anomalySubKind === 'disorder'">
        <h4 class="result-subsection-title">紊乱期望伤害</h4>
        <p>紊乱基础倍率：<StatValueWithSources :value="formatCalcPlain(calcParts.disorderBaseMultRatio)" :groups="valueTips.disorderBaseMult" /></p>
        <p>异常持续时间(有效)：<StatValueWithSources :value="formatCalcPlain(calcParts.effectiveAnomalyDuration)" :groups="valueTips.anomalyDuration" /></p>
        <p>紊乱补偿倍率：<StatValueWithSources :value="formatCalcPlain(calcParts.disorderCompMultRatio)" :groups="valueTips.disorderCompMult" /></p>
        <p>紊乱倍率区：<StatValueWithSources :value="formatCalcPlain(calcParts.disorderZone)" :groups="valueTips.disorderZone" /></p>
        <p>紊乱增伤区：<StatValueWithSources :value="formatCalcPlain(calcParts.disorderDmgBonusZone)" :groups="valueTips.disorderDmgBonusZone" /></p>
        <p>紊乱暴击区（暴击率=0）：1</p>
        <p>紊乱暴击区（暴击率=1）：<StatValueWithSources :value="formatCalcPlain(calcParts.disorderFullCritZone)" :groups="valueTips.disorderCritZone" /></p>
        <p class="result-total">紊乱伤害（暴击率=0）：<StatValueWithSources :value="formatNumber(calcParts.disorderExpectedNoCrit)" :groups="valueTips.disorderExpected" /></p>
        <p class="result-total">紊乱伤害（暴击率=1）：<StatValueWithSources :value="formatNumber(calcParts.disorderExpectedFullCrit)" :groups="valueTips.disorderExpected" /></p>
        <p class="result-total">紊乱期望伤害：<StatValueWithSources :value="Math.round(calcParts.disorderExpected).toLocaleString('en-US')" :groups="valueTips.disorderExpected" /></p>
        </template>

        <template v-else-if="anomalySubKind === 'turbulence'">
        <h4 class="result-subsection-title">乱流伤害</h4>
        <p>乱流基础倍率：<StatValueWithSources :value="formatCalcPlain(calcParts.turbulenceBaseMultRatio)" :groups="valueTips.turbulenceBaseMult" /></p>
        <p>异常持续时间(有效)：<StatValueWithSources :value="formatCalcPlain(calcParts.effectiveAnomalyDuration)" :groups="valueTips.anomalyDuration" /></p>
        <p>乱流补偿倍率：<StatValueWithSources :value="formatCalcPlain(calcParts.turbulenceCompMultRatio)" :groups="valueTips.turbulenceCompMult" /></p>
        <p>乱流倍率区：<StatValueWithSources :value="formatCalcPlain(calcParts.turbulenceZone)" :groups="valueTips.turbulenceZone" /></p>
        <p>
          乱流增伤区：<StatValueWithSources
            :value="formatCalcPlain(calcParts.turbulenceDmgBonusZone)"
            :groups="valueTips.turbulenceDmgBonusZone"
          />
        </p>
        <p>乱流暴击区（暴击率=0）：1</p>
        <p>乱流暴击区（暴击率=1）：<StatValueWithSources :value="formatCalcPlain(calcParts.turbulenceFullCritZone)" :groups="valueTips.turbulenceCritZone" /></p>
        <p class="result-total">乱流伤害（暴击率=0）：<StatValueWithSources :value="formatNumber(calcParts.turbulenceExpectedNoCrit)" :groups="valueTips.turbulenceExpected" /></p>
        <p class="result-total">乱流伤害（暴击率=1）：<StatValueWithSources :value="formatNumber(calcParts.turbulenceExpectedFullCrit)" :groups="valueTips.turbulenceExpected" /></p>
        </template>

        <template v-else-if="anomalySubKind === 'anomalyRelease'">
        <h4 class="result-subsection-title">异放伤害</h4>
        <p>
          异放增伤区：
          <StatValueWithSources
            :value="formatCalcPlain(calcParts.anomalyReleaseDmgBonusZone)"
            :groups="valueTips.anomalyReleaseDmgBonusZone"
          />
        </p>
        <p>
          异放倍率区：
          <StatValueWithSources
            :value="formatCalcPlain(calcParts.anomalyReleaseMultZone)"
            :groups="valueTips.anomalyReleaseMultZone"
          />
        </p>
        <p>
          异放暴击区公式：1 + ({{ formatCalcPlain(calcParts.anomalyReleaseCritRateRatio ?? 0) }})
          × ({{ formatCalcPlain(calcParts.anomalyReleaseCritDmgRatio ?? 0) }})
        </p>
        <p>异放暴击区（暴击率=0）：1</p>
        <p>
          异放暴击区（暴击率=1）：
          <StatValueWithSources
            :value="formatCalcPlain(calcParts.anomalyReleaseFullCritZone)"
            :groups="valueTips.anomalyReleaseCritZone"
          />
        </p>
        <p class="result-total">
          异放伤害（暴击率=0）：
          <StatValueWithSources
            :value="formatNumber(calcParts.anomalyReleaseExpectedNoCrit)"
            :groups="valueTips.anomalyReleaseExpected"
          />
        </p>
        <p class="result-total">
          异放伤害（暴击率=1）：
          <StatValueWithSources
            :value="formatNumber(calcParts.anomalyReleaseExpectedFullCrit)"
            :groups="valueTips.anomalyReleaseExpected"
          />
        </p>
        </template>

        <template v-else-if="anomalySubKind === 'radiance'">
        <h4 class="result-subsection-title">耀变伤害</h4>
        <p>
          耀变增伤区：
          <StatValueWithSources
            :value="formatCalcPlain(calcParts.radianceDmgBonusZone)"
            :groups="valueTips.radianceDmgBonusZone"
          />
        </p>
        <p>
          耀变倍率区：
          <StatValueWithSources
            :value="formatCalcPlain(calcParts.radianceMultZone)"
            :groups="valueTips.radianceMultZone"
          />
        </p>
        <p>耀变暴击区（暴击率=0）：1</p>
        <p>
          耀变暴击区（暴击率=1）：
          <StatValueWithSources
            :value="formatCalcPlain(calcParts.radianceFullCritZone)"
            :groups="valueTips.radianceCritZone"
          />
        </p>
        <p class="result-total">
          耀变伤害（暴击率=0）：
          <StatValueWithSources
            :value="formatNumber(calcParts.radianceExpectedNoCrit)"
            :groups="valueTips.radianceExpected"
          />
        </p>
        <p class="result-total">
          耀变伤害（暴击率=1）：
          <StatValueWithSources
            :value="formatNumber(calcParts.radianceExpectedFullCrit)"
            :groups="valueTips.radianceExpected"
          />
        </p>
        <p class="result-total">
          耀变期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.radianceExpected)"
            :groups="valueTips.radianceExpected"
          />
        </p>
        </template>
        </div>
      </details>
    </template>
  </div>
</template>

<style scoped>
.damage-result-detail {
  --calc-formula-result-color: #3c82af;
  --calc-formula-result-font-size: 1.25rem;
  display: flex;
  flex-direction: column;
}

.calculation-parameters {
  margin: 0.4rem 0;
  font-size: 0.8rem;
  color: var(--calc-text, #1c212a);
}
.calculation-parameters > summary {
  cursor: pointer;
  color: var(--calc-muted, #697588);
}

/* ===== 标题层：墨色、字重对比（editorial 风格） ===== */
.result-section-title {
  margin: 0.9rem 0 0.5rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--calc-text, #1c212a);
  letter-spacing: 0.01em;
}

.result-section-title:first-child {
  margin-top: 0.1rem;
}

.result-subsection-title {
  grid-column: 1 / -1;
  margin: 0.75rem 0 0.25rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--calc-text, #1c212a);
}

.result-subsection-title:first-child {
  margin-top: 0;
}

/* ===== 公式卡片：白底 + 1px 细边框 + 大方角；宽度按内容自适应（右端不撑满） ===== */
.formula-block {
  display: flex;
  flex-direction: column;
  font-size: 1rem;
  gap: 0.35rem;
  margin: 0.35rem 0 0.6rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 8px;
  background: var(--calc-surface-2, #f1efe9);
  width: fit-content;
  max-width: 100%;
}

.formula-label {
  display: inline-block;
  min-width: 6.5em;
  margin-right: 0.22rem;
  color: var(--calc-text, #1c212a);
  font-weight: 700;
}

.formula-block--aligned {
  gap: 0;
}

/* 公式组：左 label 列 + 右公式行，垂直居中（列间距收紧） */
.formula-aligned-group {
  display: grid;
  grid-template-columns: 6.95em minmax(0, 1fr);
  gap: 0.5rem 0.3rem;
  padding: 0.6rem 0;
  align-items: center;
}

.formula-aligned-group + .formula-aligned-group {
  border-top: 1px solid var(--calc-border, #d5dae3);
}

.formula-agent-label {
  color: var(--calc-text, #1c212a);
  font-weight: 600;
}

/* 单个因子的输入方身份：比组标题小一号，避免抢主标题 */
.formula-term-owner {
  display: block;
  font-size: 0.66rem;
  font-weight: 400;
  line-height: 1.25;
  opacity: 0.78;
  white-space: nowrap;
  text-align: center;
}

.formula-aligned-title {
  margin: 0;
  line-height: 1.45;
}

/* 公式行：术语与值并排（与直伤期望公式同风格），一行放不下横向滚动 */
.formula-aligned-body {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 0.1rem;
}

.formula-aligned-term {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 4.2em;
}

.formula-aligned-term--inline {
  display: inline-flex;
  flex-direction: row;
  align-items: baseline;
  gap: 0.28rem;
  flex-shrink: 0;
}

.formula-aligned-term-label {
  font-size: inherit;
  line-height: 1.35;
  color: var(--calc-text, #1c212a);
  text-align: center;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.formula-aligned-hint {
  display: block;
  margin-top: 0.15rem;
  color: var(--calc-text, #1c212a);
  font-size: 0.68rem;
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
}

.formula-aligned-term-value {
  font-size: inherit;
  line-height: 1.4;
  color: var(--calc-text, #1c212a);
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.formula-aligned-term-value :deep(.stat-value > strong) {
  color: var(--calc-text, #1c212a);
  font-weight: 600;
}

.formula-aligned-op {
  flex: 0 0 auto;
  align-self: center;
  color: var(--calc-text, #1c212a);
  font-size: inherit;
}

.formula-aligned-result {
  flex: 0 0 auto;
  align-self: center;
  font-size: var(--calc-formula-result-font-size);
  font-weight: 700;
  color: var(--calc-formula-result-color);
  font-variant-numeric: tabular-nums;
}

.damage-result-detail :deep(.formula-aligned-result .stat-value > strong) {
  font-weight: inherit;
  border-bottom-color: color-mix(in srgb, currentColor 55%, transparent);
}

/* 参数表里的汇总/结果行与公式结果同色（用户 2026-10-22：蓝字加粗、不要金色） */
.damage-result-detail :deep(.result-total .stat-value > strong),
.damage-result-detail :deep(.result-subtotal .stat-value > strong) {
  font-weight: inherit;
  border-bottom-color: color-mix(in srgb, currentColor 55%, transparent);
}

/* ===== 参数表：两列（参数名称左对齐 | 数值右对齐），每行一项，行分隔线 ===== */
.result-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
  margin-top: 0.5rem;
  font-size: 0.82rem;
  color: var(--calc-text, #1c212a);
}

.result-grid p {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 0.6rem;
  margin: 0;
  padding: 0.3rem 0.1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--calc-border, #d5dae3) 55%, transparent);
}

.result-grid p > :last-child {
  flex-shrink: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 汇总行：整行跨列 + 上边框强调 + 结果加粗高亮（与公式结果同色，不再用金色） */
.result-total {
  grid-column: 1 / -1;
  margin-top: 0.45rem !important;
  border-top: 1px solid var(--calc-border, #d5dae3);
  border-bottom: none !important;
  padding-top: 0.55rem;
  font-weight: 700;
  color: var(--calc-formula-result-color);
}

.result-subtotal {
  grid-column: 1 / -1;
  margin-top: 0.3rem !important;
  border-top: 1px dashed var(--calc-border, #d5dae3);
  border-bottom: none !important;
  padding-top: 0.45rem;
  font-weight: 700;
  color: var(--calc-formula-result-color);
}

@media (max-width: 980px) {
  .result-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .result-grid {
    grid-template-columns: 1fr;
  }

  .formula-aligned-body {
    flex-wrap: wrap;
    gap: 0.35rem;
  }
}


/* 暗夜模式：组件根重定义 --calc-*（照抄仓库既有约定：AffixBenefitTable 的 benefit-workbench 写法） */
:global([data-theme='dark'] .damage-result-detail) {
  --calc-formula-result-color: #8fc9ee;
  --calc-surface-2: rgba(0, 0, 0, 0.25);
  --calc-border: #2a2f37;
  --calc-text: #e8eaed;
  --calc-muted: #9aa3b0;
  --calc-input-bg: #171a1f;
  --calc-accent-bg: rgba(201, 165, 92, 0.14);
}
</style>
