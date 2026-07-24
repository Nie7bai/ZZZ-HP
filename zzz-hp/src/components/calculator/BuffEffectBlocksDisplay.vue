<script setup lang="ts">
import type { BuffEffect, BuffEffectBlock } from '@/types/calculator'
import { effectSummaryLabel } from '@/utils/buffEffect'
import { buffStatFieldLabel, BUFF_STAT_FIELDS } from '@/utils/calculatorUi'
import { computed } from 'vue'

const props = defineProps<{
  blocks?: BuffEffectBlock[] | null
  /** 扁平效果（无块时包成一块展示） */
  effects?: BuffEffect[] | null
  title?: string
  emptyText?: string
  /** 增益提供者（角色/音擎等），有则按参考站顺序展示 */
  provider?: string
}>()

const displayBlocks = computed(() => {
  if (props.blocks?.length) {
    return props.blocks.filter((block) => block.effects?.length)
  }
  if (props.effects?.length) {
    return [
      {
        id: 'flat',
        name: props.title || '增益',
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
  return block.name?.trim() || '增益'
}
</script>

<template>
  <div v-if="displayBlocks.length" class="effect-blocks-display">
    <article
      v-for="block in displayBlocks"
      :key="block.id"
      class="effect-block-card"
    >
      <header class="effect-block-head">
        <strong>
          <template v-if="provider">{{ provider }} · </template>{{ blockTitle(block) }}
        </strong>
        <span v-if="block.note?.trim()" class="effect-block-note">{{ block.note }}</span>
      </header>
      <ul class="effect-block-list">
        <li v-for="effect in block.effects" :key="effect.id" class="effect-item">
          <div v-if="situationLabel(effect)" class="effect-meta">
            <span class="effect-situation">{{ situationLabel(effect) }}</span>
          </div>
          <strong class="effect-summary">{{
            effectSummaryLabel(effect, (s) => statLabel(s))
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
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: baseline;
  margin-bottom: 0.4rem;
}

.effect-block-head strong {
  font-size: 0.86rem;
  color: var(--calc-accent, #c9a55c);
}

.effect-block-note {
  font-size: 0.74rem;
  color: var(--calc-muted, #8b93a3);
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

.effect-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem;
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
</style>
