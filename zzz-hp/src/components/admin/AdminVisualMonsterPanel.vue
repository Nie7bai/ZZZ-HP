<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  cleanupSeasonContent,
  deleteBossRecord,
  deleteBuffRecord,
  previewSeasonContent,
  restoreSeasonContent,
  softDeleteSeasonContent,
  type SeasonContentPreview,
} from '@/api/admin'
import AdminBuffEditModal from '@/components/admin/AdminBuffEditModal.vue'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import AdminMonsterEditModal from '@/components/admin/AdminMonsterEditModal.vue'
import DefenseDetailPanel from '@/components/defense/DefenseDetailPanel.vue'
import HistoryDetailPanel from '@/components/history/HistoryDetailPanel.vue'
import type {
  AdminBuffSlotContext,
  AdminMonsterSlotContext,
  AdminScope,
} from '@/types/admin'
import { isDefenseScope, recordSchemeFromScope } from '@/types/admin'

const props = defineProps<{
  scope: AdminScope
}>()

type DetailExpose = {
  reload?: () => Promise<void>
  getCurrentMeta?: () => { version: string; phase: string } | null
}

const detailRef = ref<DetailExpose | null>(null)
const monsterEditOpen = ref(false)
const buffEditOpen = ref(false)
const monsterContext = ref<AdminMonsterSlotContext | null>(null)
const buffContext = ref<AdminBuffSlotContext | null>(null)
const actionError = ref('')
const actionMessage = ref('')

const preview = ref<SeasonContentPreview | null>(null)
const previewLoading = ref(false)
const acting = ref(false)
const softConfirmVisible = ref(false)
const restoreConfirmVisible = ref(false)
const cleanupConfirmVisible = ref(false)

const isDefense = computed(() => isDefenseScope(props.scope))
const defenseVariant = computed(() => (props.scope === 'defense-new' ? 'new' : 'old'))
const scheme = computed(() => recordSchemeFromScope(props.scope) ?? 'crisis')
const modeLabel = computed(() => (scheme.value === 'defense' ? '防卫战' : '危局'))

const softConfirmMessage = computed(() => {
  if (!preview.value) return ''
  const lines = [
    `将标记删除当前「${modeLabel.value}」整期（前台立即隐藏，数据保留）：`,
    `版本 ${preview.value.version} · 第 ${preview.value.phase} 期`,
    `怪物 ${preview.value.bossCount} 条 · Buff ${preview.value.buffCount} 条 · 版本日期 ${preview.value.dateCount} 条`,
  ]
  for (const warning of preview.value.warnings || []) {
    lines.push(`⚠ ${warning}`)
  }
  lines.push('标记后显示「已删除未清理」，可恢复，或再点「清理」永久删除。')
  return lines.join('\n')
})

const restoreConfirmMessage = computed(() => {
  if (!preview.value) return ''
  const lines = [
    `将恢复「${modeLabel.value}」整期（取消「已删除未清理」，前台重新可见）：`,
    `版本 ${preview.value.version} · 第 ${preview.value.phase} 期`,
    `怪物 ${preview.value.bossCount} 条 · Buff ${preview.value.buffCount} 条 · 版本日期 ${preview.value.dateCount} 条`,
  ]
  for (const warning of preview.value.warnings || []) {
    lines.push(`⚠ ${warning}`)
  }
  return lines.join('\n')
})

const cleanupConfirmMessage = computed(() => {
  if (!preview.value) return ''
  const lines = [
    `将永久清理「${modeLabel.value}」整期内容与版本日期：`,
    `版本 ${preview.value.version} · 第 ${preview.value.phase} 期`,
    `怪物 ${preview.value.bossCount} 条 · Buff ${preview.value.buffCount} 条 · 版本日期 ${preview.value.dateCount} 条`,
  ]
  for (const warning of preview.value.warnings || []) {
    lines.push(`⚠ ${warning}`)
  }
  lines.push('此操作不可撤销。')
  return lines.join('\n')
})

function openMonsterEdit(context: AdminMonsterSlotContext) {
  actionError.value = ''
  monsterContext.value = context
  monsterEditOpen.value = true
}

function openBuffEdit(context: AdminBuffSlotContext) {
  actionError.value = ''
  buffContext.value = context
  buffEditOpen.value = true
}

async function onDeleteMonster(recordId: number, label: string) {
  actionError.value = ''
  if (!window.confirm(`确认删除怪物「${label}」？此操作不可恢复。`)) return
  try {
    await deleteBossRecord(recordId)
    await detailRef.value?.reload?.()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '删除怪物失败'
  }
}

/** 从本期内容移除该条（本期不再展示）；不是环境 Buff 管理里的「删除 Buff 本身」 */
async function onRemovePeriodBuff(recordId: number, label: string) {
  actionError.value = ''
  if (
    !window.confirm(
      `确认从本期移除「${label}」？\n仅使本期不再使用该条；请到「环境 Buff 管理」删除 Buff 本身。`,
    )
  ) {
    return
  }
  try {
    await deleteBuffRecord(recordId)
    await detailRef.value?.reload?.()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '从本期移除失败'
  }
}

