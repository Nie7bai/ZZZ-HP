<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createBoss, lookupBossInfo, searchBossInfoNames, uploadBossImage } from '@/api/admin'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import type { AdminScope, DefenseMonsterCategory } from '@/types/admin'
import { adminScopeTitles, isDefenseScope } from '@/types/admin'
import { encodeDefenseBossId } from '@/utils/defenseId'
import { resolveAssetUrl } from '@/utils/gameData'

const props = defineProps<{
  scope: AdminScope
}>()

const isDefense = computed(() => isDefenseScope(props.scope))

const version = ref('')
const phase = ref('')
const bossName = ref('')
const hp = ref('')
const defense = ref('')
const level = ref('1')
const room = ref('')
const stage = ref('')
const roomInStage = ref('')
const wave = ref('1')
const monsterCategory = ref<DefenseMonsterCategory>('boss')
const monsterSubType = ref('1')
const count = ref('1')
const previewId = ref('')
const weakness = ref('')
const resistance = ref('')
const imageFile = ref<File | null>(null)
const imagePickerRef = ref<InstanceType<typeof AdminImagePicker> | null>(null)
const imagePreview = ref('')
const imageUrl = ref('')
const nameSuggestions = ref<string[]>([])
const lookupHint = ref('')
const submitting = ref(false)
const lookingUp = ref(false)
const message = ref('')
const error = ref('')

let lookupTimer: ReturnType<typeof setTimeout> | null = null

function fieldText(value: string | number | null | undefined) {
  return String(value ?? '').trim()
}

