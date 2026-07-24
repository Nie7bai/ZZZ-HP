<script setup lang="ts">
import { computed } from 'vue'
import {
  expBarLabel,
  expBarPercent,
  levelGrowthRows,
  mapExpProgress,
  type GuestbookExpDailyTask,
} from '@/utils/guestbookLevel'

const props = defineProps<{
  level?: number
  exp?: number
  showDaily?: boolean
  dailyTasks?: GuestbookExpDailyTask[]
}>()

const progress = computed(() => mapExpProgress(props.level, props.exp))
const barPercent = computed(() => expBarPercent(progress.value))
const barLabel = computed(() => expBarLabel(progress.value))
const growthRows = computed(() => levelGrowthRows())

const nextLevelHint = computed(() => {
  if (progress.value.isMaxLevel) return '已满级，经验继续累积'
  const need = progress.value.expRequired ?? 0
  const remain = Math.max(need - progress.value.exp, 0)
  return `距离 Lv.${progress.value.level + 1} 还需 ${remain} 经验`
})
</script>

<template>
  <section class="gb-level-card">
    <header class="gb-level-card__head">
      <div>
        <h3 class="gb-level-card__title">等级成长</h3>
        <p class="gb-level-card__hint">{{ nextLevelHint }}</p>
      </div>
      <span class="gb-level-card__level">
        <strong>{{ progress.level }}</strong>
        <small>LEVEL</small>
      </span>
    </header>

    <div class="gb-level-card__bar" :class="{ 'is-max': progress.isMaxLevel }">
      <span class="gb-level-card__bar-fill" :style="{ width: `${barPercent}%` }" />
      <span class="gb-level-card__bar-text">{{ barLabel }}</span>
    </div>

    <details v-if="showDaily && dailyTasks?.length" class="gb-level-card__fold">
      <summary>今日经验获取</summary>
      <ul class="gb-level-card__tasks">
        <li v-for="task in dailyTasks" :key="task.key" class="gb-level-card__task">
          <div class="gb-level-card__task-main">
            <strong>{{ task.label }}</strong>
            <span class="gb-level-card__task-exp">+{{ task.exp }}</span>
            <span class="gb-level-card__task-count">{{ task.used }}/{{ task.dailyLimit }} 次</span>
          </div>
          <div class="gb-level-card__task-track">
            <span
              class="gb-level-card__task-fill"
              :style="{ width: `${Math.min(100, (task.used / task.dailyLimit) * 100)}%` }"
            />
          </div>
        </li>
      </ul>
    </details>

    <details class="gb-level-card__fold">
      <summary>等级经验表</summary>
      <ul class="gb-level-card__growth-list">
        <li
          v-for="row in growthRows"
          :key="row.level"
          :class="{ 'is-current': row.level === progress.level }"
        >
          <span>Lv.{{ row.level }} → Lv.{{ row.level + 1 }}</span>
          <strong>{{ row.required }}</strong>
        </li>
        <li class="is-max-row">
          <span>Lv.16</span>
          <strong>满级</strong>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.gb-level-card {
  margin: 0 0 0.75rem;
  padding: 0.85rem 0.95rem;
  border: 1px solid #2a2a2a;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
}

.gb-level-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}

.gb-level-card__title {
  margin: 0;
  color: #fff;
  font-size: 0.92rem;
  font-weight: 800;
}

.gb-level-card__hint {
  margin: 0.2rem 0 0;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.72rem;
}

.gb-level-card__level {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #fff;
  line-height: 1;
}

.gb-level-card__level strong {
  font-size: 1.35rem;
  font-weight: 900;
}

.gb-level-card__level small {
  margin-top: 0.15rem;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.gb-level-card__bar {
  position: relative;
  height: 1.1rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.gb-level-card__bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #4f8cff, #7ec8ff);
}

.gb-level-card__bar-text {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #fff;
  font-size: 0.68rem;
  font-weight: 800;
}

.gb-level-card__fold {
  margin-top: 0.75rem;
}

.gb-level-card__fold summary {
  cursor: pointer;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.74rem;
  font-weight: 700;
}

.gb-level-card__tasks {
  list-style: none;
  margin: 0.55rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.gb-level-card__task-main {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.28rem;
  color: #fff;
  font-size: 0.76rem;
}

.gb-level-card__task-main strong {
  font-weight: 700;
}

.gb-level-card__task-exp {
  color: #fbfe00;
  font-weight: 800;
}

.gb-level-card__task-count {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.68rem;
}

.gb-level-card__task-track {
  height: 0.45rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.gb-level-card__task-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #fbfe00, #d8ff4d);
}

.gb-level-card__growth-list {
  list-style: none;
  margin: 0.55rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
}

.gb-level-card__growth-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.68rem;
}

.gb-level-card__growth-list li.is-current {
  background: rgba(79, 140, 255, 0.16);
  color: #fff;
}

.gb-level-card__growth-list li.is-max-row {
  grid-column: 1 / -1;
}

.gb-level-card__growth-list strong {
  color: #fff;
  font-weight: 800;
}
</style>
