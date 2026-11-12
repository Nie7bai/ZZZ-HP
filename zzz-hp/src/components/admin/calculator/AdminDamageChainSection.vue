<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import {
  DAMAGE_CHAIN_KEY_OPTIONS,
  DAMAGE_CHAIN_SCOPES,
  DAMAGE_CHAIN_SCOPE_LABELS,
  createDamageChain,
  deleteDamageChain,
  fetchDamageChains,
  isAdminDamageChainAuthError,
  isCustomDamageChainKey,
  updateDamageChain,
  type DamageChainDoc,
  type DamageChainInput,
  type DamageChainScope,
  type DamageChainStageDoc,
} from '@/api/adminDamageChains'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import { BUFF_DAMAGE_TYPE_GROUPS } from '@/types/calculator'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  BUILT_IN_DAMAGE_CHAINS,
  DAMAGE_CHAIN_MODULE_OPTIONS,
  STAGE_KIND_LABELS,
  getDamageChain,
  resolveDamageChain,
  type DamageChainDefinition,
  type StageAction,
  type StageDefinition,
  type StageKind,
} from '@/zones/pipeline'
import { adaptDamageChain } from '@/zones/chainAdapter'
import { DAMAGE_CHAIN_SAMPLE_HITS, previewDamageChain, type DamageChainPreview } from '@/zones/preview'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 管理端 → 角色计算器 → 计算链路（Phase 4f）。
 *
 * 列表：内置链路（只读）+ 数据库链路；编辑：阶段用格子展示（外观与用户端
 * `FlowZoneCalculation.vue` 的乘区格一致），支持拖拽排序、启停、改模块/参数/条件。
 * 内置链路不能删除；覆盖内置链路 = 用同一 `chainKey` 新建/编辑一条数据库链路。
 */

const router = useRouter()
const calculatorBuffStore = useCalculatorBuffStore()

const CHAIN_WRITE_ACTIONS: Array<{ id: StageAction; label: string }> = [
  { id: 'replace', label: '覆盖' },
  { id: 'inherit', label: '继承内置' },
  { id: 'disable', label: '禁用' },
]

const STAGE_KINDS: StageKind[] = ['source', 'multiplier', 'combine', 'final']

const chains = ref<DamageChainDoc[]>([])
const loading = ref(false)
const busy = ref(false)
const previewResult = ref<DamageChainPreview | null>(null)
const previewError = ref('')
/** 预览用示例命中：选伤害类型，便于验证不同链路 */
const previewSampleId = ref(DAMAGE_CHAIN_SAMPLE_HITS[0]!.id)
const error = ref('')
const message = ref('')
const authDialogVisible = ref(false)
const pendingDelete = ref<DamageChainDoc | null>(null)

/** 选中行：`builtin:<id>` / `db:<id>` */
const selectedRowKey = ref('')

function handleAuthError(err: unknown): boolean {
  if (!isAdminDamageChainAuthError(err)) return false
  authDialogVisible.value = true
  return true
}

