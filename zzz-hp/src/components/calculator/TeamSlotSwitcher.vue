<script setup lang="ts">
import { computed, ref } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { isWengineProfessionMatch } from '@/utils/calculatorUi'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'

export type SlotPanelPreview = {
  external: PanelStats
  final?: PanelStats | null
}

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  activeIndex: number
  panelPreviews?: Array<SlotPanelPreview | PanelStats | null | undefined>
  /** 含局外/局内转模效果的槽位索引 */
  convertSlotIndexes?: Set<number> | number[]
}>()

const emit = defineEmits<{
  select: [index: number]
  import: [index: number]
  clear: [index: number]
}>()

const hoverIndex = ref<number | null>(null)

function isConvertSlot(index: number) {
  if (!props.convertSlotIndexes) return false
  if (props.convertSlotIndexes instanceof Set) return props.convertSlotIndexes.has(index)
  return props.convertSlotIndexes.includes(index)
}

function label(slot: TeamSlot, index: number) {
  return teamSlotDisplayLabel(slot, index, props.agents)
}

function agentOf(slot: TeamSlot) {
  if (!slot.agentId) return undefined
  return props.agents.find((item) => item.id === slot.agentId)
}

function wengineOf(slot: TeamSlot) {
  if (!slot.wengineId || slot.wengineId === 'none') return undefined
  return props.wengines.find((item) => item.id === slot.wengineId)
}

function discOf(id: string) {
  if (!id || id === 'none') return undefined
  return props.driveDiscs.find((item) => item.id === id)
}

function normalizePreview(index: number): SlotPanelPreview | null {
  const raw = props.panelPreviews?.[index]
  if (!raw) return null
  if ('external' in raw && raw.external) {
    return { external: raw.external, final: raw.final ?? null }
  }
  return { external: raw as PanelStats, final: null }
}

function formatStat(key: keyof PanelStats, value: number) {
  if (
    key === 'hp' ||
    key === 'atk' ||
    key === 'def' ||
    key === 'pen' ||
    key === 'mastery' ||
    key === 'anomalyControl'
  ) {
    return Math.round(value).toLocaleString('en-US')
  }
  return formatCalcDecimal(value, 2)
}

