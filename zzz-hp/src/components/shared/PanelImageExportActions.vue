<script setup lang="ts">
import { usePanelImageExport } from '@/composables/usePanelImageExport'

/**
 * 三大模式侧栏的「导出当前面板图片」控件。
 * 只由 ModeLayout 通过 ModeSidebar 的 actions 插槽挂载 —— 角色计算器复用同一个侧栏但不填充插槽，
 * 因此不会出现这组按钮（见 dev-docs/panel-image-export.md §2）。
 */
const props = defineProps<{
  mode: string
  panelId: string
}>()

const { busy, status, downloadPanelImage, copyPanelImage } = usePanelImageExport({
  mode: () => props.mode,
  panelId: () => props.panelId,
})
</script>

<template>
  <div class="panel-export">
    <div class="panel-export-title">导出当前面板</div>

    <div class="panel-export-actions">
      <button type="button" class="export-btn" :disabled="busy" @click="downloadPanelImage">
        下载 PNG
      </button>
      <button
        type="button"
        class="export-btn"
        :disabled="busy"
        title="复制为 PNG 图片，需在 HTTPS 或 localhost 下使用"
        @click="copyPanelImage"
      >
        复制图片
      </button>
    </div>

    <p class="panel-export-status" aria-live="polite">
      <span v-if="busy" class="panel-export-status--busy">生成中…</span>
      <span v-else-if="status" :class="`panel-export-status--${status.tone}`">{{ status.text }}</span>
    </p>
  </div>
</template>

<style scoped>
.panel-export {
  padding-top: 0.9rem;
  border-top: 1px solid var(--zzz-line);
}

.panel-export-title {
  margin-bottom: 0.5rem;
  font-family: var(--zzz-font-display);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  color: var(--zzz-fg-dim);
  user-select: none;
}

.panel-export-actions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.export-btn {
  padding: 0.42rem 0.6rem;
  border: 2px solid var(--zzz-line);
  border-radius: var(--zzz-radius-btn);
  background: var(--zzz-ink-2);
  color: var(--zzz-fg);
  font-family: var(--zzz-font-display);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.export-btn:hover:not(:disabled),
.export-btn:focus-visible:not(:disabled) {
  border-color: var(--zzz-yellow);
  color: var(--zzz-yellow);
  outline: none;
}

.export-btn:disabled {
  opacity: 0.55;
  cursor: progress;
}

/* 状态行常驻占位，避免出现时把下方内容顶动 */
.panel-export-status {
  min-height: 1.1rem;
  margin: 0.5rem 0 0;
  font-size: 0.72rem;
  line-height: 1.4;
  word-break: break-word;
}

.panel-export-status--ok {
  color: var(--zzz-yellow);
}

.panel-export-status--busy {
  color: var(--zzz-fg-dim);
}

.panel-export-status--warn {
  color: #ffcf6b;
}

.panel-export-status--error {
  color: #ff8b7a;
}
</style>