function goRelogin() {
  clearAdminAuthenticated()
  authDialogVisible.value = false
  void router.push('/admin/login')
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function scopeLabel(value: string): string {
  return DAMAGE_CHAIN_SCOPE_LABELS[value as DamageChainScope] || value
}

// ---- 编辑行：阶段格子 ----

interface StageFormRow {
  /** 编辑期稳定 key（阶段 id 可以改） */
  key: string
  id: string
  kind: StageKind
  label: string
  group: string
  order: string
  module: string
  /** 依赖阶段 id，逗号分隔 */
  inputs: string
  paramsText: string
  whenText: string
  enabled: boolean
  action: StageAction
  /** 该 id 在内置链路里已存在（删除 = 禁用而不是移除） */
  base: boolean
}

interface ChainFormState {
  id: number | null
  chainKey: string
  label: string
  scope: DamageChainScope
  targetId: string
  priority: string
  enabled: boolean
  damageKinds: string[]
  subKinds: string[]
  stages: StageFormRow[]
  readonly: boolean
}

let stageKeySeed = 0

function nextStageKey(): string {
  stageKeySeed += 1
  return `stage-${stageKeySeed}`
}

function prettyJson(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function stageToRow(stage: StageDefinition, base: boolean, action: StageAction = 'replace'): StageFormRow {
  return {
    key: nextStageKey(),
    id: stage.id,
    kind: stage.kind,
    label: stage.label,
    group: stage.group,
    order: String(stage.order),
    module: stage.module ?? '',
    inputs: (stage.inputs ?? []).join(', '),
    paramsText: stage.params && Object.keys(stage.params).length ? prettyJson(stage.params) : '',
    whenText: stage.when !== undefined ? prettyJson(stage.when) : '',
    enabled: stage.enabled !== false && action !== 'disable',
    action,
    base,
  }
}

/** 内置链路 → 编辑行（全部视为覆盖，便于整条改名/排序） */
function rowsFromBuiltin(chainKey: string): StageFormRow[] {
  const builtin = getDamageChain(chainKey)
  return (builtin?.stages ?? []).map((stage) => stageToRow(stage, true))
}

/**
 * 数据库链路 → 编辑行：先按「内置 + 本条链路」解析出生效阶段，
 * 再把被禁用/被移除的内置阶段补回成禁用格子（保存时才能表达「删掉某阶段」）。
 */
function rowsFromDoc(doc: DamageChainDoc): StageFormRow[] {
  const builtin = getDamageChain(doc.chainKey)
  const builtinIds = new Set((builtin?.stages ?? []).map((stage) => stage.id))
  const definition = adaptDamageChain(doc)
  if (!definition) return []
  const forced: DamageChainDefinition = { ...definition, scope: 'global', targetId: '', enabled: true }
  const resolved = resolveDamageChain(doc.chainKey, {}, builtin ? [builtin, forced] : [definition])
  const rows = resolved.stages.map((stage) => stageToRow(stage, builtinIds.has(stage.id)))
  const present = new Set(rows.map((row) => row.id))
  for (const stage of doc.stages) {
    if (present.has(stage.id)) continue
    const fallback = builtin?.stages.find((item) => item.id === stage.id)
    const disabled = stage.action === 'disable' || stage.enabled === false
    if (!fallback && !disabled) continue
    const source: StageDefinition = fallback ?? {
      id: stage.id,
      kind: stage.kind,
      label: stage.label ?? stage.id,
      group: stage.group ?? doc.chainKey,
      order: stage.order ?? 0,
    }
    rows.push(stageToRow({ ...source, enabled: false }, builtinIds.has(stage.id), 'disable'))
  }
  return rows.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
}

function emptyChainForm(): ChainFormState {
  return {
    id: null,
    chainKey: 'direct',
    label: '',
    scope: 'agent',
    targetId: '',
    priority: '10',
    enabled: true,
    damageKinds: [],
    subKinds: [],
    stages: [],
    readonly: true,
  }
}

const chainForm = reactive<ChainFormState>(emptyChainForm())
const selectedStageIndex = ref(-1)
const formError = ref('')

const formVisible = computed(() => Boolean(selectedRowKey.value))

const selectedStage = computed<StageFormRow | null>(
  () => chainForm.stages[selectedStageIndex.value] ?? null,
)

const selectedStageParamsError = computed(() => {
  const row = selectedStage.value
  if (!row) return ''
  if (!row.paramsText.trim()) return ''
  try {
    const parsed: unknown = JSON.parse(row.paramsText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'params 必须是 JSON 对象'
    }
    return ''
  } catch (err) {
    return `params JSON 解析失败：${err instanceof Error ? err.message : '格式错误'}`
  }
})

const selectedStageWhenError = computed(() => {
  const row = selectedStage.value
  if (!row || !row.whenText.trim()) return ''
  try {
    JSON.parse(row.whenText)
    return ''
  } catch (err) {
    return `when JSON 解析失败：${err instanceof Error ? err.message : '格式错误'}`
  }
})

const targetOptions = computed<Array<{ id: string; label: string }>>(() => {
  switch (chainForm.scope) {
    case 'agent':
      return calculatorBuffStore.agents.map((agent) => ({
        id: agent.id,
        label: `${agent.name}（${agent.id}）`,
      }))
    case 'profession':
      return [
        ...new Set(
          calculatorBuffStore.agents
            .map((agent) => agent.profession.trim())
            .filter((profession) => profession.length > 0),
        ),
      ].map((profession) => ({ id: profession, label: profession }))
    case 'skill_group':
      return calculatorBuffStore.skillGroups.map((group) => ({
        id: group.id,
        label: `${group.name}（${group.id}）`,
      }))
    default:
      return []
  }
})

const targetPlaceholder = computed(() => {
  switch (chainForm.scope) {
    case 'agent':
      return '角色 id，例如 remiel'
    case 'profession':
      return '职业名，例如 强攻 / 异常'
    case 'skill_group':
      return '技能组 id'
    case 'skill':
      return '招式 id'
    default:
      return 'global 作用域不需要 target_id'
  }
})

const stageModuleOptions = computed(() => DAMAGE_CHAIN_MODULE_OPTIONS)

function paramsSummary(row: StageFormRow): string {
  if (!row.paramsText.trim()) return row.module ? '无参数' : '未选模块'
  try {
    const parsed: unknown = JSON.parse(row.paramsText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '参数格式错误'
    const count = Object.keys(parsed as Record<string, unknown>).length
    return count ? `参数 ${count} 项` : '无参数'
  } catch {
    return '参数格式错误'
  }
}

function stageStatusText(row: StageFormRow): string {
  if (!row.enabled || row.action === 'disable') return '已禁用'
  if (row.action === 'inherit') return '继承内置'
  return paramsSummary(row)
}

// ---- 选中 / 新建 / 编辑 ----

function resetStageSelection() {
  selectedStageIndex.value = chainForm.stages.length ? 0 : -1
}

function openBuiltin(chainId: string) {
  const chain = getDamageChain(chainId)
  if (!chain) return
  selectedRowKey.value = `builtin:${chainId}`
  Object.assign(chainForm, {
    id: null,
    chainKey: chainId,
    label: chain.label,
    scope: 'global' as DamageChainScope,
    targetId: '',
    priority: String(chain.priority ?? 0),
    enabled: true,
    damageKinds: [...chain.appliesTo.damageKinds],
    subKinds: [],
    stages: rowsFromBuiltin(chainId),
    // 内置链路允许直接编辑；保存时按同 chainKey 新建 DB 覆盖
    readonly: false,
  })
  formError.value = ''
  resetStageSelection()
}

function openDoc(doc: DamageChainDoc) {
  selectedRowKey.value = `db:${doc.id}`
  Object.assign(chainForm, {
    id: doc.id,
    chainKey: doc.chainKey,
    label: doc.label,
    scope: doc.scope,
    targetId: doc.targetId,
    priority: String(doc.priority),
    enabled: doc.enabled,
    damageKinds: [...doc.appliesTo.damageKinds],
    subKinds: [...(doc.appliesTo.subKinds ?? [])],
    stages: rowsFromDoc(doc),
    readonly: false,
  })
  formError.value = ''
  resetStageSelection()
}

function startCreateChain(chainKey = 'direct') {
  const builtin = getDamageChain(chainKey)
  selectedRowKey.value = 'new'
  Object.assign(chainForm, {
    id: null,
    chainKey,
    label: builtin ? `${builtin.label}（覆盖）` : '自定义链路',
    scope: 'agent' as DamageChainScope,
    targetId: '',
    priority: '10',
    enabled: true,
    damageKinds: [...(builtin?.appliesTo.damageKinds ?? [])],
    subKinds: [],
    stages: rowsFromBuiltin(chainKey),
    readonly: false,
  })
  formError.value = ''
  resetStageSelection()
}

/** 内置链路「以本链路新建覆盖」 */
function overrideBuiltin() {
  const chain = getDamageChain(chainForm.chainKey)
  if (!chain) return
  startCreateChain(chain.id)
  chainForm.label = `${chain.label}（覆盖）`
}

/** 从内置链路重置阶段（只改本地编辑态，保存后才生效） */
function loadBuiltinStages() {
  chainForm.stages = rowsFromBuiltin(chainForm.chainKey)
  resetStageSelection()
}

function cancelForm() {
  selectedRowKey.value = ''
  formError.value = ''
  selectedStageIndex.value = -1
  Object.assign(chainForm, emptyChainForm())
}

// ---- 阶段操作 ----

function renumberStages() {
  chainForm.stages.forEach((row, index) => {
    row.order = String((index + 1) * 10)
  })
}

function selectStage(index: number) {
  selectedStageIndex.value = index
}

function addStage() {
  let suffix = chainForm.stages.length + 1
  let id = `stage-${suffix}`
  while (chainForm.stages.some((row) => row.id === id)) {
    suffix += 1
    id = `stage-${suffix}`
  }
  chainForm.stages.push({
    key: nextStageKey(),
    id,
    kind: 'multiplier',
    label: '新乘区',
    group: chainForm.chainKey,
    order: String((chainForm.stages.length + 1) * 10),
    module: 'percentSum',
    inputs: '',
    paramsText: '',
    whenText: '',
    enabled: true,
    action: 'replace',
    base: false,
  })
  selectedStageIndex.value = chainForm.stages.length - 1
}

/** 删除：内置阶段改成禁用（否则下次合并会把它带回来），自定义阶段直接移除 */
function removeStage(index: number) {
  const row = chainForm.stages[index]
  if (!row) return
  if (row.base) {
    row.action = 'disable'
    row.enabled = false
  } else {
    chainForm.stages.splice(index, 1)
  }
  if (selectedStageIndex.value >= chainForm.stages.length) {
    selectedStageIndex.value = chainForm.stages.length - 1
  }
}

function toggleStage(row: StageFormRow) {
  if (row.base) {
    row.action = row.action === 'disable' ? 'replace' : 'disable'
    row.enabled = row.action !== 'disable'
    return
  }
  row.enabled = !row.enabled
}

function moveStage(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= chainForm.stages.length) return
  const rows = chainForm.stages
  const [row] = rows.splice(index, 1)
  if (!row) return
  rows.splice(target, 0, row)
  renumberStages()
  selectedStageIndex.value = target
}

const dragIndex = ref(-1)

function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function onDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = -1
  if (from < 0 || from === index) return
  const rows = chainForm.stages
  const [row] = rows.splice(from, 1)
  if (!row) return
  rows.splice(index, 0, row)
  renumberStages()
  selectedStageIndex.value = index
}

// ---- 保存 / 删除 ----

interface ParsedStageRow {
  stage?: DamageChainStageDoc
  error: string
}

function parseStageRow(row: StageFormRow, index: number): ParsedStageRow {
  const id = row.id.trim()
  if (!id) return { error: `第 ${index + 1} 个阶段缺少 id` }
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(id) || id.length > 64) {
    return { error: `阶段 id ${id} 格式非法：只允许字母开头的字母/数字/下划线/点/连字符/冒号（≤64）` }
  }
  if (!row.module.trim()) {
    return { error: `阶段 ${id} 必须选择 module（后端要求每个阶段都有模块）` }
  }
  let params: Record<string, unknown> | undefined
  if (row.paramsText.trim()) {
    try {
      const parsed: unknown = JSON.parse(row.paramsText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: `阶段 ${id} 的 params 必须是 JSON 对象` }
      }
      params = parsed as Record<string, unknown>
    } catch (err) {
      return { error: `阶段 ${id} 的 params JSON 解析失败：${err instanceof Error ? err.message : '格式错误'}` }
    }
  }
  let when: unknown
  if (row.whenText.trim()) {
    try {
      const parsed: unknown = JSON.parse(row.whenText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: `阶段 ${id} 的 when 必须是 JSON 对象` }
      }
      when = parsed
    } catch (err) {
      return { error: `阶段 ${id} 的 when JSON 解析失败：${err instanceof Error ? err.message : '格式错误'}` }
    }
  }
  const order = Number(row.order)
  const inputs = row.inputs
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (row.action === 'inherit' && !row.base) {
    return { error: `阶段 ${id} 不在内置链路里，不能选择「继承内置」` }
  }
  const stage: DamageChainStageDoc = {
    id,
    kind: row.kind,
    label: row.label.trim() || id,
    group: row.group.trim() || chainForm.chainKey,
    order: Number.isFinite(order) ? order : (index + 1) * 10,
    module: row.module.trim(),
    enabled: row.enabled,
    action: row.action,
  }
  if (inputs.length) stage.inputs = inputs
  if (params) stage.params = params
  if (when !== undefined) stage.when = when
  return { stage, error: '' }
}