async function onMonsterSaved() {
  monsterEditOpen.value = false
  monsterContext.value = null
  await reloadDetail()
}

async function onBuffSaved() {
  buffEditOpen.value = false
  buffContext.value = null
  await reloadDetail()
}

async function reloadDetail() {
  try {
    await detailRef.value?.reload?.()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '刷新失败'
  }
}

async function loadPreviewForCurrent() {
  const meta = detailRef.value?.getCurrentMeta?.()
  if (!meta?.version || !meta?.phase) {
    throw new Error('请先切换到要操作的那一期')
  }
  return previewSeasonContent({
    scheme: scheme.value,
    version: meta.version,
    phase: meta.phase,
  })
}

async function openSoftDeleteConfirm() {
  actionError.value = ''
  actionMessage.value = ''
  preview.value = null
  previewLoading.value = true
  try {
    preview.value = await loadPreviewForCurrent()
    if (preview.value.pendingCleanup) {
      actionMessage.value = `${preview.value.version} 第 ${preview.value.phase} 期已是「已删除未清理」，可「恢复」或「清理」`
      return
    }
    if (!preview.value.canSoftDelete) {
      actionMessage.value = `${preview.value.version} 第 ${preview.value.phase} 期没有可标记删除的内容`
      preview.value = null
      return
    }
    softConfirmVisible.value = true
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '预览失败'
  } finally {
    previewLoading.value = false
  }
}

async function openRestoreConfirm() {
  actionError.value = ''
  actionMessage.value = ''
  preview.value = null
  previewLoading.value = true
  try {
    preview.value = await loadPreviewForCurrent()
    if (!preview.value.canRestore) {
      actionMessage.value = `${preview.value.version} 第 ${preview.value.phase} 期不在「已删除未清理」状态`
      preview.value = null
      return
    }
    restoreConfirmVisible.value = true
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '预览失败'
  } finally {
    previewLoading.value = false
  }
}

async function openCleanupConfirm() {
  actionError.value = ''
  actionMessage.value = ''
  preview.value = null
  previewLoading.value = true
  try {
    preview.value = await loadPreviewForCurrent()
    if (!preview.value.canCleanup) {
      actionMessage.value = `${preview.value.version} 第 ${preview.value.phase} 期没有可清理的内容（若仍看到空期，请刷新页面；无防卫战日期/怪物的期已不再展示）`
      preview.value = null
      return
    }
    if (!preview.value.pendingCleanup && (preview.value.bossCount > 0 || preview.value.buffCount > 0)) {
      actionMessage.value =
        '建议先「删除」标记为已删除未清理；若确定要立刻永久删除，请在确认框继续。'
    }
    cleanupConfirmVisible.value = true
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '预览失败'
  } finally {
    previewLoading.value = false
  }
}

function closeSoftConfirm() {
  if (acting.value) return
  softConfirmVisible.value = false
}

function closeRestoreConfirm() {
  if (acting.value) return
  restoreConfirmVisible.value = false
}

function closeCleanupConfirm() {
  if (acting.value) return
  cleanupConfirmVisible.value = false
}

function confirmKey(p: SeasonContentPreview) {
  return `${scheme.value}:${p.version}:${p.phase}`
}

async function executeSoftDelete() {
  if (!preview.value) return
  acting.value = true
  actionError.value = ''
  actionMessage.value = ''
  try {
    const result = await softDeleteSeasonContent({
      scheme: scheme.value,
      version: preview.value.version,
      phase: preview.value.phase,
      confirmText: confirmKey(preview.value),
    })
    actionMessage.value =
      result.action === 'already_soft_deleted'
        ? `已是「已删除未清理」：${result.version} 第 ${result.phase} 期`
        : `已标记删除（未清理）：${result.version} 第 ${result.phase} 期 · 怪物 ${result.bossCount} · Buff ${result.buffCount}`
    softConfirmVisible.value = false
    preview.value = null
    await reloadDetail()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '标记删除失败'
  } finally {
    acting.value = false
  }
}

async function executeRestore() {
  if (!preview.value) return
  acting.value = true
  actionError.value = ''
  actionMessage.value = ''
  try {
    const result = await restoreSeasonContent({
      scheme: scheme.value,
      version: preview.value.version,
      phase: preview.value.phase,
      confirmText: confirmKey(preview.value),
    })
    actionMessage.value = `已恢复：${result.version} 第 ${result.phase} 期`
    restoreConfirmVisible.value = false
    preview.value = null
    await reloadDetail()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '恢复失败'
  } finally {
    acting.value = false
  }
}

