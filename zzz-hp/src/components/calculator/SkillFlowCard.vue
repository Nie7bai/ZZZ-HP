<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    mult?: string
    note?: string
    /** 仅悬停弹层展示的倍率，不占行上倍率格 */
    popMult?: string
    popMultLabel?: string
    count?: number | null
    /** 仅展示次数，不可改（技能组详情只读列表） */
    countReadonly?: boolean
    /** 流程行：缩短名称、去掉「次数」字样，腾出空间 */
    compact?: boolean
    stagger?: boolean
    dtype?: string
    dtypeKind?: 'direct' | 'anomaly'
    stypes?: string[]
    agentPair?: string
    agentTitle?: string
    /** 行尾红色提醒（如乱流/耀变触发者不合规），不占倍率格 */
    warn?: string | null
    damage?: string
    skip?: boolean
    index?: number
    rowDraggable?: boolean
    dragging?: boolean
    agentsClickable?: boolean
  }>(),
  {
    agentsClickable: true,
    countReadonly: false,
    compact: false,
  },
)

const emit = defineEmits<{
  'select-agents': []
  'update:count': [value: number]
  'update:stagger': [value: boolean]
}>()

const nameWrapRef = ref<HTMLElement | null>(null)
const namePopVisible = ref(false)
const namePopStyle = ref<Record<string, string>>({})

/** 弹层里的倍率：技能组等行上不显示倍率格时由 popMult 传入 */
const popMultText = computed(() => (props.popMult ?? props.mult ?? '').trim())
const popMultLabelText = computed(() => props.popMultLabel?.trim() || '倍率')

function showNamePop() {
  const el = nameWrapRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = rect.width
  let left = rect.left
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - 8 - width)
  }
  // 盖在招式名框水平位置，垂直以框中心为轴上下撑开
  namePopStyle.value = {
    top: `${rect.top + rect.height / 2}px`,
    left: `${left}px`,
    width: `${width}px`,
    minHeight: `${rect.height}px`,
  }
  namePopVisible.value = true
}

function hideNamePop(event?: MouseEvent | FocusEvent) {
  if (event?.type === 'focusout') {
    const next = (event as FocusEvent).relatedTarget as Node | null
    const row = event.currentTarget as HTMLElement | null
    if (next && row?.contains(next)) return
  }
  namePopVisible.value = false
}

function emitCount(event: Event) {
  const n = Math.floor(Number((event.target as HTMLInputElement).value))
  if (!Number.isFinite(n)) return
  emit('update:count', Math.max(0, n))
}
</script>

<template>
  <li
    class="sf-card"
    :class="{
      'sf-card--skip': skip,
      'sf-card--draggable': rowDraggable,
      'sf-card--dragging': dragging,
      'sf-card--compact': compact,
    }"
    :draggable="rowDraggable"
    @mouseenter="showNamePop"
    @mouseleave="hideNamePop"
    @focusin="showNamePop"
    @focusout="hideNamePop"
  >
    <div class="sf-lead">
      <span v-if="index != null" class="sf-index">{{ index }}</span>
      <span ref="nameWrapRef" class="sf-name-wrap">
        <strong class="sf-name" tabindex="0">{{ name }}</strong>
      </span>
      <Teleport to="body">
        <div
          v-if="namePopVisible"
          class="sf-name-pop"
          role="tooltip"
          :style="namePopStyle"
        >
          <span class="sf-name-pop-title">{{ name }}</span>
          <span v-if="note" class="sf-name-pop-note">{{ note }}</span>
          <span v-if="popMultText" class="sf-name-pop-mult">
            <span class="sf-name-pop-mult-label">{{ popMultLabelText }}</span>
            <span class="sf-name-pop-mult-val">{{ popMultText }}</span>
          </span>
        </div>
      </Teleport>
      <span v-if="mult" class="sf-mult-label">倍率</span>
      <span v-if="mult" class="sf-mult" :title="mult">{{ mult }}</span>
      <template v-if="count != null">
        <span v-if="!compact" class="sf-mult-label">次数</span>
        <span v-if="countReadonly" class="sf-count is-readonly" :title="`次数 ${count}`">{{
          count
        }}</span>
        <input
          v-else
          class="sf-count"
          type="number"
          min="0"
          step="1"
          :value="count"
          :title="compact ? '次数' : undefined"
          :aria-label="compact ? '次数' : undefined"
          draggable="false"
          @click.stop
          @input="emitCount"
        />
        <label v-if="!countReadonly" class="sf-stagger" draggable="false" @click.stop>
          <input
            type="checkbox"
            :checked="stagger"
            @change="emit('update:stagger', ($event.target as HTMLInputElement).checked)"
          />
          失衡
        </label>
      </template>
      <span v-if="dtype" class="sf-dtype" :class="dtypeKind === 'direct' ? 'is-direct' : 'is-anomaly'">
        {{ dtype }}
      </span>
      <span v-if="stypes?.length" class="sf-stypes">
        <span v-for="item in stypes" :key="item" class="sf-stype">{{ item }}</span>
      </span>
      <button
        v-if="agentPair && agentsClickable"
        type="button"
        class="sf-agents"
        :title="agentTitle || agentPair"
        draggable="false"
        @click.stop="emit('select-agents')"
      >
        {{ agentPair }}
      </button>
      <span
        v-else-if="agentPair"
        class="sf-agents is-static"
        :title="agentTitle || agentPair"
      >
        {{ agentPair }}
      </span>
      <span v-if="warn" class="sf-warn" :title="warn">{{ warn }}</span>
    </div>
    <span v-if="damage" class="sf-damage">{{ damage }}</span>
    <div class="sf-card-actions">
      <slot name="actions" />
    </div>
  </li>
