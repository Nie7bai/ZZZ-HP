<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'

export interface EquipPickerChip {
  id: string
  label: string
  active?: boolean
  highlight?: boolean
}

export interface EquipPickerChipGroup {
  label?: string
  chips: EquipPickerChip[]
}

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    searchPlaceholder?: string
    emptyText?: string
    items?: Array<Record<string, unknown>>
    selectedId?: string | null
    selectedLabel?: string
    selectedAvatar?: string | null
    /** 单行 chips（兼容）；有 chipGroups 时优先用分组 */
    chips?: EquipPickerChip[]
    chipGroups?: EquipPickerChipGroup[]
    allowNone?: boolean
    noneLabel?: string
  }>(),
  {
    searchPlaceholder: '搜索…',
    emptyText: '无匹配项',
    items: () => [],
    allowNone: false,
    noneLabel: '不选择',
  },
)

const emit = defineEmits<{
  select: [id: string]
  chipClick: [id: string]
}>()

const open = defineModel<boolean>('open', { default: false })

const search = ref('')

watch(open, (isOpen) => {
  if (!isOpen) search.value = ''
})

const resolvedChipGroups = computed<EquipPickerChipGroup[]>(() => {
  if (props.chipGroups?.length) return props.chipGroups
  if (props.chips?.length) return [{ chips: props.chips }]
  return []
})

function getId(item: Record<string, unknown>) {
  return String(item.id ?? '')
}

function getName(item: Record<string, unknown>) {
  return String(item.name ?? item.label ?? item.id ?? '')
}

function getAvatar(item: Record<string, unknown>) {
  const img = item.avatar_image ?? item.avatarImage
  return typeof img === 'string' ? img : null
}

function matchesSearch(item: Record<string, unknown>, keyword: string) {
  if (!keyword) return true
  const hay = [
    getName(item),
    String(item.profession ?? ''),
    String(item.element ?? ''),
    String(item.rarity ?? ''),
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(keyword)
}

const filteredItems = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return props.items.filter((item) => matchesSearch(item, keyword))
})

function close() {
  open.value = false
}

function pick(id: string) {
  emit('select', id)
  close()
}

function onChip(chip: EquipPickerChip) {
  emit('chipClick', chip.id)
}
</script>

<template>
  <button type="button" class="picker-summary" @click="open = true">
    <div v-if="selectedLabel" class="picker-selected">
      <CalculatorAvatar
        v-if="selectedAvatar !== undefined"
        class="picker-avatar"
        :avatar-image="selectedAvatar"
        :name="selectedLabel"
      />
      <span class="picker-name">{{ selectedLabel }}</span>
    </div>
    <span v-else class="picker-placeholder">未选择</span>
    <span class="picker-open-hint" aria-hidden="true">点击此处选择或切换</span>
  </button>

  <Teleport to="body">
    <div v-if="open" class="equip-picker-overlay" role="presentation" @click.self="close">
      <div class="equip-picker-modal" role="dialog" aria-modal="true" :aria-label="title">
        <header class="equip-picker-header">
          <div>
            <h3>{{ title }}</h3>
            <p v-if="description">{{ description }}</p>
          </div>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
        </header>

        <div class="toolbar">
          <input
            v-model="search"
            type="search"
            class="search"
            :placeholder="searchPlaceholder"
          />
        </div>

        <div v-for="(group, index) in resolvedChipGroups" :key="group.label ?? index" class="chip-group">
          <p v-if="group.label" class="chip-group-label">{{ group.label }}</p>
          <div class="chip-row">
            <button
              v-for="chip in group.chips"
              :key="chip.id"
              type="button"
              class="chip"
              :class="{ active: chip.active, highlight: chip.highlight }"
              @click="onChip(chip)"
            >
              {{ chip.label }}
            </button>
          </div>
        </div>

        <div class="item-grid">
          <button
            v-if="allowNone"
            type="button"
            class="item-cell"
            :class="{ active: !selectedId || selectedId === 'none' }"
            @click="pick('none')"
          >
            <span class="item-placeholder">—</span>
            <span class="item-name">{{ noneLabel }}</span>
          </button>
          <button
            v-for="item in filteredItems"
            :key="getId(item)"
            type="button"
            class="item-cell"
            :class="{ active: selectedId === getId(item) }"
            @click="pick(getId(item))"
          >
            <CalculatorAvatar
              v-if="getAvatar(item)"
              class="item-avatar"
              :avatar-image="getAvatar(item)"
              :name="getName(item)"
            />
            <span v-else class="item-placeholder">?</span>
            <span class="item-name">{{ getName(item) }}</span>
          </button>
        </div>

        <p v-if="!filteredItems.length && !allowNone" class="empty-hint">{{ emptyText }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.picker-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: #0f1217;
  border: 1px solid #2d323a;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.picker-summary:hover {
  border-color: #c9a55c;
  background: #141820;
}

.picker-selected {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.picker-avatar :deep(.calculator-avatar) {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}

.picker-name {
  font-size: 0.88rem;
  color: #e4e8ef;
  font-weight: 600;
}

.picker-placeholder {
  font-size: 0.84rem;
  color: #9aa3b0;
}

.picker-open-hint {
  flex-shrink: 0;
  border: 1px solid #343a44;
  border-radius: 8px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  pointer-events: none;
  white-space: nowrap;
}

.picker-summary:hover .picker-open-hint {
  border-color: #c9a55c;
  color: #f0d7a2;
}

.equip-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.equip-picker-modal {
  width: min(720px, 100%);
  max-height: min(85vh, 720px);
  overflow: auto;
  border: 1px solid #2d323a;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}

.equip-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.equip-picker-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #f0f2f6;
}

.equip-picker-header p {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #9aa3b0;
}

.close-btn {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.toolbar {
  margin-bottom: 0.65rem;
}

.search {
  width: 100%;
  border: 1px solid #313640;
  border-radius: 10px;
  background: #0f1217;
  color: #edf0f5;
  padding: 0.55rem 0.75rem;
  font-size: 0.88rem;
}

.chip-group {
  margin-bottom: 0.65rem;
}

.chip-group-label {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.28rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.chip.active,
.chip.highlight {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}

.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 0.45rem;
}

.item-cell {
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #10141a;
  color: #e4e8ef;
  padding: 0.45rem 0.35rem 0.35rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.item-cell.active {
  border-color: #c9a55c;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.35);
}

.item-avatar :deep(.calculator-avatar) {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}

.item-placeholder {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #1a1f27;
  color: #7d8796;
}

.item-name {
  font-size: 0.72rem;
  text-align: center;
  line-height: 1.2;
}

.empty-hint {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
  text-align: center;
}
</style>
