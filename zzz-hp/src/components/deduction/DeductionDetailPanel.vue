<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  deductionNodeTypeLabel,
  deductionPeriodDisplay,
  fetchDeductionPhases,
  isDeductionBattleNode,
  isDeductionStoryNode,
  type DeductionNode,
  type DeductionPeriod,
} from '@/api/deduction'
import { formatHp } from '@/utils/gameData'
import { parseElementIcons } from '@/utils/elementIcons'

const periods = ref<DeductionPeriod[]>([])
const currentIndex = ref(0)
const activeNodeIndex = ref(0)
const loading = ref(false)
const loadError = ref('')
const showPicker = ref(false)

const currentPeriod = computed<DeductionPeriod | null>(
  () => periods.value[currentIndex.value] ?? null,
)

const activeNode = computed<DeductionNode | null>(
  () => currentPeriod.value?.nodes[activeNodeIndex.value] ?? null,
)

watch(currentPeriod, () => {
  activeNodeIndex.value = 0
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    periods.value = await fetchDeductionPhases()
    currentIndex.value = periods.value.length - 1
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    periods.value = []
  } finally {
    loading.value = false
  }
}

function prevPeriod() {
  if (currentIndex.value > 0) currentIndex.value--
}

function nextPeriod() {
  if (currentIndex.value < periods.value.length - 1) currentIndex.value++
}

function selectPeriod(index: number) {
  currentIndex.value = index
  showPicker.value = false
}

function selectNode(index: number) {
  activeNodeIndex.value = index
}

function onImageError(event: Event) {
  ;(event.target as HTMLImageElement).style.display = 'none'
}

onMounted(load)
</script>

