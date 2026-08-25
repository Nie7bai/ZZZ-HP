<script setup lang="ts">
import type { BuffEffect, BuffEffectBlock, SkillSubcategory } from '@/types/calculator'
import { effectSummaryLabel } from '@/utils/buffEffect'
import { buffStatFieldLabel, BUFF_STAT_FIELDS } from '@/utils/calculatorUi'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'

const props = defineProps<{
  blocks?: BuffEffectBlock[] | null
  /** 扁平效果（无块时包成一块展示） */
  effects?: BuffEffect[] | null
  title?: string
  emptyText?: string
  /** 增益提供者（角色/音擎等），有则按参考站顺序展示 */
  provider?: string
  skillSubcategories?: SkillSubcategory[] | null
  /** 往期详情等：无套卡、紧凑单行效果 */
  compact?: boolean
}>()

const buffStore = useCalculatorBuffStore()
const { skillSubcategories: storeSkillSubcategories } = storeToRefs(buffStore)

/** 优先用父组件传入；否则用计算器缓存，便于解析招式小类名 */
const resolvedSkillSubcategories = computed(
  () => props.skillSubcategories ?? storeSkillSubcategories.value,
)

onMounted(() => {
  if (props.skillSubcategories?.length) return
  void buffStore.ensureLoaded().catch(() => {
    /* 无缓存时仍按大类展示 */
  })
})

const displayBlocks = computed(() => {
  if (props.blocks?.length) {
    return props.blocks.filter((block) => block.effects?.length)
  }
  if (props.effects?.length) {
    return [
      {
        id: 'flat',
        name: props.title || '增益',
        note: '',
        effects: props.effects,
      } satisfies BuffEffectBlock,
    ]
  }
  return [] as BuffEffectBlock[]
})

function statLabel(stat: string) {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === stat)
  return field ? buffStatFieldLabel(field) : stat
}

function situationLabel(effect: BuffEffect) {
  const situation = effect.applySituation ?? 'global'
  if (situation === 'stagger') return '失衡期'
  if (situation === 'non_stagger') return '非失衡期'
  return ''
}

function blockTitle(block: BuffEffectBlock) {
  return block.name?.trim() || props.title || '效果块'
}

/** compact：块名与外层 title 相同时不重复展示标题 */
function showBlockTitle(block: BuffEffectBlock) {
  if (!props.compact) return true
  if (props.provider) return true
  const name = block.name?.trim() || ''
  const outer = props.title?.trim() || ''
  if (!name) return false
  if (outer && name === outer) return false
  return true
}

function showBlockHead(block: BuffEffectBlock) {
  return showBlockTitle(block) || Boolean(block.note?.trim())
}
</script>

<template>
  <div
    v-if="displayBlocks.length"
    class="effect-blocks-display"
    :class="{ 'effect-blocks-display--compact': compact }"
  >
    <article
      v-for="block in displayBlocks"
      :key="block.id"
      class="effect-block-card"
    >
      <header v-if="showBlockHead(block)" class="effect-block-head">
        <strong v-if="showBlockTitle(block)" class="effect-block-name">
          <template v-if="provider">{{ provider }} · </template>{{ blockTitle(block) }}
        </strong>
        <p v-if="block.note?.trim()" class="effect-block-note">{{ block.note }}</p>
      </header>
      <ul class="effect-block-list">
        <li v-for="effect in block.effects" :key="effect.id" class="effect-item">
          <span v-if="situationLabel(effect)" class="effect-situation">{{
            situationLabel(effect)
          }}</span>
          <strong class="effect-summary">{{
            effectSummaryLabel(effect, (s) => statLabel(s), resolvedSkillSubcategories)
          }}</strong>
        </li>
      </ul>
    </article>
  </div>
  <p v-else class="effect-blocks-empty">{{ emptyText || '暂无增益效果块' }}</p>
</template>

<style scoped>
.effect-blocks-display {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.effect-block-card {
  border: 1px solid var(--calc-border, #3a4456);
  border-radius: 10px;
  background: var(--calc-surface, #161b24);
  padding: 0.65rem 0.75rem;
  color: var(--calc-text, #d5dae4);
}

.effect-block-head {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid color-mix(in srgb, var(--calc-border, #3a4456) 80%, transparent);
}

.effect-block-name {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--calc-accent, #c9a55c);
}

.effect-block-note {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.45;
  color: var(--calc-muted, #8b93a3);
  white-space: pre-wrap;
}

.effect-block-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.effect-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  background: var(--calc-surface-2, rgba(255, 255, 255, 0.03));
}

.effect-situation {
  font-size: 0.74rem;
  color: var(--calc-muted, #9aa3b5);
}

.effect-summary {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--calc-text, #ebedf0);
}

.effect-blocks-empty {
  margin: 0;
  font-size: 0.8rem;
  color: var(--calc-muted, #8b93a3);
}

/* —— compact：往期详情用，无套卡 —— */
.effect-blocks-display--compact {
  gap: 0.35rem;
}

.effect-blocks-display--compact .effect-block-card {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
  color: inherit;
}

.effect-blocks-display--compact .effect-block-card + .effect-block-card {
  padding-top: 0.35rem;
  border-top: 1px solid color-mix(in srgb, var(--color-border, currentColor) 55%, transparent);
}

.effect-blocks-display--compact .effect-block-head {
  margin-bottom: 0.2rem;
  padding-bottom: 0;
  border-bottom: none;
  gap: 0.1rem;
}

.effect-blocks-display--compact .effect-block-name {
  font-size: 0.72rem;
  font-weight: 650;
  color: var(--color-heading, inherit);
  opacity: 0.85;
}

.effect-blocks-display--compact .effect-block-note {
  font-size: 0.7rem;
  line-height: 1.4;
  color: var(--color-text, inherit);
  opacity: 0.72;
}

.effect-blocks-display--compact .effect-block-list {
  gap: 0.2rem;
}

.effect-blocks-display--compact .effect-item {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.5rem;
  padding: 0.15rem 0;
  border-radius: 0;
  background: transparent;
}

.effect-blocks-display--compact .effect-situation {
  font-size: 0.68rem;
  opacity: 0.7;
  color: var(--color-text, inherit);
}

.effect-blocks-display--compact .effect-summary {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text, inherit);
  line-height: 1.4;
}

.effect-blocks-display--compact .effect-blocks-empty {
  font-size: 0.72rem;
  opacity: 0.7;
}
</style>
