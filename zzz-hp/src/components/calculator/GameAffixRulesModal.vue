<script setup lang="ts">
import { computed, ref } from 'vue'
import { affixTargetPickerSummary } from '@/utils/affixTargetBranches'
import { affixPerRollUnit, type AffixLibraryEntry, type AffixLibraryGroup } from '@/utils/affixLibrary'
import {
  GAME_MAIN_SLOT_RESERVE,
  createGameAffixGroups,
} from '@/utils/gameAffixRules'

/**
 * 游戏专用方案编辑：只读结构 + 勾选参与 + 付费占用 x。
 * 不能新建/删除词条或组。
 */

const props = defineProps<{
  open: boolean
  extraCost: number
  enabledIds: string[]
  entries: AffixLibraryEntry[]
  totalRolls: number
}>()

const emit = defineEmits<{
  close: []
  'update:extraCost': [value: number]
  toggleEntry: [entryId: string, enabled: boolean]
  toggleEntries: [entryIds: string[], enabled: boolean]
}>()

const enabledSet = computed(() => new Set(props.enabledIds))
const groups = computed(() => createGameAffixGroups(props.totalRolls))
const activeTab = ref(groups.value[0]?.name ?? 'manage')

const visibleEntries = computed(() => {
  if (activeTab.value === 'manage') return []
  return props.entries.filter((entry) => entry.group === activeTab.value)
})

const allVisibleEnabled = computed(
  () => visibleEntries.value.length > 0 && visibleEntries.value.every((entry) => enabledSet.value.has(entry.id)),
)

const activeGroup = computed(
  () => groups.value.find((group) => group.name === activeTab.value) ?? null,
)

function groupCapText(group: AffixLibraryGroup): string {
  if (group.name === '副词条') {
    return `总分配数 − ${GAME_MAIN_SLOT_RESERVE}（当前 ${group.cap}）`
  }
  return String(group.cap)
}

function perRollHint(entry: AffixLibraryEntry): string {
  return affixPerRollUnit(entry.target) === 'percent' ? '%' : ''
}

function toggleAllVisible() {
  const ids = visibleEntries.value.map((entry) => entry.id)
  if (!ids.length) return
  emit('toggleEntries', ids, !allVisibleEnabled.value)
}

