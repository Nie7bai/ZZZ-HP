<script setup lang="ts">
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'

defineProps<{
  index: number
  slot: TeamSlot
  agent?: AgentBuffDoc
  wengine?: WengineBuffDoc
  twoPieceDisc?: DriveDiscBuffDoc
  fourPieceDisc?: DriveDiscBuffDoc
  isActive: boolean
}>()

const emit = defineEmits<{
  select: []
  remove: []
  toggleMainC: []
  'update:rank': [value: number]
  'update:refine': [value: number]
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
        <span class="row-label">影画</span>
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

      <div class="gear-row" @click.stop>
        <CalculatorAvatar class="gear-avatar" :avatar-image="wengine?.avatar_image" :name="wengine?.name ?? '未佩戴'" />
        <div class="gear-info">
          <div class="gear-name">
            <span class="gear-tag">音擎</span>
            <span>{{ wengine ? wengine.name : '未佩戴' }}</span>
          </div>
          <div class="refine-row">
            <span class="row-label">精炼</span>
            <input
              class="rank-slider"
              type="range"
              min="1"
              max="5"
              step="1"
              :value="slot.wengineRefine"
              :disabled="!wengine || wengine.id === 'none'"
              @input="emit('update:refine', Number(($event.target as HTMLInputElement).value))"
            />
            <span class="rank-label">精{{ wengine ? slot.wengineRefine : '-' }}</span>
          </div>
        </div>
      </div>

      <div class="disc-row" @click.stop>
        <div class="disc-item">
          <CalculatorAvatar class="gear-avatar" :avatar-image="fourPieceDisc?.avatar_image" :name="fourPieceDisc?.name ?? '4件'" />
          <div class="disc-text">
            <span class="disc-tag">4件套</span>
            <span class="disc-name">{{ fourPieceDisc ? fourPieceDisc.name : '未选' }}</span>
          </div>
        </div>
        <div class="disc-item">
          <CalculatorAvatar class="gear-avatar" :avatar-image="twoPieceDisc?.avatar_image" :name="twoPieceDisc?.name ?? '2件'" />
          <div class="disc-text">
            <span class="disc-tag">2件套</span>
            <span class="disc-name">{{ twoPieceDisc ? twoPieceDisc.name : '未选' }}</span>
          </div>
        </div>
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
      <p class="empty-hint">请点击下方「导入」选择代理人。</p>
    </template>
  </article>
</template>

<style scoped>
.slot-card {
  min-height: 320px;
  border: 1px solid #3a342c;
  border-radius: 14px;
  background: linear-gradient(180deg, #1a1714 0%, #14120f 100%);
  padding: 1rem;
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
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
  gap: 0.6rem;
  align-items: center;
}

.slot-avatar :deep(.calculator-avatar) {
  width: 64px;
  height: 64px;
  border-radius: 12px;
}

.slot-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.slot-meta strong {
  font-size: 1.05rem;
  color: #f2ead8;
}

.slot-meta span {
  font-size: 0.78rem;
  color: #b7aa93;
}

.slot-badges {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-end;
}

.badge {
  min-width: 24px;
  height: 22px;
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

.rank-row,
.gear-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.row-label {
  font-size: 0.76rem;
  color: #c9a55c;
  min-width: 2rem;
}

.rank-slider {
  flex: 1;
  accent-color: #c9a55c;
}

.rank-slider:disabled {
  opacity: 0.45;
}

.rank-label {
  min-width: 2.6rem;
  text-align: right;
  font-size: 0.82rem;
  color: #d8c39a;
}

.gear-row {
  padding: 0.55rem 0.6rem;
  border: 1px solid #2f2a24;
  border-radius: 10px;
  background: #10100e;
}

.gear-avatar :deep(.calculator-avatar) {
  width: 52px;
  height: 52px;
  border-radius: 10px;
}

.gear-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.gear-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.84rem;
  color: #e4e8ef;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gear-tag {
  flex-shrink: 0;
  font-size: 0.68rem;
  color: #c9a55c;
  border: 1px solid #4a4033;
  border-radius: 5px;
  padding: 0.05rem 0.35rem;
}

.refine-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.disc-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.disc-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid #2f2a24;
  border-radius: 10px;
  background: #10100e;
  min-width: 0;
}

.disc-text {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.84rem;
  color: #e4e8ef;
}

.disc-tag {
  flex-shrink: 0;
  font-size: 0.66rem;
  color: #c9a55c;
  border: 1px solid #4a4033;
  border-radius: 5px;
  padding: 0.05rem 0.3rem;
}

.disc-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slot-footer {
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

@media (max-width: 768px) {
  .slot-card {
    min-height: 0;
    padding: 0.8rem;
    gap: 0.6rem;
  }

  .slot-avatar :deep(.calculator-avatar) {
    width: 56px;
    height: 56px;
  }

  .slot-meta strong {
    font-size: 0.98rem;
  }

  .slot-footer {
    flex-wrap: wrap;
  }

  .remove-btn {
    min-height: 2rem;
  }
}
</style>
