<script setup lang="ts">
import { computed } from 'vue'
import type { AgentBuffDoc, CharacterAttrKey, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'
import {
  createDefaultExternalPanel,
  type AffixCounts,
  type AffixDriveDiscMainStats,
  type PanelCalcMode,
  type PanelStats,
} from '@/types/calculatorPanel'
import {
  AFFIX_DRIVE_DISC_SLOT_1_HP,
  AFFIX_DRIVE_DISC_SLOT_2_ATK,
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
} from '@/utils/affixDriveDiscConfig'
import { AFFIX_COUNT_FIELDS, computeExternalPanelFromTeamSlot } from '@/utils/affixPanelCalc'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  CONVERT_SOURCE_ATTRS_OFF_PANEL,
  externalConvertFieldClass,
  type ConvertSourceMark,
} from '@/utils/panelBuffCalc'

const calcMode = defineModel<Extract<PanelCalcMode, 'panel' | 'affix'>>('calcMode', {
  default: 'panel',
})

const props = defineProps<{
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  agentId: string
  wengineId: string
  twoPieceId: string
  fourPieceId: string
  /** 当前槽位局内最终面板（只读预览；随局外草稿与增益实时更新） */
  finalPanel?: PanelStats | null
  /** 该角色作为转模来源时的属性标记（局外/局内） */
  convertSourceMarks?: ConvertSourceMark[]
}>()

const externalPanel = defineModel<PanelStats>('externalPanel', {
  default: () => createDefaultExternalPanel(),
})
const affixCounts = defineModel<AffixCounts>('affixCounts', { required: true })
const affixDriveDiscMainStats = defineModel<AffixDriveDiscMainStats>('affixDriveDiscMainStats', {
  required: true,
})

const isAffixMode = computed(() => calcMode.value === 'affix')

const agent = computed(() => props.agents.find((item) => item.id === props.agentId))
const wengine = computed(() =>
  props.wengineId && props.wengineId !== 'none'
    ? props.wengines.find((item) => item.id === props.wengineId)
    : undefined,
)

const derivedExternal = computed(() =>
  computeExternalPanelFromTeamSlot({
    slot: {
      agentId: props.agentId,
      wengineId: props.wengineId,
      twoPieceDriveDiscId: props.twoPieceId,
      fourPieceDriveDiscId: props.fourPieceId,
      affixCounts: affixCounts.value,
      affixDriveDiscMainStats: affixDriveDiscMainStats.value,
    },
    agents: props.agents,
    wengines: props.wengines,
    driveDiscs: props.driveDiscs,
  }),
)

const displayPanel = computed(() => (isAffixMode.value ? derivedExternal.value : externalPanel.value))

const driveDiscSummary = computed(() => {
  const four = props.driveDiscs.find((d) => d.id === props.fourPieceId)?.name
  const two = props.driveDiscs.find((d) => d.id === props.twoPieceId)?.name
  const parts: string[] = []
  if (four) parts.push(`4件：${four}`)
  if (two && two !== four) parts.push(`2件：${two}`)
  return parts.length ? parts.join(' · ') : '未选择驱动盘（请先在「驱动盘」Tab 选择）'
})

const convertAttrs = computed(() => {
  const marks = props.convertSourceMarks ?? []
  return {
    external: new Set(marks.filter((m) => m.panelSource === 'external').map((m) => m.attr)),
    final: new Set(marks.filter((m) => m.panelSource === 'final').map((m) => m.attr)),
  }
})

const offPanelConvertHints = computed(() =>
  (props.convertSourceMarks ?? [])
    .filter((item) => CONVERT_SOURCE_ATTRS_OFF_PANEL.includes(item.attr))
    .map((item) => {
      const source = item.panelSource === 'final' ? '局内' : '局外'
      const label = CHARACTER_ATTR_OPTIONS.find((opt) => opt.id === item.attr)?.label ?? item.attr
      return `${source}·${label}`
    }),
)

function fieldConvertClass(key: string, panel: 'external' | 'final') {
  if (panel === 'final') {
    return { 'is-convert-source': convertAttrs.value.final.has(key as CharacterAttrKey) }
  }
  return externalConvertFieldClass({ key, id: key }, convertAttrs.value)
}

