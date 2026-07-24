<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createBoss,
  fetchSeasonDates,
  lookupBossInfo,
  searchBossInfoNames,
  searchBossRecords,
  uploadBossImage,
  type SeasonDateMode,
} from '@/api/admin'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import type { AdminScope, DefenseMonsterCategory } from '@/types/admin'
import { adminScopeTitles, isDefenseScope, recordSchemeFromScope } from '@/types/admin'
import { encodeDefenseBossId } from '@/utils/defenseId'
import { calcCrisisHpCoeffPercent, getCrisisBaseHpByName } from '@/utils/crisisHpCoeff'
import { CRISIS_HARD_ROOM_CODE, normalizeCrisisRoomCode } from '@/utils/crisisRoom'
import { resolveAssetUrl } from '@/utils/gameData'

const props = defineProps<{
  scope: AdminScope
}>()

const isDefense = computed(() => isDefenseScope(props.scope))
const isDefenseNew = computed(() => props.scope === 'defense-new')
const seasonMode = computed<SeasonDateMode>(() => (isDefense.value ? 'defense' : 'crisis'))

const CRISIS_ROOM_OPTIONS = [
  { value: '1', label: '房间 1' },
  { value: '2', label: '房间 2' },
  { value: '3', label: '房间 3' },
  { value: CRISIS_HARD_ROOM_CODE, label: '困难' },
] as const

const version = ref('')
const phase = ref('')
const customVersion = ref('')
const customPhase = ref('')
const knownVersionPhases = ref<Array<{ version: string; phase: string }>>([])
const bossName = ref('')
const hp = ref('')
const crisisBaseHp = ref('')
const hpCoeffPercent = ref('')
const hpCoeffManual = ref(false)
const defense = ref('')
const level = ref('70')
const room = ref('1')
const stage = ref('5')
const roomInStage = ref('1')
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

function compareVersionDesc(a: string, b: string) {
  const parse = (value: string) =>
    value.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0)
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const resolvedVersion = computed(() => customVersion.value.trim() || version.value.trim())
const resolvedPhase = computed(() => customPhase.value.trim() || phase.value.trim())

const availableVersions = computed(() => {
  const set = new Set(knownVersionPhases.value.map((item) => item.version).filter(Boolean))
  return [...set].sort(compareVersionDesc)
})

const availablePhases = computed(() => {
  const currentVersion = resolvedVersion.value
  if (!currentVersion) return []
  const set = new Set(
    knownVersionPhases.value
      .filter((item) => item.version === currentVersion)
      .map((item) => String(item.phase).replace(/\D/g, '') || String(item.phase))
      .filter(Boolean),
  )
  return [...set].sort((a, b) => Number(b) - Number(a))
})

function applyDefaultVersionPhase() {
  const latestVersion = availableVersions.value[0] ?? ''
  if (!version.value && latestVersion) version.value = latestVersion
  const phases = availablePhases.value
  if (!phase.value && phases.length) phase.value = phases[0] ?? ''
}

