<script setup lang="ts">
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import { useCalculatorAvatarUpload } from '@/composables/useCalculatorAvatarUpload'

defineProps<{
  label?: string
}>()

const {
  imagePickerRef,
  avatarImage,
  imagePreview,
  onImageChange,
  clearAvatarImage,
  setAvatarImage,
  resolveAvatarImageOnSave,
} = useCalculatorAvatarUpload()

defineExpose({
  avatarImage,
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
    <p v-else-if="avatarImage" class="avatar-path">{{ avatarImage }}</p>
    <p v-else class="avatar-hint">未上传头像时将显示名称首字</p>
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