<template>
  <div class="dd-panel">
    <div v-if="loading" class="dd-state">加载中…</div>
    <div v-else-if="loadError" class="dd-state dd-state--error">加载失败：{{ loadError }}</div>
    <div v-else-if="!currentPeriod" class="dd-state">暂无推演数据</div>

    <template v-else>
      <!-- 期数导航 -->
      <div class="dd-topbar">
        <button class="dd-nav" type="button" :disabled="currentIndex === 0" @click="prevPeriod">
          ‹
        </button>
        <button class="dd-period-btn" type="button" @click="showPicker = true">
          {{ deductionPeriodDisplay(currentPeriod) }}
          <span class="dd-period-caret">▾</span>
        </button>
        <button
          class="dd-nav"
          type="button"
          :disabled="currentIndex >= periods.length - 1"
          @click="nextPeriod"
        >
          ›
        </button>
      </div>

      <!-- 节点页签 -->
      <div v-if="currentPeriod.nodes.length" class="dd-tabs">
        <button
          v-for="(node, index) in currentPeriod.nodes"
          :key="node.nodeId"
          type="button"
          class="dd-tab"
          :class="{
            'dd-tab--active': index === activeNodeIndex,
            'dd-tab--story': isDeductionStoryNode(node.type),
            'dd-tab--battle': isDeductionBattleNode(node.type),
          }"
          @click="selectNode(index)"
        >
          {{ node.name }}
        </button>
      </div>

      <!-- 当前节点内容 -->
      <div v-if="activeNode" class="dd-node-view">
        <article
          class="dd-card"
          :class="isDeductionBattleNode(activeNode.type) ? 'dd-card--battle' : 'dd-card--story'"
        >
          <header class="dd-card-head">
            <span
              class="dd-badge"
              :class="{ 'dd-badge--battle': isDeductionBattleNode(activeNode.type) }"
            >
              {{ deductionNodeTypeLabel(activeNode.type) }}
            </span>
            <h3 class="dd-card-title">{{ activeNode.name }}</h3>
          </header>

          <!-- 故事节点 -->
          <p v-if="activeNode.storyText" class="dd-story-text">{{ activeNode.storyText }}</p>

          <!-- 战斗节点：可选增益置顶 -->
          <section
            v-if="isDeductionBattleNode(activeNode.type) && activeNode.buffs.length"
            class="dd-buffs"
          >
            <h4 class="dd-section-title">可选增益</h4>
            <div v-for="buff in activeNode.buffs" :key="buff.title" class="dd-buff">
              <div class="dd-buff-head">
                <img
                  v-if="buff.buff_image"
                  class="dd-buff-img"
                  :src="buff.buff_image"
                  :alt="buff.title"
                  loading="lazy"
                  @error="onImageError"
                />
                <strong class="dd-buff-title">{{ buff.title }}</strong>
              </div>
              <p v-if="buff.desc" class="dd-buff-desc">{{ buff.desc }}</p>
            </div>
          </section>

          <!-- 战斗节点：层 + 怪物 -->
          <section v-if="isDeductionBattleNode(activeNode.type)" class="dd-layers">
            <h4 v-if="activeNode.layers.length" class="dd-section-title">关卡层</h4>
            <div v-for="layer in activeNode.layers" :key="layer.name" class="dd-layer">
              <h5 class="dd-layer-title">{{ layer.name }}</h5>
              <div v-if="layer.monsters.length" class="dd-monsters">
                <div v-for="monster in layer.monsters" :key="monster.name" class="dd-monster">
                  <div class="dd-monster-main">
                    <img
                      v-if="monster.boss_image"
                      class="dd-monster-img"
                      :src="monster.boss_image"
                      alt=""
                      loading="lazy"
                      @error="onImageError"
                    />
                    <div class="dd-monster-info">
                      <div class="dd-monster-name">
                        {{ monster.name }}
                        <span class="dd-monster-lv">Lv{{ monster.level }}</span>
                      </div>
                      <div class="dd-monster-stats">
                        <span class="dd-stat">HP {{ formatHp(monster.hp) }}</span>
                        <span class="dd-stat">防御 {{ formatHp(monster.defense) }}</span>
                        <span v-if="parseElementIcons(monster.weakness).length" class="dd-stat dd-stat--weak">
                          弱
                          <span
                            v-for="elem in parseElementIcons(monster.weakness)"
                            :key="elem.name"
                            class="dd-elem"
                          >
                            <img
                              class="dd-elem-img"
                              :src="elem.icon"
                              :alt="elem.name"
                              :title="elem.name"
                              loading="lazy"
                            />
                            <span class="dd-elem-name">{{ elem.name }}</span>
                          </span>
                        </span>
                        <span v-if="parseElementIcons(monster.resistance).length" class="dd-stat dd-stat--resist">
                          抗
                          <span
                            v-for="elem in parseElementIcons(monster.resistance)"
                            :key="elem.name"
                            class="dd-elem"
                          >
                            <img
                              class="dd-elem-img"
                              :src="elem.icon"
                              :alt="elem.name"
                              :title="elem.name"
                              loading="lazy"
                            />
                            <span class="dd-elem-name">{{ elem.name }}</span>
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="dd-empty">该层暂无怪物数据</div>
            </div>
          </section>
        </article>
      </div>

      <!-- 期数选择 -->
      <Teleport to="body">
        <div v-if="showPicker" class="dd-picker-mask" @click.self="showPicker = false">
          <div class="dd-picker">
            <h4 class="dd-picker-title">选择推演期数</h4>
            <button
              v-for="(period, index) in periods"
              :key="period.periodId"
              class="dd-picker-item"
              :class="{ 'dd-picker-item--active': index === currentIndex }"
              type="button"
              @click="selectPeriod(index)"
            >
              {{ deductionPeriodDisplay(period) }}
              <span class="dd-picker-meta">{{ period.nodes.length }} 个节点</span>
            </button>
            <button class="dd-picker-close" type="button" @click="showPicker = false">关闭</button>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.dd-panel {
  min-height: 100%;
  padding: 0.5rem 0.25rem 2rem;
}

.dd-state {
  min-height: 40vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  opacity: 0.65;
  font-size: 1rem;
}

.dd-state--error {
  color: #ef4444;
}

/* 期数导航 */
.dd-topbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.dd-nav {
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  background: var(--zzz-ink-2, var(--color-background-soft));
  color: var(--color-heading);
  font-size: 1.2rem;
  cursor: pointer;
  flex-shrink: 0;
}

.dd-nav:disabled {
  opacity: 0.35;
  cursor: default;
}

.dd-period-btn {
  min-width: 9rem;
  height: 2.6rem;
  padding: 0 1.2rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  background: var(--zzz-ink-2, var(--color-background-soft));
  color: var(--color-heading);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.dd-period-caret {
  margin-left: 0.4rem;
  opacity: 0.6;
  font-size: 0.8rem;
}

/* 节点页签 */
.dd-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
  padding: 0.4rem 0 0.8rem;
  margin-bottom: 0.6rem;
  border-bottom: 1px dashed var(--zzz-line, var(--color-border));
}

.dd-tab {
  padding: 0.32rem 0.75rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 999px;
  background: transparent;
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text);
  opacity: 0.75;
  cursor: pointer;
  transition:
    opacity 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}