function runPreview() {
  previewError.value = ''
  previewResult.value = null
  const stages: StageDefinition[] = []
  for (const [index, row] of chainForm.stages.entries()) {
    if (!row.enabled || row.action === 'disable') continue
    const parsed = parseStageRow(row, index)
    if (!parsed.stage) {
      previewError.value = parsed.error
      return
    }
    stages.push({
      id: parsed.stage.id,
      kind: parsed.stage.kind,
      module: parsed.stage.module ?? '',
      label: parsed.stage.label ?? parsed.stage.id,
      group: parsed.stage.group ?? chainForm.chainKey,
      order: parsed.stage.order ?? index * 10,
      inputs: parsed.stage.inputs,
      params: parsed.stage.params,
      when: parsed.stage.when as StageDefinition['when'],
      enabled: true,
    })
  }
  if (!stages.length) {
    previewError.value = '没有可预览的启用阶段'
    return
  }
  previewResult.value = previewDamageChain(chainForm.chainKey, stages, {}, previewSampleId.value)
}

async function saveChain() {
  formError.value = ''
  if (chainForm.readonly) return
  const chainKey = chainForm.chainKey.trim()
  if (!chainKey) {
    formError.value = 'chainKey 不能为空'
    return
  }
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(chainKey) || chainKey.length > 64) {
    formError.value = 'chainKey 格式非法：字母开头，只允许字母/数字/下划线/点/连字符/冒号（如 direct / custom:remielRadiance）'
    return
  }
  const label = chainForm.label.trim()
  if (!label) {
    formError.value = '链路名称不能为空'
    return
  }
  const priority = Number(chainForm.priority)
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
    formError.value = 'priority 必须是 0–1000 的整数'
    return
  }
  const targetId = chainForm.scope === 'global' ? '' : chainForm.targetId.trim()
  if (chainForm.scope !== 'global' && !targetId) {
    formError.value = `scope=${chainForm.scope} 时必须填写 target_id`
    return
  }
  if (!chainForm.damageKinds.length) {
    formError.value = 'appliesTo.damageKinds 至少选择一个伤害类型'
    return
  }
  const stages: DamageChainStageDoc[] = []
  const seen = new Set<string>()
  for (let index = 0; index < chainForm.stages.length; index += 1) {
    const row = chainForm.stages[index]
    if (!row) continue
    const parsed = parseStageRow(row, index)
    if (!parsed.stage) {
      formError.value = parsed.error
      return
    }
    if (seen.has(parsed.stage.id)) {
      formError.value = `阶段 id 重复：${parsed.stage.id}`
      return
    }
    seen.add(parsed.stage.id)
    stages.push(parsed.stage)
  }
  if (!stages.length) {
    formError.value = '至少保留一个阶段'
    return
  }

  const input: DamageChainInput = {
    chainKey,
    label,
    appliesTo: {
      damageKinds: [...chainForm.damageKinds],
      ...(chainForm.subKinds.length ? { subKinds: [...chainForm.subKinds] } : {}),
    },
    scope: chainForm.scope,
    targetId,
    priority,
    enabled: chainForm.enabled,
    stages,
  }

  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const saved =
      chainForm.id == null
        ? await createDamageChain(input)
        : await updateDamageChain(chainForm.id, input)
    message.value = `已保存计算链路「${saved.label}」（${saved.chainKey} · ${scopeLabel(saved.scope)} · ${saved.targetId || '全局'}，v${saved.version}）`
    await loadChains()
    const refreshed = chains.value.find((item) => item.id === saved.id)
    if (refreshed) openDoc(refreshed)
  } catch (err) {
    if (!handleAuthError(err)) formError.value = errorText(err, '保存计算链路失败')
  } finally {
    busy.value = false
  }
}

