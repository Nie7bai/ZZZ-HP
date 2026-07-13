<script setup lang="ts">
import type { AdminCalculatorPanel } from '@/types/calculator'
import {
  AGENT_BUFF_EDIT_ACTIONS,
  AGENT_BUFF_EDIT_SECTIONS,
  type AgentBuffEditActionId,
} from '@/constants/agentBuffEditNav'
import {
  BANGBOO_BUFF_EDIT_ACTIONS,
  BANGBOO_BUFF_EDIT_SECTIONS,
  type BangbooBuffEditActionId,
} from '@/constants/bangbooBuffEditNav'
import {
  DRIVE_DISC_BUFF_EDIT_ACTIONS,
  DRIVE_DISC_BUFF_EDIT_SECTIONS,
  type DriveDiscBuffEditActionId,
} from '@/constants/driveDiscBuffEditNav'
import {
  WENGINE_BUFF_EDIT_ACTIONS,
  WENGINE_BUFF_EDIT_SECTIONS,
  type WengineBuffEditActionId,
} from '@/constants/wengineBuffEditNav'

defineProps<{
  title: string
  backTo: string
  backLabel?: string
  agentSaving?: boolean
  agentCanDelete?: boolean
  wengineSaving?: boolean
  wengineCanDelete?: boolean
  bangbooSaving?: boolean
  bangbooCanDelete?: boolean
  driveDiscSaving?: boolean
  driveDiscCanDelete?: boolean
}>()

const activePanel = defineModel<AdminCalculatorPanel>('activePanel', { default: 'agent' })

const emit = defineEmits<{
  scrollAgentSection: [sectionId: (typeof AGENT_BUFF_EDIT_SECTIONS)[number]['id']]
  agentAction: [actionId: AgentBuffEditActionId]
  scrollWengineSection: [sectionId: (typeof WENGINE_BUFF_EDIT_SECTIONS)[number]['id']]
  wengineAction: [actionId: WengineBuffEditActionId]
  scrollBangbooSection: [sectionId: (typeof BANGBOO_BUFF_EDIT_SECTIONS)[number]['id']]
  bangbooAction: [actionId: BangbooBuffEditActionId]
  scrollDriveDiscSection: [sectionId: (typeof DRIVE_DISC_BUFF_EDIT_SECTIONS)[number]['id']]
  driveDiscAction: [actionId: DriveDiscBuffEditActionId]
}>()

const panels: { id: AdminCalculatorPanel; label: string }[] = [
  { id: 'agent', label: '编辑角色增益' },
  { id: 'wengine', label: '编辑音擎增益' },
  { id: 'bangboo', label: '编辑邦布增益' },
  { id: 'drive-disc', label: '编辑驱动盘增益' },
]
</script>

