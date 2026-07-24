<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import { fetchPanelOcrStatus, recognizePanelViaTencentOcr, type OcrQuotaInfo } from '@/api/panelOcr'
import {
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
} from '@/utils/affixDriveDiscConfig'
import { recognizePanelScreenshot } from '@/utils/panelScreenshotRecognize'
import { recognizeFromOcrApiOutput } from '@/utils/panelTencentOcrRecognize'

const props = defineProps<{
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
}>()

const emit = defineEmits<{
  'apply-recognition': [result: PanelScreenshotRecognition]
}>()

const panelImageUrl = ref('')
const panelImageName = ref('')
const showImagePreview = ref(false)
const recognitionStatus = ref('')
const recognitionResult = ref<PanelScreenshotRecognition | null>(null)
const recognitionError = ref('')
const recognizing = ref(false)
const ocrConfigured = ref(false)
const ocrStatusOk = ref(false)
const ocrIsAdmin = ref(false)
const ocrQuota = ref<OcrQuotaInfo>({
  month: '',
  limit: 50,
  used: 0,
  remaining: 50,
  personalRemaining: 50,
  scope: 'user',
  globalLimit: 1000,
  globalUsed: 0,
  globalRemaining: 1000,
})

const driveDiscMainStatsSummary = computed(() => {
  const mains = recognitionResult.value?.driveDiscMainStats
  if (!mains) return ''
  const parts: string[] = []
  const labelOf = (
    options: { id: string; label: string }[],
    id: string | undefined,
    slot: string,
  ) => {
    if (!id) return
    const label = options.find((o) => o.id === id)?.label
    if (label) parts.push(`${slot} ${label}`)
  }
  labelOf(DRIVE_DISC_SLOT_4_OPTIONS, mains.slot4MainStat, '4')
  labelOf(DRIVE_DISC_SLOT_5_OPTIONS, mains.slot5MainStat, '5')
  labelOf(DRIVE_DISC_SLOT_6_OPTIONS, mains.slot6MainStat, '6')
  return parts.join(' · ')
})

const ocrQuotaText = computed(() => {
  const q = ocrQuota.value
  if (!ocrStatusOk.value) return '云识别额度同步中…若持续失败请检查后端 /api/ocr'
  if (!ocrConfigured.value) return '云识别未配置，将使用本地识别（不计入次数）'
  if (ocrIsAdmin.value || q.scope === 'global') {
    return `管理员 · 全站云识别本月剩余 ${q.remaining}/${q.limit} 次`
  }
  if (typeof q.globalRemaining === 'number' && q.globalRemaining <= 0) {
    return `全站云识别本月已用尽（个人剩余 ${q.personalRemaining ?? q.remaining}/${q.limit} 次暂不可用）`
  }
  return `个人云识别本月可用 ${q.remaining}/${q.limit} 次（个人剩余 ${q.personalRemaining ?? q.remaining} · 全站剩余 ${q.globalRemaining ?? '—'}）`
})

async function refreshOcrStatus() {
  try {
    const status = await fetchPanelOcrStatus()
    ocrStatusOk.value = status.ok !== false
    ocrConfigured.value = status.configured
    ocrIsAdmin.value = Boolean(status.isAdmin)
    if (status.quota) ocrQuota.value = status.quota
  } catch {
    ocrStatusOk.value = false
    ocrConfigured.value = false
  }
}

function onWindowFocus() {
  void refreshOcrStatus()
}

onMounted(() => {
  void refreshOcrStatus()
  window.addEventListener('focus', onWindowFocus)
})

onUnmounted(() => {
  window.removeEventListener('focus', onWindowFocus)
})