async function confirmDeleteChain() {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await deleteDamageChain(target.id)
    message.value = `已删除计算链路「${target.label}」（${target.chainKey}）`
    if (chainForm.id === target.id) cancelForm()
    await loadChains()
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '删除计算链路失败')
  } finally {
    busy.value = false
  }
}

// ---- 载入 ----

async function loadChains() {
  chains.value = await fetchDamageChains()
}

async function refreshAll() {
  loading.value = true
  error.value = ''
  try {
    await loadChains()
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '读取计算链路失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <section class="zone-section chain-section">
    <div class="section-head">
      <h3 class="section-title">计算链路</h3>
      <span class="section-tag">内置 {{ BUILT_IN_DAMAGE_CHAINS.length }} 条 · 数据库 {{ chains.length }} 条</span>
      <div class="head-actions">
        <button type="button" class="secondary-btn" :disabled="loading" @click="refreshAll">
          {{ loading ? '读取中…' : '刷新' }}
        </button>
        <button type="button" class="primary-btn" :disabled="busy" @click="startCreateChain()">
          新建链路
        </button>
      </div>
    </div>
    <p class="section-hint">
      链路决定一次结算有哪些阶段、按什么顺序、叫什么；阶段值仍由代码按阶段 id 计算，这里不改数值。
      同 <span class="mono">chainKey</span> 的数据库链路由弱到强覆盖内置链路（global → 职业 → 角色 → 技能组 → 招式，
      同作用域按 priority）；内置链路只读，可覆盖但不能删除（内置 chainKey 的覆盖也只能停用）。
      保存要求：至少一个伤害类型、每个阶段都有 module。
    </p>

    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-if="message" class="panel-hint">{{ message }}</p>

    <div class="chain-layout">
      <div class="item-list">
        <p class="list-group-title">内置链路（编辑后保存为覆盖）</p>
        <div
          v-for="chain in BUILT_IN_DAMAGE_CHAINS"
          :key="`builtin-${chain.id}`"
          class="config-row"
          :class="{ active: selectedRowKey === `builtin:${chain.id}` }"
          role="button"
          tabindex="0"
          @click="openBuiltin(chain.id)"
          @keydown.enter="openBuiltin(chain.id)"
        >
          <div class="config-main">
            <span class="config-name">{{ chain.label }}</span>
            <span class="config-meta">
              <span class="mono">{{ chain.id }}</span> · 全局 · {{ chain.stages.length }} 个阶段 ·
              {{ chain.appliesTo.damageKinds.join(' / ') || '全部伤害类型' }}
            </span>
          </div>
          <div class="config-actions">
            <span class="chip static active">内置</span>
          </div>
        </div>

        <p class="list-group-title">数据库链路</p>
        <p v-if="!chains.length" class="list-empty">
          还没有数据库链路。数据库为空时用户端走内置链路。
        </p>
        <div
          v-for="doc in chains"
          :key="`db-${doc.id}`"
          class="config-row"
          :class="{ active: selectedRowKey === `db:${doc.id}` }"
          role="button"
          tabindex="0"
          @click="openDoc(doc)"
          @keydown.enter="openDoc(doc)"
        >
          <div class="config-main">
            <span class="config-name">{{ doc.label }}</span>
            <span class="config-meta">
              <span class="mono">{{ doc.chainKey }}</span> ·
              {{ scopeLabel(doc.scope) }} · <span class="mono">{{ doc.targetId || '(全局)' }}</span>
              · 优先级 {{ doc.priority }} · {{ doc.stages.length }} 个阶段 · v{{ doc.version }}
            </span>
            <span class="config-meta">
              {{ doc.appliesTo.damageKinds.join(' / ') || '全部伤害类型' }}
            </span>
          </div>
          <div class="config-actions">
            <span class="chip static" :class="{ active: doc.enabled }">
              {{ doc.enabled ? '已启用' : '已停用' }}
            </span>
            <button
              type="button"
              class="danger-btn small"
              :disabled="busy || !isCustomDamageChainKey(doc.chainKey)"
              :title="
                isCustomDamageChainKey(doc.chainKey)
                  ? ''
                  : '内置链路的覆盖不能删除，请把 enabled 改成停用'
              "
              @click.stop="pendingDelete = doc"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <div v-if="formVisible" class="chain-editor">
        <div class="field-row three">
          <label class="field">
            <span class="field-label">chainKey</span>
            <input
              v-model="chainForm.chainKey"
              class="field-input mono"
              :disabled="chainForm.readonly || chainForm.id != null"
              list="chain-key-options"
              placeholder="direct / sharpen / pierce / anomaly / attributeAnomaly / custom:xxx"
            />
            <datalist id="chain-key-options">
              <option v-for="item in DAMAGE_CHAIN_KEY_OPTIONS" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </datalist>
          </label>
          <label class="field">
            <span class="field-label">链路名称</span>
            <input
              v-model="chainForm.label"
              class="field-input"
              :disabled="chainForm.readonly"
              placeholder="蕾米埃尔 · 本人耀变链路"
            />
          </label>
          <label class="field">
            <span class="field-label">作用域</span>
            <select v-model="chainForm.scope" class="field-input" :disabled="chainForm.readonly">
              <option v-for="scope in DAMAGE_CHAIN_SCOPES" :key="scope" :value="scope">
                {{ DAMAGE_CHAIN_SCOPE_LABELS[scope] }}（{{ scope }}）
              </option>
            </select>
          </label>
        </div>

        <div class="field-row three">
          <label class="field">
            <span class="field-label">target_id</span>
            <input
              v-model="chainForm.targetId"
              class="field-input mono"
              :disabled="chainForm.readonly || chainForm.scope === 'global'"
              :placeholder="targetPlaceholder"
              list="chain-target-options"
            />
            <datalist id="chain-target-options">
              <option v-for="item in targetOptions" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </datalist>
          </label>
          <label class="field">
            <span class="field-label">优先级（priority）</span>
            <input
              v-model="chainForm.priority"
              class="field-input"
              type="number"
              min="0"
              max="1000"
              step="1"
              :disabled="chainForm.readonly"
            />
          </label>
          <label class="field">
            <span class="field-label">状态</span>
            <span class="checkbox-item">
              <input v-model="chainForm.enabled" type="checkbox" :disabled="chainForm.readonly" />
              启用该链路
            </span>
          </label>
        </div>

        <div class="field">
          <span class="field-label">适用伤害类型（多选，至少选一个）</span>
          <div v-for="group in BUFF_DAMAGE_TYPE_GROUPS" :key="group.id" class="damage-group">
            <span class="damage-group-label">{{ group.label }}</span>
            <div class="checkbox-grid">
              <label v-for="type in group.types" :key="type.id" class="checkbox-item">
                <input
                  v-model="chainForm.damageKinds"
                  type="checkbox"
                  :value="type.id"
                  :disabled="chainForm.readonly"
                />
                {{ type.label }}
              </label>
            </div>
          </div>
        </div>

        <div class="stage-head">
          <span class="field-label">阶段（拖拽排序；点击格子编辑）</span>
          <div class="stage-head-actions" v-if="!chainForm.readonly">
            <button type="button" class="secondary-btn small" :disabled="busy" @click="loadBuiltinStages">
              重置为内置阶段
            </button>
            <button type="button" class="secondary-btn small" :disabled="busy" @click="addStage">
              新增阶段
            </button>
          </div>
        </div>

        <div class="chain-stage-grid">
          <div
            v-for="(row, index) in chainForm.stages"
            :key="row.key"
            class="chain-stage-cell"
            :class="[
              `chain-stage-cell--${row.kind}`,
              {
                'is-selected': selectedStageIndex === index,
                'is-disabled': !row.enabled || row.action === 'disable',
                'is-inherit': row.action === 'inherit',
              },
            ]"
            :draggable="!chainForm.readonly"
            role="button"
            tabindex="0"
            @click="selectStage(index)"
            @keydown.enter="selectStage(index)"
            @dragstart="onDragStart(index, $event)"
            @dragover="onDragOver"
            @drop="onDrop(index)"
          >
            <div class="cell-head">
              <span class="cell-kind">{{ STAGE_KIND_LABELS[row.kind] }}</span>
              <span class="cell-order">#{{ row.order }}</span>
            </div>
            <span class="cell-label">{{ row.label || row.id }}</span>
            <span class="cell-module mono">{{ row.module || '—' }}</span>
            <span class="cell-status">{{ stageStatusText(row) }}</span>
          </div>
          <p v-if="!chainForm.stages.length" class="list-empty">还没有阶段，点「新增阶段」开始。</p>
        </div>

        <form
          v-if="selectedStage"
          class="stage-editor"
          @submit.prevent="saveChain"
        >
          <div class="stage-editor-head">
            <strong>阶段编辑 · {{ selectedStage.id }}</strong>
            <div class="stage-head-actions" v-if="!chainForm.readonly">
              <button
                type="button"
                class="secondary-btn small"
                :disabled="busy || selectedStageIndex <= 0"
                @click="moveStage(selectedStageIndex, -1)"
              >
                上移
              </button>
              <button
                type="button"
                class="secondary-btn small"
                :disabled="busy || selectedStageIndex >= chainForm.stages.length - 1"
                @click="moveStage(selectedStageIndex, 1)"
              >
                下移
              </button>
              <button
                type="button"
                class="danger-btn small"
                :disabled="busy"
                @click="removeStage(selectedStageIndex)"
              >
                {{ selectedStage.base ? '禁用' : '删除' }}
              </button>
            </div>
          </div>

          <div class="field-row three">
            <label class="field">
              <span class="field-label">阶段 id</span>
              <input
                v-model="selectedStage.id"
                class="field-input mono"
                :disabled="chainForm.readonly"
              />
            </label>
            <label class="field">
              <span class="field-label">类型</span>
              <select v-model="selectedStage.kind" class="field-input" :disabled="chainForm.readonly">
                <option v-for="kind in STAGE_KINDS" :key="kind" :value="kind">
                  {{ STAGE_KIND_LABELS[kind] }}（{{ kind }}）
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">与内置阶段的关系</span>
              <select
                v-model="selectedStage.action"
                class="field-input"
                :disabled="chainForm.readonly"
              >
                <option v-for="action in CHAIN_WRITE_ACTIONS" :key="action.id" :value="action.id">
                  {{ action.label }}（{{ action.id }}）
                </option>
              </select>
            </label>
          </div>

          <div class="field-row three">
            <label class="field">
              <span class="field-label">展示名</span>
              <input
                v-model="selectedStage.label"
                class="field-input"
                :disabled="chainForm.readonly"
              />
            </label>
            <label class="field">
              <span class="field-label">分组</span>
              <input
                v-model="selectedStage.group"
                class="field-input mono"
                :disabled="chainForm.readonly"
              />
            </label>
            <label class="field">
              <span class="field-label">顺序（order）</span>
              <input
                v-model="selectedStage.order"
                class="field-input"
                type="number"
                step="10"
                :disabled="chainForm.readonly"
              />
            </label>
          </div>

          <div class="field-row three">
            <label class="field">
              <span class="field-label">模块（module）</span>
              <select v-model="selectedStage.module" class="field-input" :disabled="chainForm.readonly">
                <option v-for="item in stageModuleOptions" :key="item.id" :value="item.id">
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">依赖阶段（inputs，逗号分隔）</span>
              <input
                v-model="selectedStage.inputs"
                class="field-input mono"
                :disabled="chainForm.readonly"
                placeholder="dmg, defense, crit"
              />
            </label>
            <label class="field">
              <span class="field-label">启用</span>
              <span class="checkbox-item">
                <input
                  type="checkbox"
                  :checked="selectedStage.enabled && selectedStage.action !== 'disable'"
                  :disabled="chainForm.readonly"
                  @change="toggleStage(selectedStage)"
                />
                本次展示该阶段
              </span>
            </label>
          </div>

          <div class="field-row two">
            <label class="field">
              <span class="field-label">params（JSON 对象）</span>
              <textarea
                v-model="selectedStage.paramsText"
                class="field-textarea mono"
                rows="5"
                spellcheck="false"
                :disabled="chainForm.readonly"
              ></textarea>
              <span v-if="selectedStageParamsError" class="form-error">
                {{ selectedStageParamsError }}
              </span>
            </label>
            <label class="field">
              <span class="field-label">when（条件 JSON，可留空）</span>
              <textarea
                v-model="selectedStage.whenText"
                class="field-textarea mono"
                rows="5"
                spellcheck="false"
                :disabled="chainForm.readonly"
                placeholder='{ "skillName": { "op": "contains", "value": "明心境" } }'
              ></textarea>
              <span v-if="selectedStageWhenError" class="form-error">
                {{ selectedStageWhenError }}
              </span>
            </label>
          </div>

          <p class="field-hint">
            条件变量白名单与乘区方案一致（agentId / profession / skillId / damageKind / mindscapeRank …）；
            条件不成立的阶段在用户端不展示。后端只接受
            <span class="mono">id/kind/module/label/group/order/inputs/params/when/enabled</span>：
            禁用 = <span class="mono">enabled: false</span>，继承 = 只提交 id/kind/module/order
            （label 与参数沿用内置阶段）。
          </p>

          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="form-actions" v-if="!chainForm.readonly">
            <button type="submit" class="primary-btn" :disabled="busy">
              {{ busy ? '保存中…' : chainForm.id == null ? '新建链路' : '保存链路' }}
            </button>
            <button type="button" class="secondary-btn" :disabled="busy" @click="cancelForm">
              取消
            </button>
          </div>
          <div class="form-actions" v-else>
            <button type="button" class="primary-btn" :disabled="busy" @click="overrideBuiltin">
              以本链路新建覆盖
            </button>
            <button type="button" class="secondary-btn" @click="cancelForm">关闭</button>
          </div>
        </form>
        <div v-if="!chainForm.readonly" class="chain-preview">
          <div class="chain-preview-head">
            <strong>预览示例</strong>
            <select v-model="previewSampleId" class="field-input preview-sample-select">
              <option v-for="sample in DAMAGE_CHAIN_SAMPLE_HITS" :key="sample.id" :value="sample.id">
                {{ sample.label }}
              </option>
            </select>
            <button type="button" class="secondary-btn small" :disabled="busy" @click="runPreview">
              计算
            </button>
          </div>
          <p v-if="previewError" class="form-error">{{ previewError }}</p>
          <template v-if="previewResult">
            <div class="chain-preview-grid">
              <div v-for="stage in previewResult.stages" :key="`preview-${stage.id}`" class="preview-cell">
                <span class="preview-kind">{{ STAGE_KIND_LABELS[stage.kind] ?? stage.kind }}</span>
                <span class="preview-label">{{ stage.label }}</span>
                <span class="preview-value">{{ Number.isInteger(stage.value) ? stage.value.toLocaleString('en-US') : stage.value }}</span>
              </div>
            </div>
            <p class="field-hint">
              示例命中「{{ previewResult.sampleLabel }}」· 合成面板（攻击 3000 / 增伤 50% / 暴击 50%-100%），
              与线上真实面板无关。示例最终伤害
              {{ Math.round(previewResult.final).toLocaleString('en-US') }} · 内置链路
              {{ Math.round(previewResult.baselineFinal).toLocaleString('en-US') }} · 差异
              {{ previewResult.final === previewResult.baselineFinal
                ? '0'
                : `${(previewResult.final - previewResult.baselineFinal >= 0 ? '+' : '')}${(
                    ((previewResult.final - previewResult.baselineFinal) /
                      Math.max(1, previewResult.baselineFinal)) * 100
                  ).toFixed(2)}%` }}
            </p>
          </template>
        </div>
        <p v-else-if="chainForm.stages.length" class="field-hint">
          点击格子选择阶段后编辑模块、参数与条件。
        </p>
      </div>
      <p v-else class="pick-hint">选择左侧链路查看阶段格子，或点「新建链路」开始配置。</p>
    </div>

    <AdminConfirmDialog
      :visible="Boolean(pendingDelete)"
      title="删除计算链路"
      :message="`确认删除「${pendingDelete?.label ?? ''}」(${pendingDelete?.chainKey ?? ''})？删除后回到内置链路或上级覆盖。`"
      confirm-text="删除"
      danger
      @confirm="confirmDeleteChain"
      @cancel="pendingDelete = null"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，计算链路没法写进数据库。请重新登录管理员账号。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
.chain-section {
  gap: 0.65rem;
}

/* 区块标题/列表：与「乘区方案」面板同款（面板内的 scoped 样式不跨组件，这里补齐本区块用到的部分） */
.section-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.section-tag {
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text);
  opacity: 0.75;
}