.dd-tab--story {
  border-color: color-mix(in srgb, #a78bfa 40%, var(--zzz-line, var(--color-border)));
}

.dd-tab--battle {
  border-color: color-mix(in srgb, #f59e0b 40%, var(--zzz-line, var(--color-border)));
}

.dd-tab--active {
  opacity: 1;
  color: var(--color-heading);
}

.dd-tab--story.dd-tab--active {
  background: color-mix(in srgb, #a78bfa 24%, transparent);
  border-color: #a78bfa;
}

.dd-tab--battle.dd-tab--active {
  background: color-mix(in srgb, #f59e0b 24%, transparent);
  border-color: #f59e0b;
}

/* 节点卡片 */
.dd-node-view {
  padding-bottom: 1rem;
}

.dd-card {
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 10px;
  padding: 0.85rem 1rem;
  background: var(--color-background-soft);
}

.dd-card--battle {
  border-color: color-mix(in srgb, #f59e0b 45%, var(--zzz-line, var(--color-border)));
}

.dd-card--story {
  border-color: color-mix(in srgb, #a78bfa 45%, var(--zzz-line, var(--color-border)));
}

.dd-card-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.dd-badge {
  flex-shrink: 0;
  padding: 0.16rem 0.55rem;
  border-radius: 6px;
  background: color-mix(in srgb, #a78bfa 22%, transparent);
  color: #c4b5fd;
  font-size: 0.78rem;
  font-weight: 700;
}

.dd-badge--battle {
  background: color-mix(in srgb, #f59e0b 22%, transparent);
  color: #fcd34d;
}

.dd-card-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--color-heading);
  letter-spacing: 0.03em;
}

/* 剧情文本 */
.dd-story-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.75;
  color: var(--color-text);
  opacity: 0.92;
  font-size: 0.95rem;
}

/* 区块标题 */
.dd-section-title {
  margin: 0 0 0.55rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.85;
  font-family: var(--zzz-font-mono, monospace);
  letter-spacing: 0.05em;
}

/* 可选增益（战斗卡顶部） */
.dd-buffs {
  margin-bottom: 0.9rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px dashed var(--zzz-line, var(--color-border));
}

.dd-buff {
  padding: 0.4rem 0;
}

.dd-buff + .dd-buff {
  border-top: 1px dotted var(--zzz-line, var(--color-border));
}

.dd-buff-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.dd-buff-img {
  width: 2rem;
  height: 2rem;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--zzz-line, var(--color-border));
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  flex-shrink: 0;
}

.dd-buff-title {
  color: #fcd34d;
  font-size: 0.9rem;
  font-weight: 800;
}

.dd-buff-desc {
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
  line-height: 1.65;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.9;
}

/* 战斗层 */
.dd-layers {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.dd-layer {
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
}

.dd-layer-title {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.85;
  font-family: var(--zzz-font-mono, monospace);
  letter-spacing: 0.05em;
}

.dd-monsters {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.dd-monster {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.45rem 0.55rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-text) 5%, transparent);
}

.dd-monster-main {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.dd-monster-img {
  width: 3rem;
  height: 3rem;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--zzz-line, var(--color-border));
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  flex-shrink: 0;
}

.dd-monster-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.dd-monster-name {
  font-weight: 700;
  color: var(--color-heading);
  font-size: 0.92rem;
}

.dd-monster-lv {
  margin-left: 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
  opacity: 0.7;
}

.dd-monster-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
}

.dd-stat {
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.85;
}

.dd-stat--weak {
  color: #34d399;
}

.dd-stat--resist {
  color: #f87171;
}

.dd-elem {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: 0.35rem;
}

.dd-elem-name {
  font-size: 0.78rem;
}

.dd-elem-img {
  width: 1.05em;
  height: 1.05em;
  border-radius: 2px;
}

.dd-empty {
  color: var(--color-text);
  opacity: 0.5;
  font-size: 0.82rem;
}

/* 期数选择 */
.dd-picker-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dd-picker {
  width: min(92vw, 340px);
  max-height: 70vh;
  overflow-y: auto;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dd-picker-title {
  margin: 0 0 0.25rem;
  color: var(--color-heading);
  font-size: 0.95rem;
}

.dd-picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.92rem;
  font-weight: 700;
  cursor: pointer;
}

.dd-picker-item--active {
  border-color: #f59e0b;
  color: #fcd34d;
}

.dd-picker-meta {
  font-size: 0.75rem;
  font-weight: 400;
  opacity: 0.6;
}

.dd-picker-close {
  margin-top: 0.4rem;
  padding: 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--zzz-line, var(--color-border));
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

@media (max-width: 768px) {
  .dd-panel {
    padding: 0.25rem 0 2rem;
  }

  .dd-card {
    padding: 0.7rem 0.75rem;
  }

  .dd-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    justify-content: flex-start;
    padding-bottom: 0.5rem;
  }

  .dd-tab {
    flex-shrink: 0;
  }
}
</style>