async function onUploadPanelImage(file: File | null) {
  if (panelImageUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(panelImageUrl.value)
  }
  recognitionResult.value = null
  recognitionError.value = ''
  recognitionStatus.value = ''

  if (!file) {
    panelImageUrl.value = ''
    panelImageName.value = ''
    return
  }

  panelImageUrl.value = URL.createObjectURL(file)
  panelImageName.value = file.name

  recognizing.value = true
  try {
    const catalogs = {
      agents: props.agents,
      wengines: props.wengines,
      driveDiscs: props.driveDiscs,
    }

    let result: PanelScreenshotRecognition | null = null
    recognitionStatus.value = '检查云 OCR…'
    const status = await fetchPanelOcrStatus()
    ocrStatusOk.value = status.ok !== false
    ocrConfigured.value = status.configured
    ocrIsAdmin.value = Boolean(status.isAdmin)
    if (status.quota) ocrQuota.value = status.quota

    if (status.configured) {
      if (status.quota.remaining <= 0) {
        if (ocrIsAdmin.value || status.quota.scope === 'global') {
          recognitionError.value = `本月全站云识别次数已用尽（上限 ${status.quota.limit} 次）`
        } else if (
          typeof status.quota.globalRemaining === 'number' &&
          status.quota.globalRemaining <= 0
        ) {
          recognitionError.value = `本月全站云识别次数已用尽，暂不可识别（上限 ${status.quota.globalLimit ?? 1000} 次）`
        } else {
          recognitionError.value = `您本月云识别次数已用尽（每人 ${status.quota.limit} 次）`
        }
        recognizing.value = false
        recognitionStatus.value = ''
        return
      }
      recognitionStatus.value = 'OCR 识别中…'
      try {
        const ocrData = await recognizePanelViaTencentOcr(file)
        if (ocrData.quota) ocrQuota.value = ocrData.quota
        result = recognizeFromOcrApiOutput(ocrData, catalogs)
      } catch (cloudError) {
        const err = cloudError as Error & { code?: string; quota?: OcrQuotaInfo }
        if (err.quota) ocrQuota.value = err.quota
        if (
          err.code === 'OCR_QUOTA_EXCEEDED' ||
          err.code === 'OCR_USER_QUOTA_EXCEEDED' ||
          err.code === 'OCR_GLOBAL_QUOTA_EXCEEDED' ||
          err.code === 'OCR_CLIENT_REQUIRED'
        ) {
          recognitionError.value = err.message
          recognizing.value = false
          recognitionStatus.value = ''
          return
        }
        const msg = err.message || '云 OCR 失败'
        recognitionStatus.value = `云 OCR 失败，改用本地识别…（${msg}）`
      }
    }

    if (!result) {
      result = await recognizePanelScreenshot(file, catalogs, (message) => {
        recognitionStatus.value = message
      })
    }

    recognitionResult.value = result
    emit('apply-recognition', result)
    void refreshOcrStatus()
  } catch (error) {
    recognitionError.value = error instanceof Error ? error.message : '截图识别失败'
  } finally {
    recognizing.value = false
    recognitionStatus.value = ''
  }
}

async function onUploadTencentOcrJson(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  recognitionError.value = ''
  recognitionStatus.value = ''
  if (!file) return

  recognizing.value = true
  recognitionStatus.value = '解析 OCR 接口结果…'
  recognitionResult.value = null
  try {
    const text = await file.text()
    let raw: unknown = text
    try {
      raw = JSON.parse(text) as unknown
    } catch {
      raw = text
    }
    const result = recognizeFromOcrApiOutput(raw, {
      agents: props.agents,
      wengines: props.wengines,
      driveDiscs: props.driveDiscs,
    })
    recognitionResult.value = result
    emit('apply-recognition', result)
  } catch (error) {
    recognitionError.value =
      error instanceof Error ? error.message : 'OCR 结果解析失败'
  } finally {
    recognizing.value = false
    recognitionStatus.value = ''
  }
}
</script>

