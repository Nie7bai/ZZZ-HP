<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { createBuff, uploadBuffImage } from '@/api/admin'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import { useAdminVersionPhaseSelect } from '@/composables/useAdminVersionPhaseSelect'
import type { AdminScope } from '@/types/admin'
import { adminScopeTitles, isDefenseScope } from '@/types/admin'
import { encodeCrisisBuffId, encodeDefenseBuffId } from '@/utils/defenseId'

const props = defineProps<{
  scope: AdminScope
}>()

const isDefense = computed(() => isDefenseScope(props.scope))

const {
  version,
  phase,
  customVersion,
  customPhase,
  resolvedVersion,
  resolvedPhase,
  availableVersions,
  availablePhases,
  loadVersionPhaseOptions,
  keepVersionPhaseAfterSubmit,
} = useAdminVersionPhaseSelect(toRef(props, 'scope'), { source: 'both' })

const buffName = ref('')
const buffText = ref('')
const stage = ref('')
const roomInStage = ref('')
const buffIndex = ref('1')
const previewId = ref('')
const imageFile = ref<File | null>(null)
const imagePickerRef = ref<InstanceType<typeof AdminImagePicker> | null>(null)
const imagePreview = ref('')
const submitting = ref(false)
const message = ref('')
const error = ref('')

function fieldText(value: string | number | null | undefined) {
  return String(value ?? '').trim()
}

function updatePreviewId() {
  try {
    if (isDefense.value) {
      previewId.value = String(
        encodeDefenseBuffId({
          version: resolvedVersion.value,
          phase: resolvedPhase.value,
          stage: Number(stage.value),
          roomInStage: Number(roomInStage.value),
          buffIndex: Number(buffIndex.value),
        }),
      )
      return
    }
    previewId.value = String(
      encodeCrisisBuffId({
        version: resolvedVersion.value,
        phase: resolvedPhase.value,
        buffIndex: Number(buffIndex.value),
      }),
    )
  } catch {
    previewId.value = ''
  }
}

function resetDefenseFields() {
  stage.value = ''
  roomInStage.value = ''
  buffIndex.value = '1'
  previewId.value = ''
}

function onImageChange(file: File | null) {
  imageFile.value = file
  imagePreview.value = file ? URL.createObjectURL(file) : ''
}

async function submitForm() {
  message.value = ''
  error.value = ''

  try {
    if (!resolvedVersion.value || !resolvedPhase.value || !fieldText(buffName.value)) {
      error.value = '版本、期数、Buff 名称为必填项'
      return
    }

    if (!fieldText(buffIndex.value)) {
      error.value = 'Buff 序号为必填项'
      return
    }

    if (isDefense.value) {
      if (!fieldText(stage.value) || !fieldText(roomInStage.value)) {
        error.value = '关卡、房间为必填项'
        return
      }
    }

    submitting.value = true

    let buffImage: string | null = null
    if (imageFile.value) {
      const uploaded = await uploadBuffImage(imageFile.value)
      buffImage = uploaded.url
    }

    const schemePayload = isDefense.value
      ? {
          recordScheme: 'defense' as const,
          id: encodeDefenseBuffId({
            version: resolvedVersion.value,
            phase: resolvedPhase.value,
            stage: Number(stage.value),
            roomInStage: Number(roomInStage.value),
            buffIndex: Number(buffIndex.value),
          }),
          stage: Number(stage.value),
          roomInStage: Number(roomInStage.value),
          buffIndex: Number(buffIndex.value),
        }
      : {
          recordScheme: 'crisis' as const,
          id: encodeCrisisBuffId({
            version: resolvedVersion.value,
            phase: resolvedPhase.value,
            buffIndex: Number(buffIndex.value),
          }),
          buffIndex: Number(buffIndex.value),
        }

    const result = await createBuff({
      version: resolvedVersion.value,
      phase: resolvedPhase.value,
      buff_name: fieldText(buffName.value),
      buff: fieldText(buffText.value) || null,
      buff_image: buffImage,
      ...schemePayload,
    })

    const actionHint = result.action === 'updated' ? '（已覆盖同 ID 记录）' : ''
    message.value = `Buff 添加成功（ID ${result.id}）${actionHint}`
    keepVersionPhaseAfterSubmit()
    buffName.value = ''
    buffText.value = ''
    resetDefenseFields()
    imageFile.value = null
    imagePickerRef.value?.reset()
    imagePreview.value = ''
    await loadVersionPhaseOptions()
    keepVersionPhaseAfterSubmit()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提交失败'
  } finally {
    submitting.value = false
  }
}

