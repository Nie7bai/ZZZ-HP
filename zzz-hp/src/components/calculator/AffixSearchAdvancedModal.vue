<script setup lang="ts">
import { computed } from 'vue'
import type { AffixSearchParams } from '@/utils/affixOptimizer'

/**
 * 词条「求最优分配」高级设置弹窗（2026-09-16）。
 *
 * 四件事：初始候选门槛（%）、候选兜底（每组前 N 名）、路线保留比例（%）、最大保留路线 B。
 * 只负责编辑与回传，存盘在主区块（`affixSearchSettings`）——这里不碰 localStorage。
 */
const props = defineProps<{
  open: boolean
  params: AffixSearchParams
}>()

const emit = defineEmits<{
  close: []
  update: [patch: Partial<AffixSearchParams>]
}>()

/** 百分比输入：存盘值 0..1 ↔ 界面 %（保留一位小数） */
const thresholdPercent = computed({
  get: () => Math.round(props.params.initialCandidateThreshold * 1000) / 10,
  set: (value: number) => emit('update', { initialCandidateThreshold: (Number(value) || 0) / 100 }),
})
const retentionPercent = computed({
  get: () => Math.round(props.params.routeRetentionRatio * 1000) / 10,
  set: (value: number) => emit('update', { routeRetentionRatio: (Number(value) || 0) / 100 }),
})
const floorCount = computed({
  get: () => props.params.initialCandidateFloor,
  set: (value: number) => emit('update', { initialCandidateFloor: Math.max(0, Math.round(Number(value) || 0)) }),
})
const maxRoutes = computed({
  get: () => props.params.maxRetainedRoutes,
  set: (value: number) => emit('update', { maxRetainedRoutes: Math.max(1, Math.round(Number(value) || 1)) }),
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="search-advanced-overlay" role="presentation" @mousedown.self="emit('close')">
      <div class="search-advanced-modal" role="dialog" aria-modal="true" aria-label="求最优分配 · 高级设置">
        <header class="modal-header">
          <h2>求最优分配 · 高级设置</h2>
          <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="modal-body">
          <div class="field-grid">
            <label class="field">
              <span>初始候选门槛</span>
              <span class="field-input-with-suffix">
                <input v-model.lazy.number="thresholdPercent" type="number" min="0" max="100" step="1" />
                <span class="field-suffix">%</span>
              </span>
            </label>
            <label class="field">
              <span>候选兜底（每组前 N 名）</span>
              <input v-model.lazy.number="floorCount" type="number" min="0" max="64" step="1" />
            </label>
            <label class="field">
              <span>路线保留比例</span>
              <span class="field-input-with-suffix">
                <input v-model.lazy.number="retentionPercent" type="number" min="0" max="100" step="1" />
                <span class="field-suffix">%</span>
              </span>
            </label>
            <label class="field">
              <span>最大保留路线</span>
              <input v-model.lazy.number="maxRoutes" type="number" min="1" max="64" step="1" />
            </label>
          </div>

          <p class="modal-note">
            <strong>初始候选门槛</strong>：每条词条先「只加 1 档」看总伤涨多少（单档收益），只跟<strong>自己组内的最高值</strong>比；
            低于「组内最高 × 门槛」的直接出局，后面不再回头捡（越高越激进；0 = 只丢负收益）。
          </p>
          <p class="modal-note">
            <strong>候选兜底</strong>：每组按单档收益排<strong>前 N 名</strong>的条目<strong>一定保留</strong>（只救有正收益的）；
            专门挡住「基线上不值钱、终局里最值钱」的条目（典型：副词条爆伤）被门槛线误剪。0 = 关掉。
            ⚠️ 每组 ≤ N 条时门槛基本失效（默认库上真正被筛的是副词条这种大组）。
          </p>
          <p class="modal-note">
            <strong>路线保留比例</strong>：Beam 每一层只留「累计提升 ≥ 本层最佳 × 比例」的分法（低于线当场丢掉）。
            它和门槛的区别：门槛筛<strong>条目</strong>（开跑前一次），比例筛<strong>分法</strong>（每层反复）。
          </p>
          <p class="modal-note">
            <strong>最大保留路线</strong>：比例筛之后每层最多留几条路线；实际值会按剩余算力自动缩小。
            越大越全、越费算力；越小越快、越可能漏掉「先落后、后反超」的分法。
          </p>
          <p class="modal-note dim">
            空组（临时）条目不参与最优计算，也不显示收益表。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.search-advanced-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.search-advanced-modal {
  width: 640px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 2rem);
  border: 1px solid #2d323a;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  color: #e4e8ef;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #2d323a;
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 1rem;
}

.close-btn {
  border: 0;
  background: transparent;
  color: #cfd6e0;
  font-size: 1.4rem;
  cursor: pointer;
  line-height: 1;
}

.modal-body {
  padding: 0.9rem 1rem 1.1rem;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
  color: #9aa3b0;
}

.field input {
  width: 100%;
  padding: 0.3rem 0.45rem;
  border: 1px solid #3a4049;
  border-radius: 7px;
  background: #10131a;
  color: #e4e8ef;
  font: inherit;
}

.field-input-with-suffix {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.field-suffix {
  color: #9aa3b0;
}

.modal-note {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.6;
  color: #9aa3b0;
}

.modal-note strong {
  color: #d7dde7;
}

.modal-note.dim {
  color: #7b838f;
}
</style>