const EXTERNAL_PREVIEW_FIELDS: { key: keyof PanelStats; label: string }[] = [
  { key: 'hp', label: '生命值' },
  { key: 'atk', label: '攻击力' },
  { key: 'def', label: '防御力' },
  { key: 'critRate', label: '暴击率%' },
  { key: 'critDmg', label: '爆伤%' },
  { key: 'penRate', label: '穿透率%' },
  { key: 'pen', label: '穿透值' },
  { key: 'dmgBonus', label: '增伤%' },
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

const FINAL_PREVIEW_FIELDS: { key: keyof PanelStats; label: string }[] = [
  ...EXTERNAL_PREVIEW_FIELDS,
  { key: 'anomalyCritRate', label: '异常暴击%' },
  { key: 'anomalyCritDmg', label: '异常爆伤%' },
  { key: 'anomalyDmgBonus', label: '异常增伤%' },
  { key: 'disorderDmgBonus', label: '紊乱增伤%' },
  { key: 'turbulenceDmgBonus', label: '乱流增伤%' },
]

const activeSlot = computed(() => props.teamSlots[props.activeIndex])
const activeAgent = computed(() => (activeSlot.value ? agentOf(activeSlot.value) : undefined))
const activeWengine = computed(() => (activeSlot.value ? wengineOf(activeSlot.value) : undefined))
const activeFourPiece = computed(() =>
  activeSlot.value ? discOf(activeSlot.value.fourPieceDriveDiscId) : undefined,
)
const activeTwoPiece = computed(() =>
  activeSlot.value ? discOf(activeSlot.value.twoPieceDriveDiscId) : undefined,
)

const wengineProfessionMatch = computed(() => {
  if (!activeAgent.value || !activeWengine.value) return true
  return isWengineProfessionMatch(activeAgent.value.profession, activeWengine.value.profession)
})

function updateRank(value: number) {
  const slot = activeSlot.value
  if (!slot) return
  slot.rank = value
}

function updateRefine(value: number) {
  const slot = activeSlot.value
  if (!slot || !activeWengine.value || !wengineProfessionMatch.value) return
  slot.wengineRefine = value
}

const identityMetaLine = computed(() => {
  const agent = activeAgent.value
  if (!agent) return ''
  return [agent.element, agent.profession].filter(Boolean).join(' · ')
})

const mindscapeWengineLine = computed(() => {
  const slot = activeSlot.value
  if (!slot || !activeAgent.value) return ''
  const parts = [`${slot.rank}影`]
  if (activeWengine.value) {
    if (wengineProfessionMatch.value) {
      parts.push(`${activeWengine.value.name} · 精${slot.wengineRefine}`)
    } else {
      parts.push(`${activeWengine.value.name} · 异职`)
    }
  } else {
    parts.push('未佩戴音擎')
  }
  return parts.join(' · ')
})

const driveDiscLine = computed(() => {
  const discParts: string[] = []
  if (activeFourPiece.value?.name) discParts.push(`4件套 ${activeFourPiece.value.name}`)
  if (activeTwoPiece.value?.name) discParts.push(`2件套 ${activeTwoPiece.value.name}`)
  return discParts.length ? discParts.join(' · ') : '未选驱动盘'
})
</script>

<template>
  <div class="team-slot-switcher">
    <div class="slot-tabs" role="tablist" aria-label="编辑中角色">
      <div
        v-for="(slot, index) in teamSlots"
        :key="index"
        class="slot-wrap"
        @mouseenter="hoverIndex = index"
        @mouseleave="hoverIndex = null"
      >
        <button
          type="button"
          class="slot-btn"
          :class="{ active: activeIndex === index, empty: !slot.agentId }"
          role="tab"
          :aria-selected="activeIndex === index"
          @click="emit('select', index)"
        >
          <CalculatorAvatar
            v-if="agentOf(slot)"
            class="slot-avatar"
            :avatar-image="agentOf(slot)!.avatar_image"
            :name="agentOf(slot)!.name"
          />
          <span class="slot-name">{{ label(slot, index) }}</span>
          <span v-if="isConvertSlot(index)" class="convert-dot" title="该角色影画/音擎/驱动盘含局外或局内转模">转模</span>
          <span v-if="activeIndex === index" class="editing-dot">编辑中</span>
        </button>
        <div
          v-if="hoverIndex === index && slot.agentId && normalizePreview(index)"
          class="panel-hover-card"
          :class="{ 'panel-hover-card--end': index === teamSlots.length - 1 }"
          role="tooltip"
        >
          <p class="panel-hover-title">局外面板</p>
          <dl class="panel-hover-grid">
            <div
              v-for="field in EXTERNAL_PREVIEW_FIELDS"
              :key="`ext-${field.key}`"
              class="panel-hover-item"
            >
              <dt>{{ field.label }}</dt>
              <dd>{{ formatStat(field.key, normalizePreview(index)!.external[field.key]) }}</dd>
            </div>
          </dl>
          <template v-if="normalizePreview(index)!.final">
            <p class="panel-hover-title panel-hover-title--final">局内面板</p>
            <dl class="panel-hover-grid">
              <div
                v-for="field in FINAL_PREVIEW_FIELDS"
                :key="`fin-${field.key}`"
                class="panel-hover-item"
              >
                <dt>{{ field.label }}</dt>
                <dd>{{ formatStat(field.key, normalizePreview(index)!.final![field.key]) }}</dd>
              </div>
            </dl>
          </template>
          <p v-else class="panel-hover-empty">暂无局内结果</p>
        </div>
      </div>
    </div>

    <div class="slot-editor" :class="{ empty: !activeAgent }">
      <template v-if="activeAgent && activeSlot">
        <div class="editor-identity">
          <strong class="identity-title">
            {{ activeAgent.name }}
            <span v-if="identityMetaLine" class="identity-meta"> · {{ identityMetaLine }}</span>
          </strong>
          <span class="identity-sub">{{ mindscapeWengineLine }}</span>
          <span class="identity-sub gear-summary">{{ driveDiscLine }}</span>
        </div>
        <div class="editor-controls">
          <label class="control">
            <span>影画</span>
            <input
              class="slider"
              type="range"
              min="0"
              max="6"
              step="1"
              :value="activeSlot.rank"
              @input="updateRank(Number(($event.target as HTMLInputElement).value))"
            />
            <em>{{ activeSlot.rank }}影</em>
          </label>
          <label class="control">
            <span>精炼</span>
            <input
              class="slider"
              type="range"
              min="1"
              max="5"
              step="1"
              :disabled="!activeWengine || !wengineProfessionMatch"
              :value="activeSlot.wengineRefine"
              @input="updateRefine(Number(($event.target as HTMLInputElement).value))"
            />
            <em>{{ wengineProfessionMatch ? `精${activeSlot.wengineRefine}` : '精-' }}</em>
          </label>
        </div>
      </template>
      <p v-else class="empty-hint">当前槽位未配置角色，点「导入」选择角色、音擎、驱动盘和面板</p>
      <div class="editor-actions">
        <button type="button" class="import-btn" @click="emit('import', activeIndex)">导入</button>
        <button
          v-if="activeAgent"
          type="button"
          class="clear-btn"
          @click="emit('clear', activeIndex)"
        >
          移除
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.team-slot-switcher {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.slot-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  width: 100%;
}

.slot-wrap {
  position: relative;
  min-width: 0;
}

.slot-btn {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  min-width: 0;
  min-height: 2.15rem;
  padding: 0.35rem 0.55rem;
  border: 1px solid #343a44;
  border-radius: 10px;
  background: #1a1e26;
  color: #d7dde8;
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.3;
  cursor: pointer;
  text-align: left;
}

.slot-btn.empty {
  color: #8b93a3;
}

.slot-btn.active {
  border-color: rgba(201, 165, 92, 0.75);
  background: linear-gradient(180deg, #242a36 0%, #1c212b 100%);
  color: #f0e6d0;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.28);
}

.slot-btn:hover {
  border-color: #4a5363;
  background: #222833;
}

.slot-avatar :deep(.calculator-avatar) {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  flex-shrink: 0;
}

.slot-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editing-dot,
.convert-dot {
  flex-shrink: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 0.64rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  padding: 0.1rem 0.38rem;
  line-height: 1.2;
}

.editing-dot {
  border-color: rgba(201, 165, 92, 0.45);
  background: rgba(201, 165, 92, 0.16);
  color: #e8d5a8;
}

.convert-dot {
  margin-left: auto;
  border-color: rgba(126, 168, 200, 0.4);
  background: rgba(126, 168, 200, 0.14);
  color: #c5d8ea;
}

.slot-btn:not(:has(.convert-dot)) .editing-dot {
  margin-left: auto;
}

.slot-editor {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  border: 1px solid #343a44;
  border-radius: 10px;
  background: #161a21;
}

.slot-editor.empty {
  justify-content: space-between;
}

.editor-identity {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
  min-width: 0;
  flex: 1;
}

.editor-identity strong,
.editor-identity .identity-title {
  font-size: 0.86rem;
  color: #e8edf5;
  font-weight: 700;
}

.editor-identity .identity-meta {
  font-size: 0.78rem;
  font-weight: 550;
  color: #9aa3b5;
}

.editor-identity span,
.editor-identity .identity-sub {
  font-size: 0.72rem;
  color: #9aa3b5;
}

.gear-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.85rem;
  flex-shrink: 0;
}

.control {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.74rem;
  color: #d7dde8;
}

.control span {
  color: #c9a55c;
  font-weight: 700;
}

.control em {
  min-width: 2.4rem;
  font-style: normal;
  font-weight: 700;
  color: #e8d5a8;
}

.slider {
  width: 88px;
  accent-color: #c9a55c;
}

.slider:disabled {
  opacity: 0.45;
}

.editor-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
  margin-left: auto;
}