watch([isDefense, resolvedVersion, resolvedPhase, stage, roomInStage, buffIndex], () => {
  updatePreviewId()
})
</script>

<template>
  <div class="admin-form-panel">
    <header class="panel-header">
      <h1 class="panel-title">添加 Buff</h1>
      <p class="panel-desc">当前模式：{{ adminScopeTitles[scope] }}</p>
    </header>

    <form class="admin-form" novalidate @submit.prevent="submitForm">
      <label class="field">
        <span class="field-label">版本 *</span>
        <select v-model="version" class="field-input">
          <option v-if="!availableVersions.length" value="" disabled>暂无可选版本</option>
          <option v-for="item in availableVersions" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
        <input
          v-model="customVersion"
          type="text"
          class="field-input"
          placeholder="新版本（填写后覆盖上方选择）"
        />
      </label>

      <label class="field">
        <span class="field-label">期数 *</span>
        <select v-model="phase" class="field-input">
          <option v-if="!availablePhases.length" value="" disabled>
            {{ resolvedVersion ? '该版本暂无期数，可在下方输入' : '请先选择版本' }}
          </option>
          <option v-for="item in availablePhases" :key="item" :value="item">
            第 {{ item }} 期
          </option>
        </select>
        <input
          v-model="customPhase"
          type="text"
          class="field-input"
          placeholder="新期数（填写后覆盖上方选择）"
        />
      </label>

      <label class="field">
        <span class="field-label">Buff 名称 *</span>
        <input v-model="buffName" type="text" class="field-input" placeholder="Buff 名称" />
      </label>

      <div v-if="isDefense" class="field-row">
        <label class="field">
          <span class="field-label">关卡 *</span>
          <input v-model="stage" type="number" min="1" max="99" class="field-input" placeholder="1-99" />
        </label>
        <label class="field">
          <span class="field-label">房间 *</span>
          <input
            v-model="roomInStage"
            type="number"
            min="1"
            max="9"
            class="field-input"
            placeholder="当前关卡第几间"
          />
        </label>
      </div>

      <label class="field">
        <span class="field-label">Buff 序号 *</span>
        <input
          v-model="buffIndex"
          type="number"
          min="1"
          :max="isDefense ? 9 : 99"
          class="field-input"
          :placeholder="isDefense ? '1-9' : '如 1、2、3（对应 ID 末两位）'"
        />
      </label>

      <p v-if="previewId" class="id-preview">预计 Buff ID：{{ previewId }}</p>

      <label class="field">
        <span class="field-label">Buff 描述</span>
        <textarea
          v-model="buffText"
          class="field-textarea"
          rows="6"
          placeholder="每行一条效果描述"
        />
      </label>

      <div class="field">
        <span class="field-label">Buff 图片</span>
        <AdminImagePicker ref="imagePickerRef" @change="onImageChange" />
        <img v-if="imagePreview" :src="imagePreview" alt="预览" class="image-preview" />
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
      <p v-if="message" class="form-success">{{ message }}</p>

      <button type="submit" class="submit-btn" :disabled="submitting">
        {{ submitting ? '提交中...' : '提交' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.admin-form-panel {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}

.panel-header {
  margin-bottom: 1.25rem;
  text-align: center;
}

.panel-title {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 1.85rem);
  font-weight: 700;
  color: var(--color-heading);
}

.panel-desc {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
}

.admin-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

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

.field-input,
.field-textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
  font-family: inherit;
}

.field > .field-input + .field-input {
  margin-top: 0.35rem;
}

.field-input:focus,
.field-textarea:focus {
  border-color: #e8a838;
}

.field-textarea {
  resize: vertical;
  min-height: 7rem;
}

.id-preview {
  margin: 0;
  font-size: 0.8rem;
  color: #e8a838;
  text-align: center;
}

.image-preview {
  width: 72px;
  height: 72px;
  object-fit: contain;
  margin-top: 0.35rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
}

.form-error {
  margin: 0;
  font-size: 0.82rem;
  color: #e85d4c;
}

.form-success {
  margin: 0;
  font-size: 0.82rem;
  color: #e8a838;
}

.submit-btn {
  align-self: center;
  min-width: 8rem;
  padding: 0.55rem 1.2rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.submit-btn:hover:not(:disabled) {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.submit-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

@media (max-width: 640px) {
  .field-row {
    grid-template-columns: 1fr;
  }
}
</style>
