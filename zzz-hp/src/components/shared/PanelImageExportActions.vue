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
/*
 * 配色必须与侧栏其他按键（.sidebar-title-text / .back / .nav-btn）保持一致：
 * 侧栏是**恒深色**面板（.sidebar 用 --zzz-ink + 固定 #f5f5f0 文字），而
 * --zzz-fg / --zzz-fg-dim 在浅色主题下会翻成近黑（#141412），落在 --zzz-ink-2
 * (#1c1c1c) 的按钮底色上就是黑字黑底、与背景融为一体。因此这里一律使用
 * 侧栏既有的、不随主题翻转的浅色字与描边。
 */
.panel-export {
  padding-top: 0.9rem;
  /* 与 .sidebar-title 的下分隔线同一 token，保持侧栏内分隔线一致 */
  border-top: 1px solid var(--zzz-line);
}

.panel-export-title {
  margin-bottom: 0.5rem;
  font-family: var(--zzz-font-display);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  /* 同 .back */
  color: rgba(245, 245, 240, 0.55);
  user-select: none;
}

.panel-export-actions {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

/* 视觉配方对齐 .nav-btn：黑色 1px 描边 + 深色底 + 内阴影双层描边 */
.export-btn {
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: 1px solid #000;
  border-radius: var(--zzz-radius-btn);
  background: var(--zzz-ink-2);
  color: rgba(245, 245, 240, 0.85);
  font-size: 0.86rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px #2e2e2e,
    inset 0 0 0 3px var(--zzz-ink-2);
  transition:
    background-color 0.16s ease-out,
    color 0.16s ease-out,
    box-shadow 0.16s ease-out;
}

.export-btn:hover:not(:disabled),
.export-btn:focus-visible:not(:disabled) {
  color: #f5f5f0;
  outline: none;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px var(--zzz-yellow),
    inset 0 0 0 3px var(--zzz-ink-2);
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
  /* 同 .back */
  color: rgba(245, 245, 240, 0.55);
}

.panel-export-status--warn {
  color: #ffcf6b;
}

.panel-export-status--error {
  color: #ff8b7a;
}
</style>