const EXTERNAL_FIELDS: { key: keyof PanelStats; label: string }[] = [
  { key: 'hp', label: '生命值' },
  { key: 'atk', label: '攻击力' },
  { key: 'def', label: '防御力' },
  { key: 'critRate', label: '暴击率%' },
  { key: 'critDmg', label: '爆伤%' },
  { key: 'dmgBonus', label: '增伤%' },
  { key: 'penRate', label: '穿透率%' },
  { key: 'pen', label: '穿透值' },
  { key: 'reduceDefense', label: '无视防御/减防%' },
  { key: 'mastery', label: '精通' },
  { key: 'anomalyControl', label: '异常掌控' },
  { key: 'energyRegen', label: '能量回复效率%' },
  { key: 'anomalyDuration', label: '异常持续时间(s)' },
  { key: 'disorderBaseMult', label: '紊乱基础倍率%' },
  { key: 'disorderCompMult', label: '紊乱补偿倍率%' },
  { key: 'turbulenceBaseMult', label: '乱流基础倍率%' },
  { key: 'turbulenceCompMult', label: '乱流补偿倍率%' },
]

const FINAL_FIELDS: { key: keyof PanelStats; label: string }[] = [
  { key: 'hp', label: '生命值' },
  { key: 'atk', label: '攻击力' },
  { key: 'def', label: '防御力' },
  { key: 'critRate', label: '暴击率%' },
  { key: 'critDmg', label: '爆伤%' },
  { key: 'dmgBonus', label: '增伤%' },
  { key: 'penRate', label: '穿透率%' },
  { key: 'pen', label: '穿透值' },
  { key: 'reduceDefense', label: '无视防御/减防%' },
  { key: 'mastery', label: '精通' },
  { key: 'anomalyControl', label: '异常掌控' },
  { key: 'energyRegen', label: '能量回复效率%' },
  { key: 'anomalyCritRate', label: '异常暴击%' },
  { key: 'anomalyCritDmg', label: '异常爆伤%' },
  { key: 'anomalyDmgBonus', label: '异常增伤%' },
  { key: 'anomalyReleaseCritRate', label: '异放暴击%' },
  { key: 'anomalyReleaseCritDmg', label: '异放爆伤%' },
  { key: 'anomalyReleaseDmgBonus', label: '异放增伤%' },
  { key: 'disorderDmgBonus', label: '紊乱增伤%' },
  { key: 'turbulenceDmgBonus', label: '乱流增伤%' },
]

function formatValue(key: keyof PanelStats, value: number) {
  if (
    key === 'hp' ||
    key === 'atk' ||
    key === 'def' ||
    key === 'pen' ||
    key === 'mastery' ||
    key === 'anomalyControl' ||
    key === 'anomalyDuration'
  ) {
    return Math.round(value).toLocaleString('en-US')
  }
  return formatCalcDecimal(value, 4)
}
</script>

<template>
  <div class="slot-panel-entry">
    <div class="entry-mode-row">
      <span class="entry-mode-label">录入方式</span>
      <button
        type="button"
        class="entry-mode-tab"
        :class="{ active: calcMode === 'panel' }"
        @click="calcMode = 'panel'"
      >
        面板导入
      </button>
      <button
        type="button"
        class="entry-mode-tab"
        :class="{ active: calcMode === 'affix' }"
        @click="calcMode = 'affix'"
      >
        词条计算
      </button>
      <p class="entry-mode-hint">确定导入后记在该角色上，三人可各选一种；与左侧「伤害计算 / 最优词条」无关。</p>
    </div>

    <section v-if="isAffixMode" class="panel-block">
      <header class="panel-block-header">
        <h3>驱动盘主属性</h3>
        <p>{{ driveDiscSummary }} · 1 号盘固定生命 {{ AFFIX_DRIVE_DISC_SLOT_1_HP }}，2 号盘固定攻击 {{ AFFIX_DRIVE_DISC_SLOT_2_ATK }}</p>
      </header>
      <div class="grid four">
        <label class="field">
          <span>4 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot4MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_4_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>5 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot5MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_5_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>6 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot6MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_6_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
    </section>

    <section v-if="isAffixMode" class="panel-block">
      <header class="panel-block-header">
        <h3>词条数</h3>
        <p>基于角色基础面板、音擎与驱动盘属性推导局外；每条副词条按固定数值折算。</p>
      </header>
      <p v-if="!agent" class="hint">请先在「角色」Tab 选择代理人。</p>
      <div class="grid four">
        <label v-for="field in AFFIX_COUNT_FIELDS" :key="field.key" class="field">
          <span>{{ field.label }}（{{ field.unitLabel }}）</span>
          <input v-model.number="affixCounts[field.key]" type="number" min="0" step="1" />
          <span class="field-hint">每条 +{{ field.perCount }}</span>
        </label>
      </div>
      <p v-if="agent" class="hint">
        基础来源：{{ agent.name }}（生命 {{ agent.basePanel.hp }} / 攻击 {{ agent.basePanel.atk }}）
        <template v-if="wengine"> · {{ wengine.name }}（音擎攻击 {{ wengine.baseAtk }}） </template>
      </p>
    </section>

    <section class="panel-block">
      <header class="panel-block-header">
        <h3>局外面板（初始）</h3>
        <p>
          {{
            isAffixMode
              ? '由词条数、驱动盘与角色/音擎基础属性自动计算，只读预览。'
              : '手填当前槽位局外面板，不含战斗增益。'
          }}
          <template v-if="convertAttrs.external.size"> 实线绿框为局外转模来源。</template>
          <template v-if="convertAttrs.final.size"> 虚线绿框为局内转模对应的局外属性。</template>
        </p>
        <p v-if="offPanelConvertHints.length" class="convert-source-hint">
          下列转模来源未在本表展示：{{ offPanelConvertHints.join('、') }}
        </p>
      </header>
      <div class="grid four">
        <label
          v-for="field in EXTERNAL_FIELDS"
          :key="field.key"
          class="field"
          :class="fieldConvertClass(field.key, 'external')"
        >
          <span>{{ field.label }}</span>
          <input
            v-show="!isAffixMode"
            :key="`panel-${field.key}`"
            v-model.number="externalPanel[field.key]"
            type="number"
            step="any"
          />
          <input
            v-show="isAffixMode"
            :key="`affix-${field.key}`"
            :value="formatValue(field.key, derivedExternal[field.key])"
            type="text"
            readonly
            tabindex="-1"
          />
        </label>
      </div>
    </section>

    <section class="panel-block panel-block--final">
      <header class="panel-block-header">
        <h3>局内面板（最终）</h3>
        <p>
          叠加自身/队友/音擎/邦布/驱动盘/额外 Buff 后的战斗面板，只读；随局外草稿与增益勾选实时更新。
          <template v-if="convertAttrs.final.size"> 实线绿框为局内转模来源。</template>
        </p>
      </header>
      <p v-if="!finalPanel" class="hint">暂无局内结果，录入局外或确认增益后可在此查看。</p>
      <div v-else class="grid four">
        <label
          v-for="field in FINAL_FIELDS"
          :key="field.key"
          class="field"
          :class="fieldConvertClass(field.key, 'final')"
        >
          <span>{{ field.label }}</span>
          <input :value="formatValue(field.key, finalPanel[field.key])" type="text" readonly />
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.slot-panel-entry {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.entry-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
}

