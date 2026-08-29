<script setup lang="ts">
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import { useCalculatorAvatarUpload } from '@/composables/useCalculatorAvatarUpload'
import type { CalculatorPublicAvatarKind } from '@/api/admin'

const props = defineProps<{
  label?: string
  kind: CalculatorPublicAvatarKind
}>()

const {
  imagePickerRef,
  avatarImage,
  imagePreview,
  clearedByUser,
  onImageChange,
  clearAvatarImage,
  setAvatarImage,
  resolveAvatarImageOnSave,
} = useCalculatorAvatarUpload(props.kind)

defineExpose({
  avatarImage,
  clearedByUser,
  setAvatarImage,
  clearAvatarImage,
  resolveAvatarImageOnSave,
})
</script>

<template>
  <div class="field">
    <span class="field-label">{{ label ?? '头像图片' }}</span>
    <AdminImagePicker ref="imagePickerRef" button-text="上传头像" @change="onImageChange" />
    <div v-if="imagePreview" class="avatar-preview-wrap">
      <img :src="imagePreview" alt="头像预览" class="avatar-preview" />
      <button type="button" class="clear-btn" @click="clearAvatarImage">清除头像</button>
    </div>
    <p v-if="avatarImage" class="avatar-path">当前：{{ avatarImage }}</p>
    <p v-else class="avatar-hint">
      未上传时列表显示名称首字。选择图片后点「保存」写入固定路径（如
      <code>/character/角色ID.webp</code>
      ）。ID 含 <code>&amp;</code> 时文件名会写成下划线形式（如
      <code>orphie_magus.webp</code>
      ）。勿在未选新图时误点「清除」。
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.avatar-preview-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.avatar-preview {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: var(--color-background);
}

.clear-btn {
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.82rem;
  cursor: pointer;
}

.clear-btn:hover {
  border-color: #e85d4c;
  color: #e85d4c;
}

.avatar-path,
.avatar-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.7;
}
</style>
