<script setup lang="ts">
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'

defineProps<{
  index: number
  slot: TeamSlot
  agent?: AgentBuffDoc
  wengineName?: string
  driveDiscSummary?: string
  isActive: boolean
}>()

const emit = defineEmits<{
  select: []
  remove: []
  toggleMainC: []
  'update:rank': [value: number]
}>()
</script>

<template>
  <article
    class="slot-card"
    :class="{ active: isActive, filled: Boolean(agent) }"
    @click="emit('select')"
  >
    <template v-if="agent">
      <header class="slot-header">
        <CalculatorAvatar class="slot-avatar" :avatar-image="agent.avatar_image" :name="agent.name" />
        <div class="slot-meta">
          <strong>{{ agent.name }}</strong>
          <span>{{ agent.element }} | {{ agent.profession }}</span>
        </div>
        <div class="slot-badges">
          <span class="badge role">{{ agent.profession }}</span>
          <span class="badge element">{{ agent.element }}</span>
        </div>
      </header>

      <div class="rank-row" @click.stop>
        <input
          class="rank-slider"
          type="range"
          min="0"
          max="6"
          step="1"
          :value="slot.rank"
          @input="emit('update:rank', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="rank-label">{{ slot.rank }}影</span>
      </div>

      <div class="wengine-box">
        <p class="wengine-title">音擎</p>
        <p class="wengine-hint">
          {{ wengineName ? `已选：${wengineName}` : '请在下方网格中选择音擎' }}
        </p>
      </div>

      <div class="wengine-box drive-disc-box">
        <p class="wengine-title">驱动盘</p>
        <p class="wengine-hint">{{ driveDiscSummary ?? '未选择' }}</p>
      </div>

      <footer class="slot-footer" @click.stop>
        <label class="main-c">
          <input type="checkbox" :checked="slot.isMainC" @change="emit('toggleMainC')" />
          <span>主C</span>
        </label>
        <button type="button" class="remove-btn" @click="emit('remove')">移除</button>
        <span v-if="isActive" class="editing-badge">编辑中</span>
      </footer>
    </template>

    <template v-else>
      <p class="empty-title">槽位 {{ index + 1 }}</p>
      <p class="empty-hint">请从下方网格中选择代理人。</p>
    </template>
  </article>
</template>

<style scoped>
.slot-card {
  min-height: 260px;
  border: 1px solid #3a342c;
  border-radius: 14px;
  background: linear-gradient(180deg, #1a1714 0%, #14120f 100%);
  padding: 0.85rem;
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.slot-card.active {
  border-color: #c9a55c;
  box-shadow: 0 0 0 1px rgba(201, 165, 92, 0.25);
}

.slot-card.filled:hover {
  border-color: #9f8454;
}

.slot-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.55rem;
  align-items: center;
}

.slot-avatar :deep(.calculator-avatar) {
  width: 52px;
  height: 52px;
}

.slot-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.slot-meta strong {
  font-size: 1rem;
  color: #f2ead8;
}

.slot-meta span {
  font-size: 0.78rem;
  color: #b7aa93;
}

.slot-badges {
  display: flex;
  gap: 0.3rem;
}

.badge {
  min-width: 24px;
  height: 24px;
  padding: 0 0.4rem;
  border-radius: 6px;
  border: 1px solid #4a4033;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}

.badge.role {
  color: #f0d7a2;
  background: #2a241b;
}

.badge.element {
  color: #d8e4ff;
  background: #1d2430;
}

.rank-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.rank-slider {
  flex: 1;
  accent-color: #c9a55c;
}

.rank-label {
  min-width: 2.4rem;
  text-align: right;
  font-size: 0.82rem;
  color: #d8c39a;
}

.wengine-box {
  border: 1px solid #2f2a24;
  border-radius: 10px;
  background: #10100e;
  padding: 0.55rem 0.65rem;
}

.wengine-title {
  margin: 0;
  font-size: 0.78rem;
  color: #c9a55c;
}

.wengine-hint {
  margin: 0.25rem 0 0;
  font-size: 0.76rem;
  color: #8f8678;
}

.slot-footer {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.main-c {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: #d8c39a;
}

.remove-btn {
  margin-left: auto;
  border: 1px solid #4a4033;
  border-radius: 8px;
  background: #1c1915;
  color: #d8c8aa;
  padding: 0.28rem 0.65rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.remove-btn:hover {
  border-color: #c9a55c;
}

.editing-badge {
  border-radius: 999px;
  background: linear-gradient(180deg, #c9a55c, #9f7d3f);
  color: #1a140d;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
}

.empty-title {
  margin: 0;
  text-align: center;
  color: #c9a55c;
  font-size: 0.95rem;
}

.empty-hint {
  margin: auto 0;
  text-align: center;
  color: #8f8678;
  font-size: 0.86rem;
  line-height: 1.6;
}
</style>