<template>
  <section id="damage-panel-upload" class="section-card upload-section damage-anchor">
    <header class="section-header">
      <div>
        <h2>图片录入</h2>
        <p class="section-desc">
          识别角色面板并填入主C配置与局外面板；词条数由识别出的局外面板按换算公式反推。也可手动上传 OCR
          JSON/文本对照。
        </p>
      </div>
      <label class="preview-toggle">
        <input v-model="showImagePreview" type="checkbox" />
        <span>预览图片</span>
      </label>
    </header>

    <p class="ocr-quota-hint">{{ ocrQuotaText }}</p>
    <div class="upload-actions">
      <label class="ocr-json-btn">
        选择 OCR 结果
        <input
          type="file"
          accept="application/json,.json,text/plain,.txt"
          hidden
          @change="onUploadTencentOcrJson"
        />
      </label>
      <AdminImagePicker button-text="选择截图" @change="onUploadPanelImage" />
    </div>
    <p v-if="recognizing" class="recognition-status">{{ recognitionStatus || '正在识别…' }}</p>
    <p v-if="recognitionError" class="recognition-error">{{ recognitionError }}</p>
    <div v-if="recognitionResult" class="recognition-result">
      <p class="recognition-result-title">
        识别结果
      </p>
      <ul>
        <li>角色：{{ recognitionResult.agentName ?? '未识别' }} · {{ recognitionResult.rank }}影</li>
        <li>
          音擎：{{ recognitionResult.wengineName ?? '未识别' }} · 精{{
            recognitionResult.wengineRefine
          }}
        </li>
        <li>
          驱动盘：2件 {{ recognitionResult.twoPieceDriveDiscName ?? '未识别' }} · 4件
          {{ recognitionResult.fourPieceDriveDiscName ?? '未识别' }}
        </li>
        <li v-if="recognitionResult.externalPanel.hp">
          生命 {{ recognitionResult.externalPanel.hp }} · 攻击
          {{ recognitionResult.externalPanel.atk ?? '—' }}
        </li>
        <li>
          穿透率 {{ recognitionResult.externalPanel.penRate ?? '—' }}% · 穿透值
          {{ recognitionResult.externalPanel.pen ?? '—' }} · 增伤
          {{ recognitionResult.externalPanel.dmgBonus ?? '—' }}%
        </li>
        <li v-if="driveDiscMainStatsSummary">
          4/5/6 主属性：{{ driveDiscMainStatsSummary }}（反推词条时扣除）
        </li>
      </ul>
      <ul v-if="recognitionResult.warnings.length" class="recognition-warnings">
        <li v-for="warning in recognitionResult.warnings" :key="warning">{{ warning }}</li>
      </ul>
    </div>
    <div v-if="showImagePreview" class="upload-preview">
      <img v-if="panelImageUrl" :src="panelImageUrl" :alt="panelImageName || '面板预览'" />
      <p v-else>选择截图后可在此预览；识别后将写入面板并反推词条数。</p>
    </div>
  </section>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.section-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
  line-height: 1.45;
}

.preview-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
  margin-top: 0.15rem;
  font-size: 0.82rem;
  color: #d5dae4;
  cursor: pointer;
  user-select: none;
}

.preview-toggle input {
  width: 1rem;
  height: 1rem;
  accent-color: #c9a55c;
}

.section-card {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}

.ocr-quota-hint {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
  color: #d8c39a;
  font-weight: 600;
}

.upload-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  align-items: center;
}

.upload-actions :deep(.image-picker) {
  flex: 1;
  min-width: 0;
}

.ocr-json-btn {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0.4rem 0.75rem;
  border: 1px solid #3a4033;
  border-radius: 8px;
  background: #1c1915;
  color: #d8c8aa;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}

.ocr-json-btn:hover {
  border-color: #c9a55c;
  background: #252018;
}

.recognition-status {
  margin: 0.45rem 0 0;
  font-size: 0.78rem;
  color: #d8c39a;
}

.recognition-error {
  margin: 0.45rem 0 0;
  font-size: 0.78rem;
  color: #ffb4b4;
}

.recognition-result {
  margin-top: 0.5rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid #34302a;
  border-radius: 8px;
  background: #14120f;
  font-size: 0.78rem;
  color: #d8c39a;
}

.recognition-result-title {
  margin: 0 0 0.35rem;
  font-weight: 600;
}

.recognition-result ul {
  margin: 0;
  padding-left: 1rem;
}

.recognition-result li {
  margin: 0.15rem 0;
}

.recognition-warnings {
  margin-top: 0.35rem !important;
  color: #e8b4a0;
}

.upload-section :deep(.image-picker) {
  border-color: #2d323a;
  background: #0f1217;
}

.upload-section :deep(.image-picker-btn) {
  border-color: #3a4033;
  background: #1c1915;
  color: #d8c8aa;
}

.upload-section :deep(.image-picker-btn:hover) {
  border-color: #c9a55c;
  background: #252018;
}

.upload-section :deep(.image-picker-name) {
  color: #8f8678;
}

.upload-preview {
  margin-top: 0.55rem;
  border: 1px dashed #2b2f35;
  border-radius: 10px;
  padding: 0.6rem;
  min-height: 110px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  color: #97a0ad;
  background: #111319;
}

.upload-preview img {
  margin-top: 0.5rem;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 360px;
  object-fit: contain;
  object-position: left top;
  border-radius: 8px;
}

@media (max-width: 768px) {
  .section-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.45rem;
  }

  .section-header h2 {
    font-size: 0.98rem;
  }

  .section-desc {
    font-size: 0.72rem;
  }

  .preview-toggle {
    align-self: flex-start;
  }

  .ocr-quota-hint {
    font-size: 0.72rem;
    line-height: 1.4;
  }

  .upload-actions {
    flex-wrap: wrap;
  }

  .ocr-json-btn {
    width: 100%;
    justify-content: center;
    min-height: 2.4rem;
  }

  .upload-preview img {
    max-height: 240px;
  }
}
</style>