</template>

<style scoped>
.sf-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 2.15rem;
  overflow: visible;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.45rem;
  border: 1px solid #2a3038;
  border-radius: 6px;
  background: #141820;
}
.sf-card--draggable {
  cursor: grab;
}
.sf-card--dragging {
  opacity: 0.35;
  cursor: grabbing;
}
.sf-lead {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
.sf-warn {
  flex: 1 1 4rem;
  min-width: 0;
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  font-weight: 600;
  color: #e07070;
  line-height: 1.2;
}
.sf-damage {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 6.5rem;
  text-align: right;
  font-size: 0.82rem;
  font-weight: 800;
  color: #c4a0e8;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sf-card-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  flex-shrink: 0;
  margin-left: auto;
  position: relative;
  z-index: 2;
}
.sf-index {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.16);
  color: #f0d7a2;
  font-size: 0.68rem;
  font-weight: 700;
}
.sf-name-wrap {
  position: relative;
  flex: 0 0 13em;
  width: 13em;
  min-width: 13em;
  max-width: 13em;
}
.sf-card--compact .sf-name-wrap {
  flex-basis: 10em;
  width: 10em;
  min-width: 10em;
  max-width: 10em;
}
.sf-name {
  box-sizing: border-box;
  display: block;
  width: 100%;
  padding: 0.08rem 0.4rem;
  border: 1px solid #2d323a;
  border-radius: 4px;
  background: #0f1217;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 0.8rem;
  color: #e8edf5;
  font-weight: 600;
}
.sf-name-pop {
  position: fixed;
  z-index: 10050;
  box-sizing: border-box;
  padding: 0.28rem 0.4rem;
  border: 1px solid #c9a55c;
  border-radius: 4px;
  background: #1a1f27;
  color: #e8edf5;
  box-shadow:
    0 0 0 1px rgba(240, 215, 162, 0.22),
    0 0 12px 4px rgba(0, 0, 0, 0.35),
    0 8px 22px rgba(0, 0, 0, 0.28);
  transform: translateY(-50%);
  pointer-events: none;
}
.sf-name-pop::before {
  content: '';
  position: absolute;
  inset: -14px;
  z-index: -1;
  border-radius: 10px;
  background: rgba(26, 31, 39, 0.72);
  filter: blur(12px);
  pointer-events: none;
}
.sf-name-pop-title {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.35;
  white-space: normal;
  word-break: break-word;
}
.sf-name-pop-note {
  display: block;
  margin-top: 0.28rem;
  padding-top: 0.28rem;
  border-top: 1px solid #2d323a;
  color: #b8c0cc;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.35;
  white-space: normal;
  word-break: break-word;
}
.sf-name-pop-mult {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  margin-top: 0.28rem;
  padding-top: 0.28rem;
  border-top: 1px solid #2d323a;
  line-height: 1.35;
}
.sf-name-pop-mult-label {
  color: #9aa3b0;
  font-size: 0.68rem;
  font-weight: 600;
}
.sf-name-pop-mult-val {
  color: #f0d7a2;
  font-size: 0.76rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.sf-card--compact .sf-damage {
  max-width: 5.5rem;
}
.sf-mult-label {
  flex: 0 0 auto;
  font-size: 0.68rem;
  color: #9aa3b0;
  font-weight: 600;
}
.sf-mult,
.sf-count {
  flex: 0 0 auto;
  padding: 0.08rem 0.28rem;
  border: 1px solid #2d323a;
  border-radius: 4px;
  background: #0f1217;
  color: #e8edf5;
  font-size: 0.76rem;
  font-weight: 700;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.sf-mult {
  box-sizing: content-box;
  width: 5.2ch;
  min-width: 5.2ch;
  max-width: 5.2ch;
  overflow: hidden;
  white-space: nowrap;
}
.sf-count {
  width: 3rem;
  height: 1.35rem;
  box-sizing: border-box;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
}
.sf-count.is-readonly {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.sf-stagger {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.72rem;
  color: #9aa3b0;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.sf-stagger input {
  margin: 0;
  accent-color: #c9a55c;
}
.sf-dtype,
.sf-stype,
.sf-agents {
  box-sizing: border-box;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.42rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.sf-dtype.is-anomaly {
  background: #1a2a38;
  border: 1px solid #3a6a88;
  color: #8ec8e8;
}
.sf-dtype.is-direct {
  background: rgba(201, 165, 92, 0.14);
  border: 1px solid #8a6a1f;
  color: #f0d7a2;
}
.sf-stypes {
  display: flex;
  flex: 0 1 auto;
  gap: 0.2rem;
  min-width: 0;
  overflow: hidden;
}
.sf-stype {
  background: #15241f;
  border: 1px solid #2f5c52;
  color: #8fd4c4;
}
.sf-agents {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  background: #241833;
  border: 1px solid #6b4ea0;
  color: #d4b8f0;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
}
.sf-agents:hover {
  filter: brightness(1.08);
}
.sf-agents.is-static {
  cursor: default;
}
.sf-agents.is-static:hover {
  filter: none;
}
.sf-card-actions > :deep(*) {
  flex: 0 0 auto;
}

:global([data-theme='light']) .sf-card {
  border-color: #d7dde6;
  background: #fff;
}
:global([data-theme='light']) .sf-name {
  color: #2b3038;
  border-color: #d7dde6;
  background: #f7f8fb;
}
:global([data-theme='light']) .sf-name-pop {
  border-color: #c9a55c;
  background: rgba(255, 255, 255, 0.96);
  color: #1c212a;
  box-shadow:
    0 0 0 1px rgba(201, 165, 92, 0.28),
    0 0 12px 4px rgba(28, 33, 42, 0.1),
    0 8px 22px rgba(28, 33, 42, 0.12);
}
:global([data-theme='light']) .sf-name-pop::before {
  background: rgba(255, 255, 255, 0.7);
}
:global([data-theme='light']) .sf-name-pop-note {
  border-top-color: #e6e8ee;
  color: #5a6575;
}
:global([data-theme='light']) .sf-name-pop-mult {
  border-top-color: #e6e8ee;
}
:global([data-theme='light']) .sf-name-pop-mult-label {
  color: #6a7382;
}
:global([data-theme='light']) .sf-name-pop-mult-val {
  color: #8a6a1f;
}
:global([data-theme='light']) .sf-mult-label,
:global([data-theme='light']) .sf-index {
  color: #6a7382;
}
:global([data-theme='light']) .sf-mult,
:global([data-theme='light']) .sf-count {
  color: #3a4250;
  border-color: #d7dde6;
  background: #f7f8fb;
}
:global([data-theme='light']) .sf-damage {
  color: #7a4fb0;
}
:global([data-theme='light']) .sf-warn {
  color: #b54747;
}
:global([data-theme='light']) .sf-dtype.is-anomaly {
  background: #f3e8ff;
  color: #6b3fa0;
}
:global([data-theme='light']) .sf-dtype.is-direct {
  background: #e8f1ff;
  color: #3a5f9a;
}
:global([data-theme='light']) .sf-stype {
  background: #eef1f5;
  color: #4a5564;
}
:global([data-theme='light']) .sf-agents {
  background: #f3e8ff;
  color: #6b3fa0;
}
</style>