.import-btn,
.clear-btn {
  appearance: none;
  border-radius: 8px;
  padding: 0.32rem 0.7rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: none;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.import-btn {
  border: 1px solid #4a5363;
  background: #222833;
  color: #e8edf5;
}

.import-btn:hover {
  border-color: rgba(201, 165, 92, 0.55);
  background: #2a3140;
  color: #f3e6c4;
}

.clear-btn {
  border: 1px solid #4a5363;
  background: transparent;
  color: #b0b8c8;
}

.clear-btn:hover {
  border-color: #6a7385;
  background: rgba(255, 255, 255, 0.04);
  color: #e0e5ef;
}

.empty-hint {
  margin: 0;
  font-size: 0.8rem;
  color: #9aa3b5;
}

.panel-hover-card {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 50;
  width: min(38rem, 94vw);
  max-height: min(70vh, 36rem);
  overflow: auto;
  padding: 0.65rem 0.8rem;
  border: 1px solid rgba(201, 165, 92, 0.45);
  border-radius: 10px;
  background: #1a1e26;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  color: #d7dde8;
  pointer-events: none;
}

.panel-hover-card--end {
  left: auto;
  right: 0;
}

.panel-hover-title {
  margin: 0 0 0.4rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: #c9a55c;
}

.panel-hover-title--final {
  margin-top: 0.55rem;
  padding-top: 0.45rem;
  border-top: 1px solid #343a44;
  color: #8fbc7a;
}

.panel-hover-empty {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  color: #8b93a3;
}

.panel-hover-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.28rem 0.85rem;
}

.panel-hover-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.55rem;
  min-width: 0;
}

.panel-hover-item dt {
  margin: 0;
  flex: 1 1 auto;
  font-size: 0.72rem;
  color: #8b93a3;
  line-height: 1.35;
}

.panel-hover-item dd {
  margin: 0;
  flex: 0 0 auto;
  font-size: 0.74rem;
  font-weight: 600;
  color: #e8edf5;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 980px) {
  .slot-editor {
    flex-wrap: wrap;
  }

  .editor-actions {
    width: 100%;
    margin-left: 0;
  }

  .import-btn,
  .clear-btn {
    flex: 1;
  }
}

@media (max-width: 720px) {
  .slot-btn {
    font-size: 0.76rem;
  }

  .editing-dot {
    display: none;
  }
}
</style>