function showFeedback(target: 'error' | 'message') {
  requestAnimationFrame(() => {
    const selector = target === 'error' ? '.form-error' : '.form-success'
    document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

function applyBossInfo(info: {
  defense: number
  level: number
  weakness: string | null
  resistance: string | null
  boss_image: string | null
}) {
  defense.value = String(info.defense ?? 0)
  level.value = String(info.level ?? 1)
  weakness.value = info.weakness ?? ''
  resistance.value = info.resistance ?? ''
  imageUrl.value = info.boss_image ?? ''
  imagePreview.value = resolveAssetUrl(info.boss_image) ?? ''
  imageFile.value = null
  imagePickerRef.value?.reset()
}

async function fetchBossInfoByName(name: string) {
  const query = name.trim()
  if (!query) {
    lookupHint.value = ''
    nameSuggestions.value = []
    return
  }

  lookingUp.value = true
  lookupHint.value = ''
  error.value = ''

  try {
    const [info, suggestions] = await Promise.all([
      lookupBossInfo(query),
      searchBossInfoNames(query),
    ])

    nameSuggestions.value = suggestions

    if (info) {
      applyBossInfo(info)
      lookupHint.value = '已从 boss_info 补全怪物基础信息'
      return
    }

    lookupHint.value = '未找到已有 boss_info，提交时将新增基础信息'
  } catch (err) {
    lookupHint.value = err instanceof Error ? err.message : 'Boss 信息检索失败'
  } finally {
    lookingUp.value = false
  }
}

function scheduleBossLookup(name: string) {
  if (lookupTimer) clearTimeout(lookupTimer)
  lookupTimer = setTimeout(() => {
    fetchBossInfoByName(name)
  }, 350)
}

function onBossNameBlur() {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
    lookupTimer = null
  }
  fetchBossInfoByName(bossName.value)
}

function onImageChange(file: File | null) {
  imageFile.value = file
  imagePreview.value = file ? URL.createObjectURL(file) : resolveAssetUrl(imageUrl.value) ?? ''
}

function updatePreviewId() {
  if (!isDefense.value) {
    previewId.value = ''
    return
  }

  try {
    previewId.value = String(
      encodeDefenseBossId({
        version: version.value.trim(),
        phase: phase.value.trim(),
        stage: Number(stage.value),
        roomInStage: Number(roomInStage.value),
        wave: Number(wave.value),
        monsterCategory: monsterCategory.value,
        monsterSubType: Number(monsterSubType.value),
        count: Number(count.value),
      }),
    )
  } catch {
    previewId.value = ''
  }
}

function resetDefenseFields() {
  stage.value = ''
  roomInStage.value = ''
  wave.value = '1'
  monsterCategory.value = 'boss'
  monsterSubType.value = '1'
  count.value = '1'
  previewId.value = ''
}

function bossInfoSyncMessage(action?: string) {
  if (action === 'created') return '已新增 boss_info 基础信息'
  if (action === 'updated') return 'boss_info 信息与原有记录不符，已更新基础信息'
  if (action === 'unchanged') return 'boss_info 基础信息无变化'
  return ''
}

async function submitForm() {
  message.value = ''
  error.value = ''

  try {
    if (!fieldText(version.value) || !fieldText(phase.value) || !fieldText(bossName.value)) {
      error.value = '版本、期数、怪物名称为必填项'
      showFeedback('error')
      return
    }

    if (isDefense.value) {
      if (!fieldText(stage.value) || !fieldText(roomInStage.value) || !fieldText(wave.value)) {
        error.value = '关卡、房间、波次为必填项'
        showFeedback('error')
        return
      }
      if (!fieldText(monsterSubType.value) || !fieldText(count.value)) {
        error.value = '怪物序号与数量为必填项'
        showFeedback('error')
        return
      }
    } else if (!fieldText(room.value)) {
      error.value = '危局强袭战须填写房间（1 / 2 / 3）'
      showFeedback('error')
      return
    }

    const hpNumber = fieldText(hp.value) ? Number(hp.value) : 0
    if (!Number.isFinite(hpNumber) || hpNumber < 0 || hpNumber > 4294967295) {
      error.value = '血量须在 0 - 4,294,967,295 之间'
      showFeedback('error')
      return
    }

    let defenseBossId: number | undefined
    if (isDefense.value) {
      try {
        defenseBossId = encodeDefenseBossId({
          version: fieldText(version.value),
          phase: fieldText(phase.value),
          stage: Number(stage.value),
          roomInStage: Number(roomInStage.value),
          wave: Number(wave.value),
          monsterCategory: monsterCategory.value,
          monsterSubType: Number(monsterSubType.value),
          count: Number(count.value),
        })
      } catch (err) {
        error.value = err instanceof Error ? err.message : '怪物 ID 编码失败'
        showFeedback('error')
        return
      }
    }

    submitting.value = true

    let bossImage: string | null = imageUrl.value.trim() || null
    if (imageFile.value) {
      const uploaded = await uploadBossImage(imageFile.value)
      bossImage = uploaded.url
    }

    const defensePayload = isDefense.value
      ? {
          recordScheme: 'defense' as const,
          id: defenseBossId!,
          stage: Number(stage.value),
          roomInStage: Number(roomInStage.value),
          wave: Number(wave.value),
          monsterCategory: monsterCategory.value,
          monsterSubType: Number(monsterSubType.value),
          count: Number(count.value),
        }
      : { recordScheme: 'crisis' as const }

    const result = await createBoss({
      version: fieldText(version.value),
      phase: fieldText(phase.value),
      boss_name: fieldText(bossName.value),
      hp: hpNumber,
      defense: fieldText(defense.value) ? Number(defense.value) : 0,
      level: fieldText(level.value) ? Number(level.value) : 1,
      room: isDefense.value ? null : fieldText(room.value),
      weakness: fieldText(weakness.value) || null,
      resistance: fieldText(resistance.value) || null,
      boss_image: bossImage,
      ...defensePayload,
    })

    const syncMessage = bossInfoSyncMessage(result.bossInfoSync?.action)
    const actionHint = result.action === 'updated' ? '（已覆盖同 ID 记录）' : ''
    message.value = syncMessage
      ? `怪物添加成功（ID ${result.id}）${actionHint}，${syncMessage}`
      : `怪物添加成功（ID ${result.id}）${actionHint}`
    showFeedback('message')

    version.value = ''
    phase.value = ''
    bossName.value = ''
    hp.value = ''
    defense.value = ''
    level.value = '1'
    room.value = ''
    resetDefenseFields()
    weakness.value = ''
    resistance.value = ''
    imageFile.value = null
    imagePickerRef.value?.reset()
    imagePreview.value = ''
    imageUrl.value = ''
    lookupHint.value = ''
    nameSuggestions.value = []
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提交失败'
    showFeedback('error')
  } finally {
    submitting.value = false
  }
}

watch(bossName, (value) => {
  scheduleBossLookup(value)
})

watch(
  [isDefense, version, phase, stage, roomInStage, wave, monsterCategory, monsterSubType, count],
  () => {
    updatePreviewId()
  },
)
</script>

<template>
  <div class="admin-form-panel">
    <header class="panel-header">
      <h1 class="panel-title">添加怪物</h1>
      <p class="panel-desc">当前模式：{{ adminScopeTitles[scope] }}</p>
    </header>

    <form class="admin-form" novalidate @submit.prevent="submitForm">
      <label class="field">
        <span class="field-label">版本 *</span>
        <input v-model="version" type="text" class="field-input" placeholder="如 3.0" />
      </label>

      <label class="field">
        <span class="field-label">期数 *</span>
        <input v-model="phase" type="text" class="field-input" placeholder="如 1 或 第 1 期" />
      </label>

      <label class="field">
        <span class="field-label">怪物名称 *</span>
        <input
          v-model="bossName"
          type="text"
          class="field-input"
          placeholder="输入后自动检索 boss_info"
          list="boss-name-suggestions"
          @blur="onBossNameBlur"
        />
        <datalist id="boss-name-suggestions">
          <option v-for="name in nameSuggestions" :key="name" :value="name" />
        </datalist>
        <p v-if="lookingUp" class="lookup-hint">正在检索 boss_info...</p>
        <p v-else-if="lookupHint" class="lookup-hint">{{ lookupHint }}</p>
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field-label">血量</span>
          <input v-model="hp" type="number" min="0" class="field-input" placeholder="166774698" />
        </label>
        <label class="field">
          <span class="field-label">防御</span>
          <input v-model="defense" type="number" min="0" class="field-input" />
        </label>
      </div>

      <div v-if="isDefense" class="field-row">
        <label class="field">
          <span class="field-label">关卡 *</span>
          <input v-model="stage" type="number" min="1" max="9" class="field-input" placeholder="1-9" />
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

      <div v-if="isDefense" class="field-row">
        <label class="field">
          <span class="field-label">波次 *</span>
          <input v-model="wave" type="number" min="0" max="9" class="field-input" placeholder="0-9" />
        </label>
        <label class="field">
          <span class="field-label">怪物数量 *</span>
          <input v-model="count" type="number" min="1" max="9" class="field-input" placeholder="1-9" />
        </label>
      </div>

      <div v-if="isDefense" class="field-row">
        <label class="field">
          <span class="field-label">怪物类型 *</span>
          <select v-model="monsterCategory" class="field-input">
            <option value="minion">小怪 (0x)</option>
            <option value="elite">精英 (1x)</option>
            <option value="boss">Boss (2x)</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">类型序号 *</span>
          <input
            v-model="monsterSubType"
            type="number"
            min="1"
            max="9"
            class="field-input"
            placeholder="1-9"
          />
        </label>
      </div>

      <label v-else class="field">
        <span class="field-label">房间 *</span>
        <input v-model="room" type="text" class="field-input" placeholder="1 / 2 / 3" />
      </label>

      <p v-if="isDefense && previewId" class="id-preview">预计怪物 ID：{{ previewId }}</p>

      <label class="field">
        <span class="field-label">等级</span>
        <input v-model="level" type="number" min="1" class="field-input" />
      </label>

      <label class="field">
        <span class="field-label">弱点</span>
        <input v-model="weakness" type="text" class="field-input" placeholder="冰、火" />
      </label>

      <label class="field">
        <span class="field-label">抗性</span>
        <input v-model="resistance" type="text" class="field-input" />
      </label>

      <div class="field">
        <span class="field-label">怪物图片</span>
        <AdminImagePicker ref="imagePickerRef" @change="onImageChange" />
        <img v-if="imagePreview" :src="imagePreview" alt="预览" class="image-preview" />
      </div>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="message" class="form-success" role="status">{{ message }}</p>

      <button type="submit" class="submit-btn" :disabled="submitting">
        {{ submitting ? '提交中...' : '提交' }}
      </button>
      <p class="submit-hint">若提交无响应，请检查是否已填写所有带 * 的字段</p>
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

.field-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.field-input:focus {
  border-color: #e8a838;
}

.lookup-hint {
  margin: 0;
  font-size: 0.76rem;
  color: #e8a838;
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

.submit-hint {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  text-align: center;
  color: var(--color-text);
  opacity: 0.55;
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