async function executeCleanup() {
  if (!preview.value) return
  acting.value = true
  actionError.value = ''
  actionMessage.value = ''
  try {
    const result = await cleanupSeasonContent({
      scheme: scheme.value,
      version: preview.value.version,
      phase: preview.value.phase,
      alsoDeleteDates: true,
      confirmText: confirmKey(preview.value),
    })
    actionMessage.value = `已清理整期：怪物 ${result.bossesDeleted} · Buff ${result.buffsDeleted} · 日期 ${result.datesDeleted}`
    cleanupConfirmVisible.value = false
    preview.value = null
    await reloadDetail()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '清理失败'
  } finally {
    acting.value = false
  }
}

defineExpose({ reload: reloadDetail })
</script>

<template>
  <div class="admin-visual-panel">
    <div v-if="scheme === 'crisis' || isDefense" class="admin-visual-toolbar">
      <button
        type="button"
        class="toolbar-warn-btn"
        :disabled="previewLoading || acting"
        @click="openSoftDeleteConfirm"
      >
        删除当前整期
      </button>
      <button
        type="button"
        class="toolbar-restore-btn"
        :disabled="previewLoading || acting"
        @click="openRestoreConfirm"
      >
        恢复
      </button>
      <button
        type="button"
        class="toolbar-danger-btn"
        :disabled="previewLoading || acting"
        @click="openCleanupConfirm"
      >
        {{ previewLoading ? '统计中...' : '清理' }}
      </button>
    </div>

    <p v-if="actionError" class="admin-visual-error">{{ actionError }}</p>
    <p v-if="actionMessage" class="admin-visual-ok">{{ actionMessage }}</p>

    <HistoryDetailPanel
      v-if="scope === 'crisis-assault'"
      ref="detailRef"
      mode="crisis-assault"
      admin-mode
      @admin-monster="openMonsterEdit"
      @admin-delete-monster="onDeleteMonster"
      @admin-buff="openBuffEdit"
      @admin-remove-period-buff="onRemovePeriodBuff"
    />

    <DefenseDetailPanel
      v-else-if="isDefense"
      ref="detailRef"
      admin-mode
      :variant-override="defenseVariant"
      @admin-monster="openMonsterEdit"
      @admin-delete-monster="onDeleteMonster"
      @admin-buff="openBuffEdit"
      @admin-remove-period-buff="onRemovePeriodBuff"
    />

    <p v-else class="admin-visual-empty">当前模式暂不支持可视化管理</p>

    <AdminMonsterEditModal
      v-model:open="monsterEditOpen"
      :scope="scope"
      :context="monsterContext"
      @saved="onMonsterSaved"
    />

    <AdminBuffEditModal
      v-model:open="buffEditOpen"
      :scope="scope"
      :context="buffContext"
      @saved="onBuffSaved"
    />

    <AdminConfirmDialog
      :visible="softConfirmVisible"
      title="确认标记删除"
      :message="softConfirmMessage"
      confirm-text="标记为已删除未清理"
      :danger="true"
      :loading="acting"
      @confirm="executeSoftDelete"
      @cancel="closeSoftConfirm"
    />

    <AdminConfirmDialog
      :visible="restoreConfirmVisible"
      title="确认恢复"
      :message="restoreConfirmMessage"
      confirm-text="恢复本期"
      :danger="false"
      :loading="acting"
      @confirm="executeRestore"
      @cancel="closeRestoreConfirm"
    />

    <AdminConfirmDialog
      :visible="cleanupConfirmVisible"
      title="确认永久清理"
      :message="cleanupConfirmMessage"
      confirm-text="永久清理"
      :danger="true"
      :loading="acting"
      @confirm="executeCleanup"
      @cancel="closeCleanupConfirm"
    />
  </div>
</template>

<style scoped>
.admin-visual-panel {
  min-height: 100%;
  width: 100%;
}

.admin-visual-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem 1rem;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.toolbar-warn-btn,
.toolbar-restore-btn,
.toolbar-danger-btn {
  padding: 0.4rem 0.85rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
}

.toolbar-warn-btn {
  border: 1px solid rgba(245, 196, 81, 0.55);
  color: #f5c451;
}

.toolbar-warn-btn:hover:not(:disabled) {
  background: rgba(245, 196, 81, 0.12);
}

.toolbar-restore-btn {
  border: 1px solid rgba(96, 165, 250, 0.55);
  color: #60a5fa;
}

.toolbar-restore-btn:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.12);
}

.toolbar-danger-btn {
  border: 1px solid rgba(232, 93, 76, 0.55);
  color: #e85d4c;
}

.toolbar-danger-btn:hover:not(:disabled) {
  background: rgba(232, 93, 76, 0.1);
}

.toolbar-warn-btn:disabled,
.toolbar-restore-btn:disabled,
.toolbar-danger-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

.admin-visual-error {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-radius: 0;
  border-bottom: 1px solid rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.1);
  color: #e8a8a8;
  font-size: 0.85rem;
}

.admin-visual-ok {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid rgba(46, 160, 120, 0.35);
  background: rgba(46, 160, 120, 0.1);
  color: #8fd6b8;
  font-size: 0.85rem;
}

.admin-visual-empty {
  margin: 2rem 0;
  text-align: center;
  color: var(--color-text);
  opacity: 0.7;
}
</style>