<template>
  <aside class="sidebar">
    <RouterLink :to="backTo" class="back">{{ backLabel ?? '← 返回' }}</RouterLink>

    <h2 class="sidebar-title">{{ title }}</h2>

    <nav class="sidebar-nav">
      <div v-for="panel in panels" :key="panel.id" class="sidebar-nav-group">
        <button
          type="button"
          class="nav-btn"
          :class="{ active: activePanel === panel.id }"
          @click="activePanel = panel.id"
        >
          {{ panel.label }}
        </button>

        <div
          v-if="panel.id === 'agent'"
          class="panel-subnav-wrap"
          :class="{ expanded: activePanel === 'agent' }"
        >
          <div class="panel-subnav-inner">
            <nav class="panel-subnav" :aria-hidden="activePanel !== 'agent'">
              <button
                v-for="item in AGENT_BUFF_EDIT_SECTIONS"
                :key="item.id"
                type="button"
                class="panel-subnav-btn"
                :tabindex="activePanel === 'agent' ? 0 : -1"
                @click="emit('scrollAgentSection', item.id)"
              >
                {{ item.label }}
              </button>
              <div class="panel-subnav-actions">
                <button
                  v-for="item in AGENT_BUFF_EDIT_ACTIONS"
                  :key="item.id"
                  type="button"
                  class="panel-subnav-btn"
                  :class="{
                    action: item.id === 'save',
                    danger: item.id === 'delete',
                  }"
                  :disabled="item.id === 'save' ? agentSaving : item.id === 'delete' ? !agentCanDelete : false"
                  :tabindex="activePanel === 'agent' ? 0 : -1"
                  @click="emit('agentAction', item.id)"
                >
                  {{ item.id === 'save' && agentSaving ? '保存中...' : item.label }}
                </button>
              </div>
            </nav>
          </div>
        </div>

        <div
          v-if="panel.id === 'wengine'"
          class="panel-subnav-wrap"
          :class="{ expanded: activePanel === 'wengine' }"
        >
          <div class="panel-subnav-inner">
            <nav class="panel-subnav" :aria-hidden="activePanel !== 'wengine'">
              <button
                v-for="item in WENGINE_BUFF_EDIT_SECTIONS"
                :key="item.id"
                type="button"
                class="panel-subnav-btn"
                :tabindex="activePanel === 'wengine' ? 0 : -1"
                @click="emit('scrollWengineSection', item.id)"
              >
                {{ item.label }}
              </button>
              <div class="panel-subnav-actions">
                <button
                  v-for="item in WENGINE_BUFF_EDIT_ACTIONS"
                  :key="item.id"
                  type="button"
                  class="panel-subnav-btn"
                  :class="{
                    action: item.id === 'save',
                    danger: item.id === 'delete',
                  }"
                  :disabled="item.id === 'save' ? wengineSaving : item.id === 'delete' ? !wengineCanDelete : false"
                  :tabindex="activePanel === 'wengine' ? 0 : -1"
                  @click="emit('wengineAction', item.id)"
                >
                  {{ item.id === 'save' && wengineSaving ? '保存中...' : item.label }}
                </button>
              </div>
            </nav>
          </div>
        </div>

        <div
          v-if="panel.id === 'bangboo'"
          class="panel-subnav-wrap"
          :class="{ expanded: activePanel === 'bangboo' }"
        >
          <div class="panel-subnav-inner">
            <nav class="panel-subnav" :aria-hidden="activePanel !== 'bangboo'">
              <button
                v-for="item in BANGBOO_BUFF_EDIT_SECTIONS"
                :key="item.id"
                type="button"
                class="panel-subnav-btn"
                :tabindex="activePanel === 'bangboo' ? 0 : -1"
                @click="emit('scrollBangbooSection', item.id)"
              >
                {{ item.label }}
              </button>
              <div class="panel-subnav-actions">
                <button
                  v-for="item in BANGBOO_BUFF_EDIT_ACTIONS"
                  :key="item.id"
                  type="button"
                  class="panel-subnav-btn"
                  :class="{
                    action: item.id === 'save',
                    danger: item.id === 'delete',
                  }"
                  :disabled="item.id === 'save' ? bangbooSaving : item.id === 'delete' ? !bangbooCanDelete : false"
                  :tabindex="activePanel === 'bangboo' ? 0 : -1"
                  @click="emit('bangbooAction', item.id)"
                >
                  {{ item.id === 'save' && bangbooSaving ? '保存中...' : item.label }}
                </button>
              </div>
            </nav>
          </div>
        </div>

        <div
          v-if="panel.id === 'drive-disc'"
          class="panel-subnav-wrap"
          :class="{ expanded: activePanel === 'drive-disc' }"
        >
          <div class="panel-subnav-inner">
            <nav class="panel-subnav" :aria-hidden="activePanel !== 'drive-disc'">
              <button
                v-for="item in DRIVE_DISC_BUFF_EDIT_SECTIONS"
                :key="item.id"
                type="button"
                class="panel-subnav-btn"
                :tabindex="activePanel === 'drive-disc' ? 0 : -1"
                @click="emit('scrollDriveDiscSection', item.id)"
              >
                {{ item.label }}
              </button>
              <div class="panel-subnav-actions">
                <button
                  v-for="item in DRIVE_DISC_BUFF_EDIT_ACTIONS"
                  :key="item.id"
                  type="button"
                  class="panel-subnav-btn"
                  :class="{
                    action: item.id === 'save',
                    danger: item.id === 'delete',
                  }"
                  :disabled="item.id === 'save' ? driveDiscSaving : item.id === 'delete' ? !driveDiscCanDelete : false"
                  :tabindex="activePanel === 'drive-disc' ? 0 : -1"
                  @click="emit('driveDiscAction', item.id)"
                >
                  {{ item.id === 'save' && driveDiscSaving ? '保存中...' : item.label }}
                </button>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  height: 100vh;
  flex-shrink: 0;
  padding: 1.5rem 1rem;
  border-right: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
}

.back {
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  text-decoration: none;
  transition: opacity 0.2s;
}

.back:hover {
  opacity: 1;
}

.sidebar-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-heading);
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.panel-subnav-wrap {
  display: grid;
  grid-template-rows: 0fr;
  margin: 0 0 0 0.45rem;
  transition: grid-template-rows 0.28s ease;
}

.panel-subnav-wrap.expanded {
  grid-template-rows: 1fr;
}

.panel-subnav-inner {
  overflow: hidden;
  min-height: 0;
}

.panel-subnav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-left: 0.55rem;
  border-left: 1px solid var(--color-border);
  opacity: 0;
  transform: translateY(-6px);
  transition:
    opacity 0.22s ease,
    transform 0.28s ease;
  pointer-events: none;
}

.panel-subnav-wrap.expanded .panel-subnav {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.panel-subnav-btn {
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  opacity: 0.72;
  text-align: left;
  padding: 0.28rem 0.45rem;
  font-size: 0.76rem;
  cursor: pointer;
}

.panel-subnav-btn:hover:not(:disabled) {
  opacity: 1;
  background: var(--color-background-mute);
}

.panel-subnav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.panel-subnav-actions {
  margin-top: 0.35rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.panel-subnav-btn.action {
  color: hsl(160, 100%, 32%);
  font-weight: 600;
}

.panel-subnav-btn.danger {
  color: #c45c5c;
}

.nav-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s,
    color 0.2s;
}

.nav-btn:hover {
  border-color: var(--color-border-hover);
  background: var(--color-background-mute);
}

.nav-btn.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  font-weight: 600;
}
</style>