.section-hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.72;
}

.head-actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
}

.panel-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--color-heading);
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.75rem;
  max-height: 720px;
  overflow-y: auto;
  min-height: 160px;
}

.list-empty {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--color-text);
  opacity: 0.7;
}

.config-row {
  display: flex;
  gap: 0.6rem;
  justify-content: space-between;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  cursor: pointer;
}

.config-row.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.1);
}

.config-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.config-name {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-heading);
}

.config-meta {
  font-size: 0.72rem;
  color: var(--color-text);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  padding: 0.15rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.chip.active {
  border-color: rgba(90, 170, 110, 0.6);
  background: rgba(80, 150, 100, 0.14);
  color: #8fd3a2;
}

.chip.static {
  cursor: default;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
}

.small {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.pick-hint {
  margin: 0;
  padding: 1.2rem;
  border: 1px dashed var(--color-border);
  border-radius: 12px;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.7;
}

.field-hint {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.65;
}

.field-row.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.damage-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.35rem;
}

.damage-group-label {
  font-size: 0.75rem;
  color: var(--color-text);
  opacity: 0.75;
}

.chain-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  gap: 1rem;
  align-items: start;
}

.list-group-title {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.8;
}

.chain-editor {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem;
}

.stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.stage-head-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

/* 阶段格子：外观与用户端 `FlowZoneCalculation.vue` 的乘区格一致 */
.chain-stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.4rem;
}