async function loadVersionPhaseOptions() {
  try {
    const scheme = recordSchemeFromScope(props.scope)
    const [dates, bosses] = await Promise.all([
      fetchSeasonDates(seasonMode.value),
      scheme
        ? searchBossRecords({ recordScheme: scheme, limit: 1000 })
        : Promise.resolve([]),
    ])
    const merged = [
      ...dates.map((row) => ({ version: row.version, phase: String(row.phase) })),
      ...bosses.map((row) => ({ version: row.version, phase: String(row.phase) })),
    ]
    knownVersionPhases.value = merged
    applyDefaultVersionPhase()
  } catch {
    knownVersionPhases.value = []
  }
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
  crisis_base_hp?: number | null
}) {
  defense.value = String(info.defense ?? 0)
  level.value = String(info.level ?? 1)
  weakness.value = info.weakness ?? ''
  resistance.value = info.resistance ?? ''
  if (info.crisis_base_hp != null && Number.isFinite(Number(info.crisis_base_hp))) {
    crisisBaseHp.value = String(info.crisis_base_hp)
  } else {
    const mapped = getCrisisBaseHpByName(bossName.value)
    crisisBaseHp.value = mapped != null ? String(mapped) : ''
  }
  imageUrl.value = info.boss_image ?? ''
  imagePreview.value = resolveAssetUrl(info.boss_image) ?? ''
  imageFile.value = null
  imagePickerRef.value?.reset()
  syncAutoCoeff()
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

function syncAutoCoeff() {
  if (hpCoeffManual.value || isDefense.value) return
  const hpNumber = Number(hp.value)
  const baseNumber = Number(crisisBaseHp.value)
  const auto = calcCrisisHpCoeffPercent(hpNumber, baseNumber)
  hpCoeffPercent.value = auto != null ? String(auto) : ''
}

const autoCoeffHint = computed(() => {
  if (isDefense.value) return ''
  const hpNumber = Number(hp.value)
  const baseNumber = Number(crisisBaseHp.value)
  const auto = calcCrisisHpCoeffPercent(hpNumber, baseNumber)
  if (auto == null) return '填写血量与基础血量后可自动计算系数'
  if (hpCoeffManual.value) return `自动计算为 ${auto}%（当前为手动覆盖）`
  return `自动计算：${auto}%`
})

function onCoeffInput() {
  hpCoeffManual.value = fieldText(hpCoeffPercent.value).length > 0
}

function resetCrisisCoeffFields() {
  crisisBaseHp.value = ''
  hpCoeffPercent.value = ''
  hpCoeffManual.value = false
}

function updatePreviewId() {
  if (!isDefense.value) {
    previewId.value = ''
    return
  }

  try {
    previewId.value = String(
      encodeDefenseBossId({
        version: resolvedVersion.value,
        phase: resolvedPhase.value,
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
  stage.value = '5'
  roomInStage.value = '1'
  wave.value = '1'
  monsterCategory.value = 'boss'
  monsterSubType.value = '1'
  count.value = '1'
  previewId.value = ''
}

const defenseStageOptions = computed(() => {
  if (isDefenseNew.value) return [1, 2, 3, 4, 5]
  return [1, 2, 3, 4, 5, 6, 7, 8, 9]
})

const defenseRoomOptions = computed(() => {
  const stageNum = Number(stage.value)
  if (stageNum === 5) return [1, 2, 3]
  return [1, 2]
})

function applyScopeDefaults() {
  if (isDefense.value) {
    resetDefenseFields()
    level.value = '1'
  } else {
    level.value = '70'
    room.value = '1'
  }
}

watch(
  () => props.scope,
  () => {
    applyScopeDefaults()
    customVersion.value = ''
    customPhase.value = ''
    version.value = ''
    phase.value = ''
    loadVersionPhaseOptions()
  },
  { immediate: true },
)

watch([version, customVersion], () => {
  const phases = availablePhases.value
  if (phase.value && !phases.includes(phase.value)) {
    phase.value = phases[0] ?? ''
  } else if (!phase.value && phases.length) {
    phase.value = phases[0] ?? ''
  }
})

watch(stage, () => {
  if (!isDefense.value) return
  if (!defenseRoomOptions.value.includes(Number(roomInStage.value))) {
    roomInStage.value = String(defenseRoomOptions.value[0] ?? 1)
  }
})

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
    if (!resolvedVersion.value || !resolvedPhase.value || !fieldText(bossName.value)) {
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
    } else if (!normalizeCrisisRoomCode(room.value)) {
      error.value = '危局强袭战须选择房间（1 / 2 / 3 / 困难）'
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
          version: resolvedVersion.value,
          phase: resolvedPhase.value,
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
      version: resolvedVersion.value,
      phase: resolvedPhase.value,
      boss_name: fieldText(bossName.value),
      hp: hpNumber,
      defense: fieldText(defense.value) ? Number(defense.value) : 0,
      level: fieldText(level.value)
        ? Number(level.value)
        : isDefense.value
          ? 1
          : 70,
      room: isDefense.value ? null : normalizeCrisisRoomCode(room.value),
      weakness: fieldText(weakness.value) || null,
      resistance: fieldText(resistance.value) || null,
      boss_image: bossImage,
      crisis_base_hp:
        !isDefense.value && fieldText(crisisBaseHp.value)
          ? Number(crisisBaseHp.value)
          : undefined,
      hp_coeff_percent:
        !isDefense.value && hpCoeffManual.value && fieldText(hpCoeffPercent.value)
          ? Number(hpCoeffPercent.value)
          : undefined,
      hp_coeff_manual: !isDefense.value && hpCoeffManual.value,
      ...defensePayload,
    })

    const syncMessage = bossInfoSyncMessage(result.bossInfoSync?.action)
    const actionHint = result.action === 'updated' ? '（已覆盖同 ID 记录）' : ''
    message.value = syncMessage
      ? `怪物添加成功（ID ${result.id}）${actionHint}，${syncMessage}`
      : `怪物添加成功（ID ${result.id}）${actionHint}`
    showFeedback('message')

    const keptVersion = resolvedVersion.value
    const keptPhase = resolvedPhase.value
    version.value = keptVersion
    phase.value = keptPhase
    customVersion.value = ''
    customPhase.value = ''
    bossName.value = ''
    hp.value = ''
    defense.value = ''
    level.value = isDefense.value ? '1' : '70'
    room.value = '1'
    resetDefenseFields()
    resetCrisisCoeffFields()
    weakness.value = ''
    resistance.value = ''
    imageFile.value = null
    imagePickerRef.value?.reset()
    imagePreview.value = ''
    imageUrl.value = ''
    lookupHint.value = ''
    nameSuggestions.value = []
    await loadVersionPhaseOptions()
    version.value = keptVersion
    phase.value = keptPhase
    if (!availablePhases.value.includes(keptPhase) && keptPhase) {
      customPhase.value = keptPhase
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提交失败'
    showFeedback('error')
  } finally {
    submitting.value = false
  }
}

watch(bossName, (value) => {
  scheduleBossLookup(value)
  if (!isDefense.value) {
    const mapped = getCrisisBaseHpByName(value)
    if (mapped != null && !fieldText(crisisBaseHp.value)) {
      crisisBaseHp.value = String(mapped)
    }
    syncAutoCoeff()
  }
})

watch([hp, crisisBaseHp], () => {
  syncAutoCoeff()
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

      <template v-if="!isDefense">
        <div class="field-row">
          <label class="field">
            <span class="field-label">怪物危局基础血量</span>
            <input
              v-model="crisisBaseHp"
              type="number"
              min="0"
              step="any"
              class="field-input"
              placeholder="可从名称自动带出"
            />
          </label>
          <label class="field">
            <span class="field-label">危局血量系数 %</span>
            <input
              v-model="hpCoeffPercent"
              type="number"
              step="1"
              class="field-input"
              placeholder="自动计算，可手动覆盖"
              @input="onCoeffInput"
            />
          </label>
        </div>
        <p class="lookup-hint">
          {{ autoCoeffHint }}；公式：Boss血量 = 基础血量 × (系数 ÷ 100)，系数取整百分比
        </p>
      </template>

      <div v-if="isDefense" class="field-row">
        <label class="field">
          <span class="field-label">关卡 *</span>
          <select v-model="stage" class="field-input">
            <option v-for="item in defenseStageOptions" :key="item" :value="String(item)">
              第 {{ item }} 关
            </option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">房间 *</span>
          <select v-model="roomInStage" class="field-input">
            <option v-for="item in defenseRoomOptions" :key="item" :value="String(item)">
              房间 {{ item }}
            </option>
          </select>
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
        <select v-model="room" class="field-input">
          <option v-for="item in CRISIS_ROOM_OPTIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
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