function onExtraCost(event: Event) {
  emit('update:extraCost', Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="game-rules-overlay"
      role="presentation"
      @mousedown.self="emit('close')"
    >
      <div class="game-rules-modal" role="dialog" aria-modal="true" aria-label="游戏专用分配规则">
        <header class="modal-header">
          <h2>游戏专用分配规则</h2>
          <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="toolbar">
          <label class="x-field">
            <span>付费占用 x</span>
            <input
              :value="extraCost"
              type="number"
              min="0"
              max="20"
              step="1"
              @change="onExtraCost"
            />
          </label>
          <p class="toolbar-note">
            与常规方案库无关。方案写死，不能加词条或改组。
            所有副词条条目上限 30。4 / 5 / 6 号位选到攻击、生命、防御时，总分配各扣 x，并扣副词条里对应条目上限 5。
          </p>
        </div>

        <div class="tab-strip" role="tablist">
          <button
            v-for="group in groups"
            :key="group.name"
            type="button"
            class="chip"
            :class="{ active: activeTab === group.name }"
            @click="activeTab = group.name"
          >
            {{ group.name }}
          </button>
        </div>

        <div v-if="activeGroup" class="group-head">
          <span>{{ activeGroup.name }}</span>
          <span>组额度：<strong>{{ groupCapText(activeGroup) }}</strong>（锁死）</span>
          <button type="button" class="chip" :disabled="!visibleEntries.length" @click="toggleAllVisible">
            {{ allVisibleEnabled ? '全部取消' : '全选' }}
          </button>
        </div>

        <div class="entry-scroll">
          <table class="rules-table">
            <thead>
              <tr>
                <th>参与</th>
                <th>名称</th>
                <th>目标</th>
                <th>每档</th>
                <th>上限</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in visibleEntries" :key="entry.id" :class="{ dim: !enabledSet.has(entry.id) }">
                <td>
                  <input
                    type="checkbox"
                    :checked="enabledSet.has(entry.id)"
                    @change="emit('toggleEntry', entry.id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>{{ entry.label }}</td>
                <td class="target-cell">{{ affixTargetPickerSummary(entry.target) }}</td>
                <td>{{ entry.perRoll }}{{ perRollHint(entry) }}</td>
                <td>{{ entry.cap === 0 ? '不限' : entry.cap }}</td>
              </tr>
              <tr v-if="!visibleEntries.length">
                <td colspan="5" class="empty">这一组没有条目。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.game-rules-overlay {
  position: fixed;
  inset: 0;
  z-index: 1250;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.game-rules-modal {
  width: 920px;
  height: 640px;
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

.toolbar {
  display: flex;
  align-items: flex-end;
  gap: 0.85rem;
  padding: 0.7rem 1rem 0.35rem;
  flex-shrink: 0;
}

.x-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}

.x-field input {
  width: 5.5rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid #3a4049;
  border-radius: 7px;
  background: #10131a;
  color: #e4e8ef;
  font: inherit;
}

.toolbar-note {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: #9aa3b0;
}

.tab-strip {
  display: flex;
  gap: 0.35rem;
  padding: 0.45rem 1rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.chip {
  border: 1px solid #3a4049;
  border-radius: 999px;
  background: #10131a;
  color: #cfd6e0;
  font: inherit;
  font-size: 0.78rem;
  padding: 0.2rem 0.7rem;
  cursor: pointer;
}

.chip.active {
  border-color: #c9a55c;
  color: #e8d5a3;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 1rem 0.5rem;
  font-size: 0.78rem;
  color: #9aa3b0;
  flex-shrink: 0;
}

.entry-scroll {
  flex: 1 1 auto;
  overflow: auto;
  padding: 0 1rem 1rem;
}

.rules-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.rules-table th,
.rules-table td {
  border-bottom: 1px solid #2d323a;
  padding: 0.35rem 0.4rem;
  text-align: left;
}

.rules-table tr.dim td {
  opacity: 0.55;
}

.target-cell {
  color: #9aa3b0;
}

.empty {
  color: #8b94a1;
  text-align: center;
}

/*
 * Teleport 到 body，白天主题靠 html[data-theme=light] 覆盖（与词条库弹窗同一套）。
 */
:global([data-theme='light']) .game-rules-overlay {
  background: rgba(15, 23, 42, 0.35);
}

:global([data-theme='light']) .game-rules-modal {
  border-color: #d5dae3;
  background: linear-gradient(180deg, #ffffff 0%, #f6f8fb 100%);
  color: #1c212a;
  box-shadow: 0 18px 48px rgba(16, 24, 40, 0.12);
}

:global([data-theme='light']) .game-rules-modal .modal-header {
  border-bottom-color: #e4e7ec;
}

:global([data-theme='light']) .game-rules-modal .modal-header h2 {
  color: #1c212a;
}

:global([data-theme='light']) .game-rules-modal .close-btn {
  color: #667085;
}

:global([data-theme='light']) .game-rules-modal .close-btn:hover {
  color: #1c212a;
}

:global([data-theme='light']) .game-rules-modal .x-field,
:global([data-theme='light']) .game-rules-modal .toolbar-note,
:global([data-theme='light']) .game-rules-modal .group-head,
:global([data-theme='light']) .game-rules-modal .target-cell,
:global([data-theme='light']) .game-rules-modal .empty {
  color: #667085;
}

:global([data-theme='light']) .game-rules-modal .x-field input {
  border-color: #d5dae3;
  background: #ffffff;
  color: #1c212a;
}

:global([data-theme='light']) .game-rules-modal .chip {
  border-color: #d5dae3;
  background: #f5f7fa;
  color: #344054;
}

:global([data-theme='light']) .game-rules-modal .chip:hover:not(:disabled) {
  border-color: #c9a55c;
  color: #1c212a;
}

:global([data-theme='light']) .game-rules-modal .chip.active {
  border-color: #c9a55c;
  background: #fff8eb;
  color: #1c212a;
}

:global([data-theme='light']) .game-rules-modal .group-head strong {
  color: #8a6d28;
}

:global([data-theme='light']) .game-rules-modal .rules-table th {
  background: #f1efe9;
  color: #667085;
  border-bottom-color: #e4e7ec;
}

:global([data-theme='light']) .game-rules-modal .rules-table td {
  border-bottom-color: #f0f1f4;
  color: #1c212a;
}

:global([data-theme='light']) .game-rules-modal .rules-table .target-cell {
  color: #667085;
}
</style>