.chain-stage-cell {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--chain-cell-border, #2a3038);
  border-radius: 8px;
  background: var(--chain-cell-bg, #12161d);
  cursor: grab;
  min-width: 0;
}

.chain-stage-cell:hover {
  border-color: color-mix(in srgb, #c9a55c 65%, var(--color-border));
}

.chain-stage-cell.is-selected {
  border-color: #8fc9ee;
  box-shadow: 0 0 0 1px rgba(143, 201, 238, 0.4);
}

.chain-stage-cell.is-disabled {
  border-style: dashed;
  opacity: 0.55;
}

.chain-stage-cell.is-inherit {
  border-color: color-mix(in srgb, #6f9fd0 60%, var(--color-border));
}

.chain-stage-cell--final {
  border-color: color-mix(in srgb, #8fc9ee 50%, var(--color-border));
}

.cell-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.3rem;
}

.cell-kind {
  font-size: 0.62rem;
  color: var(--color-text);
  opacity: 0.62;
}

.cell-order {
  font-size: 0.62rem;
  color: var(--color-text);
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.cell-label {
  font-size: 0.7rem;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-module {
  font-size: 0.68rem;
  color: var(--color-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-status {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-accent, #8fc9ee);
  font-variant-numeric: tabular-nums;
}

.chain-stage-cell.is-disabled .cell-status {
  color: var(--color-text);
  opacity: 0.45;
}

:global([data-theme='light']) .chain-stage-cell {
  --chain-cell-border: rgba(60, 55, 40, 0.22);
  --chain-cell-bg: #faf8f2;
}

:global([data-theme='light']) .chain-stage-cell:hover {
  border-color: color-mix(in srgb, #b08a3e 55%, var(--color-border));
}

:global([data-theme='light']) .chain-stage-cell.is-selected {
  border-color: #3b7fa8;
  box-shadow: 0 0 0 1px rgba(59, 127, 168, 0.35);
}

.stage-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
}

.stage-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
  color: var(--color-heading);
}

.checkbox-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .chain-layout {
    grid-template-columns: 1fr;
  }

  .checkbox-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.chain-preview {
  margin-top: 0.6rem;
  padding: 0.7rem;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
}

.chain-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.preview-sample-select {
  flex: 1 1 auto;
  max-width: 14rem;
  min-width: 8rem;
}

.chain-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.35rem;
}

.preview-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-background-soft);
}

.preview-kind {
  font-size: 0.62rem;
  color: var(--color-text);
  opacity: 0.6;
}

.preview-label {
  font-size: 0.72rem;
  color: var(--color-heading);
}

.preview-value {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-accent, #8fc9ee);
  font-variant-numeric: tabular-nums;
}
</style>