.entry-mode-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: #c9a55c;
}

.entry-mode-tab {
  appearance: none;
  border: 1px solid #343a44;
  border-radius: 8px;
  background: #12161d;
  color: #9aa3b0;
  padding: 0.28rem 0.7rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
}

.entry-mode-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.16);
  color: #f0d7a2;
}

.entry-mode-hint {
  margin: 0;
  font-size: 0.72rem;
  color: #8f96a3;
}

.panel-block {
  border: 1px solid #2d323a;
  border-radius: 12px;
  padding: 0.75rem;
  background: #10141a;
  min-width: 0;
}

.panel-block--final {
  border-color: #3a4a31;
  background: linear-gradient(180deg, #121712 0%, #0f1410 100%);
}

.panel-block-header h3 {
  margin: 0;
  font-size: 0.9rem;
  color: #e8ebf0;
}

.panel-block-header p,
.hint,
.field-hint,
.convert-source-hint {
  margin: 0.25rem 0 0.55rem;
  font-size: 0.74rem;
  color: #8f96a3;
  line-height: 1.4;
}

.convert-source-hint {
  color: #b7c98a;
}

.grid.four {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem 0.65rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.8rem;
  color: #9aa3b0;
  min-width: 0;
}

.field > input,
.field > select {
  border: 1px solid #333841;
  border-radius: 8px;
  background: #0f1217;
  color: #e8eaed;
  padding: 0.45rem 0.55rem;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}

.field.is-convert-source,
.field.is-convert-source-via-final {
  padding: 0.3rem 0.34rem 0.36rem;
  border-radius: 10px;
  background: rgba(136, 171, 78, 0.18);
}

.field.is-convert-source {
  border: 1px solid #4a6a38;
}

.field.is-convert-source-via-final {
  border: 1px dashed #6a9450;
  background: rgba(136, 171, 78, 0.1);
}

.field.is-convert-source > span,
.field.is-convert-source-via-final > span {
  color: #d6e8b5;
}

.field.is-convert-source > input,
.field.is-convert-source > input:read-only,
.field.is-convert-source-via-final > input,
.field.is-convert-source-via-final > input:read-only {
  border-color: #6a9450;
  background: rgba(136, 171, 78, 0.16);
  opacity: 1;
}

.field.is-convert-source-via-final > input,
.field.is-convert-source-via-final > input:read-only {
  border-style: dashed;
  background: rgba(136, 171, 78, 0.08);
}
</style>
