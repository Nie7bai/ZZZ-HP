<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import AdminDamageChainSection from '@/components/admin/calculator/AdminDamageChainSection.vue'
import {
  ZONE_PRIMITIVE_OPTIONS,
  ZONE_PROVIDER_OPTIONS,
  ZONE_SCHEME_SCOPES,
  ZONE_SCHEME_SCOPE_LABELS,
  deleteZoneDefinition,
  deleteZoneScheme,
  fetchZoneDefinitions,
  fetchZoneSchemes,
  isAdminZoneAuthError,
  isZoneInUseError,
  normalizeZoneSchemeRule,
  updateZoneScheme,
  upsertZoneDefinition,
  upsertZoneScheme,
  type ZoneDefinitionDoc,
  type ZoneDefinitionInput,
  type ZoneSchemeDoc,
  type ZoneSchemeInput,
  type ZoneSchemeReference,
  type ZoneSchemeRule,
  type ZoneSchemeScope,
} from '@/api/adminZones'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import { ZONE_DEFINITIONS } from '@/zones/catalog'
import { ZONE_GROUP_FORMULAS, getZoneFormulaNote } from '@/zones/formulaNotes'
import { BUFF_DAMAGE_TYPE_GROUPS } from '@/types/calculator'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 管理端 → 角色计算器 → 乘区方案（Phase 4b）。
 *
 * 三块：内置乘区（只读，来自 `src/zones/catalog.ts`）、乘区定义（DB）、乘区方案（DB）。
 * 内置乘区表带「计算公式」列：公式取自 `src/zones/formulaNotes.ts`，
 * 权威来源是仓库根目录的 `CALCULATOR_FORMULAS.md`，本面板只读展示。
 * 本面板不参与计算，只维护「有哪些乘区、按什么原语求值、在哪个作用域生效」。
 */

const router = useRouter()
const calculatorBuffStore = useCalculatorBuffStore()

const ZONE_GROUP_LABELS: Record<string, string> = {
  core: '核心',
  direct: '直伤',
  anomaly: '异常',
  radianceSelf: '耀变（本人）',
  special: '特殊',
  custom: '自定义',
}

const SAMPLE_RULES_TEXT = JSON.stringify(
  [
    {
      key: 'custom:eliteBonus',
      label: '对精英增伤区',
      action: 'replace',
      module: 'percentSum',
      params: {
        statKeys: ['eliteDmgBonus'],
        cap: null,
        floor: null,
        allowNegative: true,
        order: 900,
      },
      when: { monsterCategory: 'elite' },
    },
  ],
  null,
  2,
)

const definitions = ref<ZoneDefinitionDoc[]>([])
const schemes = ref<ZoneSchemeDoc[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const zoneInUseReferences = ref<ZoneSchemeReference[]>([])
const authDialogVisible = ref(false)

function handleAuthError(err: unknown): boolean {
  if (!isAdminZoneAuthError(err)) return false
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
  return ZONE_SCHEME_SCOPE_LABELS[value as ZoneSchemeScope] || value
}

function groupLabel(value: string): string {
  return ZONE_GROUP_LABELS[value] ?? value
}

// ---- 内置乘区（只读） ----

const builtinSearch = ref('')
const builtinGroup = ref('')

const builtinGroups = computed(() => [...new Set(ZONE_DEFINITIONS.map((zone) => zone.group))])

const builtinFiltered = computed(() => {
  const keyword = builtinSearch.value.trim().toLowerCase()
  return ZONE_DEFINITIONS.filter((zone) => {
    if (builtinGroup.value && zone.group !== builtinGroup.value) return false
    if (!keyword) return true
    const note = getZoneFormulaNote(zone.key)
    return (
      zone.key.toLowerCase().includes(keyword) ||
      zone.label.toLowerCase().includes(keyword) ||
      Boolean(note?.formula.toLowerCase().includes(keyword)) ||
      Boolean(note?.appliesWhen?.toLowerCase().includes(keyword))
    )
  })
})

/** 展开查看公式的乘区 key；同时只展开一条，避免表格过长 */
const expandedZoneKey = ref('')

function toggleZoneFormula(key: string) {
  expandedZoneKey.value = expandedZoneKey.value === key ? '' : key
}

function zoneFormula(key: string) {
  return getZoneFormulaNote(key)
}

function groupFormula(group: string) {
  return ZONE_GROUP_FORMULAS[group as keyof typeof ZONE_GROUP_FORMULAS] ?? null
}

function resetBuiltinFilter() {
  builtinSearch.value = ''
  builtinGroup.value = ''
  expandedZoneKey.value = ''
}

// ---- 通用：JSON 文本解析 ----

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface JsonParseResult {
  ok: boolean
  value?: unknown
  error: string
}

function parseJsonText(text: string): JsonParseResult {
  if (!text.trim()) return { ok: true, value: undefined, error: '' }
  try {
    return { ok: true, value: JSON.parse(text) as unknown, error: '' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'JSON 格式错误' }
  }
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** params / display：JSON 对象；空文本按 `{}` 处理 */
function parseObjectField(
  text: string,
  field: string,
): { value: Record<string, unknown>; error: string } {
  if (!text.trim()) return { value: {}, error: '' }
  const parsed = parseJsonText(text)
  if (!parsed.ok) return { value: {}, error: `${field} JSON 解析失败：${parsed.error}` }
  if (!isPlainRecord(parsed.value)) return { value: {}, error: `${field} 必须是 JSON 对象` }
  return { value: parsed.value, error: '' }
}

/** display：JSON 对象或 null */
function parseNullableObjectField(
  text: string,
  field: string,
): { value: Record<string, unknown> | null; error: string } {
  if (!text.trim() || text.trim() === 'null') return { value: null, error: '' }
  const parsed = parseJsonText(text)
  if (!parsed.ok) return { value: null, error: `${field} JSON 解析失败：${parsed.error}` }
  if (!isPlainRecord(parsed.value)) return { value: null, error: `${field} 必须是 JSON 对象或 null` }
  return { value: parsed.value, error: '' }
}

/** stats：JSON 数组或 null；逐条字段由后端校验 */
function parseNullableArrayField(
  text: string,
  field: string,
): { value: unknown[] | null; error: string } {
  if (!text.trim() || text.trim() === 'null') return { value: null, error: '' }
  const parsed = parseJsonText(text)
  if (!parsed.ok) return { value: null, error: `${field} JSON 解析失败：${parsed.error}` }
  if (!Array.isArray(parsed.value)) return { value: null, error: `${field} 必须是 JSON 数组或 null` }
  return { value: parsed.value, error: '' }
}

// ---- 乘区定义 ----

interface DefinitionFormState {
  zone_key: string
  label: string
  sort_order: string
  primitive: string
  damageKinds: string[]
  enabled: boolean
  paramsText: string
  statsText: string
  displayText: string
  /** 表单不编辑的维度：原样回传，避免被后端默认值冲掉 */
  agents: string[]
  skills: string[]
  providers: string
}

function emptyDefinitionForm(): DefinitionFormState {
  return {
    zone_key: 'custom:',
    label: '',
    sort_order: '100',
    primitive: 'percentSum',
    damageKinds: [],
    enabled: true,
    paramsText: prettyJson({ cap: null, floor: null, allowNegative: true, statKeys: [] }),
    statsText: 'null',
    displayText: prettyJson({ panel: 'none' }),
    agents: [],
    skills: [],
    providers: 'team',
  }
}

const definitionForm = reactive<DefinitionFormState>(emptyDefinitionForm())
/** providers 显示名（列表摘要用） */
function providerLabel(mode: string): string {
  return ZONE_PROVIDER_OPTIONS.find((item) => item.id === mode)?.label ?? mode
}
/** 非空 = 正在编辑已有定义（zone_key 是 upsert 主键，编辑时只读） */
const definitionEditingKey = ref('')
const definitionFormVisible = ref(false)
const definitionFormError = ref('')
const pendingDefinitionDelete = ref<ZoneDefinitionDoc | null>(null)

const definitionParamsParse = computed(() => parseObjectField(definitionForm.paramsText, 'params'))
const definitionStatsParse = computed(() => parseNullableArrayField(definitionForm.statsText, 'stats'))
const definitionDisplayParse = computed(() =>
  parseNullableObjectField(definitionForm.displayText, 'display'),
)

function startCreateDefinition() {
  Object.assign(definitionForm, emptyDefinitionForm())
  definitionEditingKey.value = ''
  definitionFormError.value = ''
  definitionFormVisible.value = true
}

function startEditDefinition(doc: ZoneDefinitionDoc) {
  Object.assign(definitionForm, {
    zone_key: doc.zone_key,
    label: doc.label,
    sort_order: String(doc.sort_order),
    primitive: doc.primitive,
    damageKinds: [...doc.applies_to.damageKinds],
    enabled: doc.enabled,
    paramsText: prettyJson(doc.params),
    statsText: doc.stats == null ? 'null' : prettyJson(doc.stats),
    displayText: doc.display == null ? 'null' : prettyJson(doc.display),
    agents: [...doc.applies_to.agents],
    skills: [...doc.applies_to.skills],
    providers: doc.providers,
  })
  definitionEditingKey.value = doc.zone_key
  definitionFormError.value = ''
  definitionFormVisible.value = true
}

function cancelDefinitionForm() {
  definitionFormVisible.value = false
  definitionEditingKey.value = ''
  definitionFormError.value = ''
}

function definitionToInput(
  doc: ZoneDefinitionDoc,
  overrides: Partial<ZoneDefinitionInput> = {},
): ZoneDefinitionInput {
  return {
    zone_key: doc.zone_key,
    label: doc.label,
    sort_order: doc.sort_order,
    applies_to: {
      damageKinds: [...doc.applies_to.damageKinds],
      agents: [...doc.applies_to.agents],
      skills: [...doc.applies_to.skills],
    },
    providers: doc.providers,
    primitive: doc.primitive,
    params: doc.params,
    stats: doc.stats,
    display: doc.display,
    enabled: doc.enabled,
    ...overrides,
  }
}

async function saveDefinition() {
  definitionFormError.value = ''
  const params = definitionParamsParse.value
  const stats = definitionStatsParse.value
  const display = definitionDisplayParse.value
  const parseErrors = [params.error, stats.error, display.error].filter(Boolean)
  if (parseErrors.length) {
    definitionFormError.value = parseErrors.join('；')
    return
  }
  const zoneKey = definitionForm.zone_key.trim()
  if (!zoneKey) {
    definitionFormError.value = 'zone_key 不能为空'
    return
  }
  const label = definitionForm.label.trim()
  if (!label) {
    definitionFormError.value = '名称不能为空'
    return
  }
  const sortOrder = Number(definitionForm.sort_order)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    definitionFormError.value = '顺序必须是 0–100000 的整数'
    return
  }

  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const saved = await upsertZoneDefinition({
      zone_key: zoneKey,
      label,
      sort_order: sortOrder,
      applies_to: {
        damageKinds: [...definitionForm.damageKinds],
        agents: [...definitionForm.agents],
        skills: [...definitionForm.skills],
      },
      providers: definitionForm.providers,
      primitive: definitionForm.primitive,
      params: params.value,
      stats: stats.value,
      display: display.value,
      enabled: definitionForm.enabled,
    })
    message.value = `已保存乘区定义「${saved.label}」（${saved.zone_key}，v${saved.version}）`
    await loadDefinitions()
    const refreshed = definitions.value.find((item) => item.zone_key === saved.zone_key)
    if (refreshed) startEditDefinition(refreshed)
    else cancelDefinitionForm()
  } catch (err) {
    if (!handleAuthError(err)) definitionFormError.value = errorText(err, '保存乘区定义失败')
  } finally {
    busy.value = false
  }
}

async function toggleDefinition(doc: ZoneDefinitionDoc) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const saved = await upsertZoneDefinition(definitionToInput(doc, { enabled: !doc.enabled }))
    message.value = `「${saved.label}」已${saved.enabled ? '启用' : '停用'}（v${saved.version}）`
    await loadDefinitions()
    const refreshed = definitions.value.find((item) => item.zone_key === saved.zone_key)
    if (refreshed && definitionEditingKey.value === saved.zone_key) startEditDefinition(refreshed)
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '更新乘区定义失败')
  } finally {
    busy.value = false
  }
}

async function confirmDeleteDefinition() {
  const target = pendingDefinitionDelete.value
  pendingDefinitionDelete.value = null
  if (!target) return
  busy.value = true
  error.value = ''
  message.value = ''
  zoneInUseReferences.value = []
  try {
    await deleteZoneDefinition(target.zone_key)
    message.value = `已删除乘区定义「${target.label}」（${target.zone_key}）`
    if (definitionEditingKey.value === target.zone_key) cancelDefinitionForm()
    await loadDefinitions()
  } catch (err) {
    if (handleAuthError(err)) return
    if (isZoneInUseError(err)) {
      zoneInUseReferences.value = err.references
      error.value = `${err.message}。请先解除引用，或把该乘区改为停用。`
      return
    }
    error.value = errorText(err, '删除乘区定义失败')
  } finally {
    busy.value = false
  }
}

// ---- 乘区方案 ----

interface SchemeFormState {
  id: number | null
  scope: ZoneSchemeScope
  target_id: string
  name: string
  priority: string
  enabled: boolean
  rulesText: string
}

function emptySchemeForm(rulesText: string = SAMPLE_RULES_TEXT): SchemeFormState {
  return {
    id: null,
    scope: 'global',
    target_id: '',
    name: '',
    priority: '10',
    enabled: true,
    rulesText,
  }
}

/** 未选中方案时 rules 为空数组，表单不会凭空带出示例条目 */
const schemeForm = reactive<SchemeFormState>(emptySchemeForm('[]'))
const schemeFormVisible = ref(false)
const schemeFormError = ref('')
const pendingSchemeDelete = ref<ZoneSchemeDoc | null>(null)

watch(
  () => schemeForm.scope,
  (scope) => {
    if (scope === 'global') schemeForm.target_id = ''
  },
)

/** 作用域 target_id 候选：角色 / 职业 / 技能组直接给已有 id，招式与其它维度手填 */
const targetOptions = computed<Array<{ id: string; label: string }>>(() => {
  switch (schemeForm.scope) {
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
  switch (schemeForm.scope) {
    case 'agent':
      return '角色 id，例如 yeshunguang'
    case 'profession':
      return '职业名，例如 强攻 / 异常'
    case 'skill_group':
      return '技能组 id（招式库 → 技能组）'
    case 'skill':
      return '招式 id（招式库 → 复制 id）'
    default:
      return 'global 作用域不需要 target_id'
  }
})

interface ParsedRules {
  rules: ZoneSchemeRule[]
  error: string
}

function parseRulesText(text: string): ParsedRules {
  const parsed = parseJsonText(text)
  if (!parsed.ok) return { rules: [], error: `rules JSON 解析失败：${parsed.error}` }
  if (!Array.isArray(parsed.value)) return { rules: [], error: 'rules 必须是 JSON 数组' }
  const rules: ZoneSchemeRule[] = []
  for (let index = 0; index < parsed.value.length; index += 1) {
    const rule = normalizeZoneSchemeRule(parsed.value[index])
    if (!rule) return { rules: [], error: `rules[${index}] 必须是对象且 key 不能为空` }
    rules.push(rule)
  }
  return { rules, error: '' }
}

const rulesParse = computed(() => parseRulesText(schemeForm.rulesText))

function startCreateScheme() {
  Object.assign(schemeForm, emptySchemeForm())
  schemeFormError.value = ''
  schemeFormVisible.value = true
}

function startEditScheme(doc: ZoneSchemeDoc) {
  Object.assign(schemeForm, {
    id: doc.id,
    scope: doc.scope,
    target_id: doc.target_id,
    name: doc.name,
    priority: String(doc.priority),
    enabled: doc.enabled,
    rulesText: prettyJson(doc.rules),
  })
  schemeFormError.value = ''
  schemeFormVisible.value = true
}

function cancelSchemeForm() {
  schemeFormVisible.value = false
  schemeFormError.value = ''
}

async function saveScheme() {
  schemeFormError.value = ''
  const parsedRules = rulesParse.value
  if (parsedRules.error) {
    schemeFormError.value = parsedRules.error
    return
  }
  const name = schemeForm.name.trim()
  if (!name) {
    schemeFormError.value = '方案名称不能为空'
    return
  }
  const priority = Number(schemeForm.priority)
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
    schemeFormError.value = 'priority 必须是 0–1000 的整数'
    return
  }
  const scope = schemeForm.scope
  const targetId = scope === 'global' ? '' : schemeForm.target_id.trim()
  if (scope !== 'global' && !targetId) {
    schemeFormError.value = `scope=${scope} 时必须填写 target_id`
    return
  }

  const input: ZoneSchemeInput = {
    scope,
    target_id: targetId,
    name,
    priority,
    enabled: schemeForm.enabled,
    rules: parsedRules.rules,
  }

  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const saved =
      schemeForm.id == null
        ? await upsertZoneScheme(input)
        : await updateZoneScheme(schemeForm.id, input)
    message.value = `已保存乘区方案「${saved.name}」（${scopeLabel(saved.scope)} · ${saved.target_id || '全局'}，v${saved.version}）`
    await loadSchemes()
    const refreshed = schemes.value.find((item) => item.id === saved.id)
    if (refreshed) startEditScheme(refreshed)
    else cancelSchemeForm()
  } catch (err) {
    if (!handleAuthError(err)) schemeFormError.value = errorText(err, '保存乘区方案失败')
  } finally {
    busy.value = false
  }
}

async function confirmDeleteScheme() {
  const target = pendingSchemeDelete.value
  pendingSchemeDelete.value = null
  if (!target) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await deleteZoneScheme(target.id)
    message.value = `已删除乘区方案「${target.name}」`
    if (schemeForm.id === target.id) cancelSchemeForm()
    await loadSchemes()
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '删除乘区方案失败')
  } finally {
    busy.value = false
  }
}

// ---- 载入 ----

async function loadDefinitions() {
  definitions.value = await fetchZoneDefinitions()
}

async function loadSchemes() {
  schemes.value = await fetchZoneSchemes()
}

async function refreshAll() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([loadDefinitions(), loadSchemes()])
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '读取乘区配置失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <section class="editor-panel zone-panel">
    <header class="panel-header">
      <h2 class="panel-title">乘区方案</h2>
      <p class="panel-desc">
        内置乘区随代码发版；乘区定义与乘区方案存数据库，决定「有哪些乘区、按什么原语求值、在哪个作用域生效」。
        这里只配置组合，算法仍是代码里的白名单原语。
        每个乘区的计算公式可在下方「内置乘区」表展开查看，权威来源是仓库根目录的
        <span class="mono">CALCULATOR_FORMULAS.md</span>。
      </p>
    </header>

    <p v-if="loading && !definitions.length && !schemes.length" class="panel-hint">
      正在读取乘区配置…
    </p>
    <p v-if="error" class="form-error">{{ error }}</p>
    <ul v-if="zoneInUseReferences.length" class="reference-list">
      <li v-for="item in zoneInUseReferences" :key="item.id">
        被引用：{{ scopeLabel(item.scope) }} · {{ item.target_id || '(全局)' }} ·
        「{{ item.name }}」(id={{ item.id }})
      </li>
    </ul>
    <p v-if="message" class="panel-hint">{{ message }}</p>

    <section class="zone-section">
      <div class="section-head">
        <h3 class="section-title">内置乘区（只读）</h3>
        <span class="section-tag">
          {{ builtinFiltered.length }} / {{ ZONE_DEFINITIONS.length }} 条
        </span>
      </div>
      <p class="section-hint">
        随代码发版更新，不可在此编辑。要调整顺序或组合，请在下方「乘区方案」里引用它们。
      </p>
      <div class="toolbar">
        <input
          v-model="builtinSearch"
          class="field-input"
          type="search"
          placeholder="搜索名称 / key / 公式 / 专属条件"
        />
        <select v-model="builtinGroup" class="field-input">
          <option value="">全部分组</option>
          <option v-for="group in builtinGroups" :key="group" :value="group">
            {{ groupLabel(group) }}
          </option>
        </select>
        <button
          type="button"
          class="secondary-btn"
          :disabled="!builtinSearch && !builtinGroup"
          @click="resetBuiltinFilter"
        >
          清除筛选
        </button>
      </div>
      <div class="table-scroll">
        <table class="zone-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>key</th>
              <th>分组</th>
              <th class="num">顺序</th>
              <th>计算公式</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="zone in builtinFiltered" :key="zone.key">
              <tr
                class="zone-formula-row"
                :class="{ expanded: expandedZoneKey === zone.key }"
                @click="toggleZoneFormula(zone.key)"
              >
                <td>
                  {{ zone.label }}
                  <span v-if="zone.damageValue" class="cell-tag">数值</span>
                  <span v-if="zoneFormula(zone.key)?.appliesWhen" class="cell-tag">专属</span>
                </td>
                <td class="mono">{{ zone.key }}</td>
                <td>{{ groupLabel(zone.group) }}</td>
                <td class="num">{{ zone.order }}</td>
                <td class="zone-formula-cell">
                  <template v-if="zoneFormula(zone.key)">
                    <span class="mono zone-formula-brief">{{ zoneFormula(zone.key)!.formula.split('\n')[0] }}</span>
                    <span class="zone-formula-toggle">
                      {{ expandedZoneKey === zone.key ? '收起' : '展开' }}
                    </span>
                  </template>
                  <span v-else class="zone-formula-missing">暂无公式说明</span>
                </td>
              </tr>
              <tr v-if="expandedZoneKey === zone.key && zoneFormula(zone.key)" class="zone-formula-detail-row">
                <td colspan="5">
                  <div class="zone-formula-detail">
                    <pre class="zone-formula-block mono">{{ zoneFormula(zone.key)!.formula }}</pre>
                    <p v-if="zoneFormula(zone.key)!.appliesWhen" class="zone-formula-meta">
                      <strong>适用条件：</strong>{{ zoneFormula(zone.key)!.appliesWhen }}
                    </p>
                    <p v-if="zoneFormula(zone.key)!.note" class="zone-formula-meta">
                      <strong>说明：</strong>{{ zoneFormula(zone.key)!.note }}
                    </p>
                    <p v-if="zoneFormula(zone.key)!.docSection" class="zone-formula-meta mono">
                      对照 CALCULATOR_FORMULAS.md {{ zoneFormula(zone.key)!.docSection }}
                    </p>
                    <p v-if="zone.field" class="zone-formula-meta mono">
                      结果字段：{{ zone.field }}
                    </p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="!builtinFiltered.length" class="section-hint">没有匹配的内置乘区。</p>
    </section>

    <section class="zone-section">
      <div class="section-head">
        <h3 class="section-title">分组公式总览</h3>
        <span class="section-tag">{{ builtinGroups.length }} 组</span>
      </div>
      <p class="section-hint">
        每条链路把乘区连乘成最终伤害；这里给出各组的总式，含角色专属结算。
      </p>
      <div
        v-for="group in builtinGroups"
        :key="`group-formula-${group}`"
        class="group-formula-card"
      >
        <header class="group-formula-head">
          <strong>{{ groupLabel(group) }}</strong>
          <span v-if="groupFormula(group)?.docSection" class="mono group-formula-doc">
            {{ groupFormula(group)!.docSection }}
          </span>
        </header>
        <template v-if="groupFormula(group)">
          <pre class="zone-formula-block mono">{{ groupFormula(group)!.formula }}</pre>
          <p v-if="groupFormula(group)!.appliesWhen" class="zone-formula-meta">
            <strong>适用条件：</strong>{{ groupFormula(group)!.appliesWhen }}
          </p>
          <p v-if="groupFormula(group)!.note" class="zone-formula-meta">
            <strong>说明：</strong>{{ groupFormula(group)!.note }}
          </p>
        </template>
        <p v-else class="zone-formula-missing">该分组暂无总式说明。</p>
      </div>
    </section>

    <section class="zone-section">
      <div class="section-head">
        <h3 class="section-title">乘区定义（数据库）</h3>
        <span class="section-tag">{{ definitions.length }} 条</span>
        <div class="head-actions">
          <button type="button" class="secondary-btn" :disabled="loading" @click="refreshAll">
            {{ loading ? '读取中…' : '刷新' }}
          </button>
          <button type="button" class="primary-btn" :disabled="busy" @click="startCreateDefinition">
            新建定义
          </button>
        </div>
      </div>
      <p class="section-hint">
        <span class="mono">zone_key</span> 是保存主键：内置键（如
        <span class="mono">stagger</span>）或自定义键（如
        <span class="mono">custom:eliteBonus</span>）。`applies_to` 里表单未编辑的角色 / 招式维度会原样回传。
      </p>

      <div class="split">
        <div class="item-list">
          <p v-if="!definitions.length" class="list-empty">
            还没有乘区定义。内置 40 条乘区不需要在这里登记，只有管理员新增的乘区才落库。
          </p>
          <div
            v-for="doc in definitions"
            :key="doc.zone_key"
            class="config-row"
            :class="{ active: definitionEditingKey === doc.zone_key }"
          >
            <div class="config-main">
              <span class="config-name">{{ doc.label }}</span>
              <span class="config-meta mono">{{ doc.zone_key }}</span>
              <span class="config-meta">
                {{ doc.primitive }} · 顺序 {{ doc.sort_order }} · v{{ doc.version }}
                · {{ providerLabel(doc.providers) }}
                <template v-if="doc.applies_to.damageKinds.length">
                  · 伤害类型 {{ doc.applies_to.damageKinds.length }} 项
                </template>
              </span>
            </div>
            <div class="config-actions">
              <button
                type="button"
                class="chip"
                :class="{ active: doc.enabled }"
                :disabled="busy"
                @click="toggleDefinition(doc)"
              >
                {{ doc.enabled ? '已启用' : '已停用' }}
              </button>
              <button
                type="button"
                class="secondary-btn small"
                :disabled="busy"
                @click="startEditDefinition(doc)"
              >
                编辑
              </button>
              <button
                type="button"
                class="danger-btn small"
                :disabled="busy"
                @click="pendingDefinitionDelete = doc"
              >
                删除
              </button>
            </div>
          </div>
        </div>

        <form v-if="definitionFormVisible" class="editor-form" @submit.prevent="saveDefinition">
          <div class="field-row two">
            <label class="field">
              <span class="field-label">zone_key</span>
              <input
                v-model="definitionForm.zone_key"
                class="field-input mono"
                :disabled="Boolean(definitionEditingKey)"
                placeholder="custom:eliteBonus"
              />
              <span v-if="definitionEditingKey" class="field-hint">
                主键不可改；要换 key 请新建一条再删除旧的。
              </span>
            </label>
            <label class="field">
              <span class="field-label">名称</span>
              <input v-model="definitionForm.label" class="field-input" placeholder="对精英增伤区" />
            </label>
          </div>

          <div class="field-row three">
            <label class="field">
              <span class="field-label">顺序（sort_order）</span>
              <input v-model="definitionForm.sort_order" class="field-input" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span class="field-label">求值原语</span>
              <select v-model="definitionForm.primitive" class="field-input">
                <option v-for="item in ZONE_PRIMITIVE_OPTIONS" :key="item.id" :value="item.id">
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">状态</span>
              <span class="checkbox-item">
                <input v-model="definitionForm.enabled" type="checkbox" />
                启用该定义
              </span>
            </label>
          </div>

          <label class="field">
            <span class="field-label">提供者范围（providers）</span>
            <select v-model="definitionForm.providers" class="field-input">
              <option v-for="item in ZONE_PROVIDER_OPTIONS" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </select>
            <span class="field-hint">
              percentSum 自定义乘区按此范围取加成来源；「仅乘区所有者」只算命中所有者自己的来源。
            </span>
          </label>

          <div class="field">
            <span class="field-label">适用伤害类型（多选；都不选 = 全部）</span>
            <div v-for="group in BUFF_DAMAGE_TYPE_GROUPS" :key="group.id" class="damage-group">
              <span class="damage-group-label">{{ group.label }}</span>
              <div class="checkbox-grid">
                <label v-for="type in group.types" :key="type.id" class="checkbox-item">
                  <input
                    v-model="definitionForm.damageKinds"
                    type="checkbox"
                    :value="type.id"
                  />
                  {{ type.label }}
                </label>
              </div>
            </div>
          </div>

          <label class="field">
            <span class="field-label">params（JSON 对象）</span>
            <textarea
              v-model="definitionForm.paramsText"
              class="field-textarea mono"
              rows="6"
              spellcheck="false"
            ></textarea>
            <span v-if="definitionParamsParse.error" class="form-error">
              {{ definitionParamsParse.error }}
            </span>
          </label>

          <label class="field">
            <span class="field-label">stats（增益键数组，JSON；可填 null）</span>
            <textarea
              v-model="definitionForm.statsText"
              class="field-textarea mono"
              rows="5"
              spellcheck="false"
            ></textarea>
            <span v-if="definitionStatsParse.error" class="form-error">
              {{ definitionStatsParse.error }}
            </span>
            <span class="field-hint">
              每条：key / label / valueType(percent|flat|multiplier) / sign(increase|decrease|both)，
              可选 appliesToPanel、supportsConvert、supportsFactor。
            </span>
          </label>

          <label class="field">
            <span class="field-label">display（展示配置，JSON；可填 null）</span>
            <textarea
              v-model="definitionForm.displayText"
              class="field-textarea mono"
              rows="3"
              spellcheck="false"
            ></textarea>
            <span v-if="definitionDisplayParse.error" class="form-error">
              {{ definitionDisplayParse.error }}
            </span>
            <span class="field-hint">panel 可选 none / inCombat / outOfCombat / both。</span>
          </label>

          <p v-if="definitionFormError" class="form-error">{{ definitionFormError }}</p>
          <div class="form-actions">
            <button type="submit" class="primary-btn" :disabled="busy">
              {{ busy ? '保存中…' : '保存定义' }}
            </button>
            <button type="button" class="secondary-btn" :disabled="busy" @click="cancelDefinitionForm">
              取消
            </button>
          </div>
        </form>
        <p v-else class="pick-hint">选择左侧「编辑」，或点「新建定义」开始配置。</p>
      </div>
    </section>

    <section class="zone-section">
      <div class="section-head">
        <h3 class="section-title">乘区方案（数据库）</h3>
        <span class="section-tag">{{ schemes.length }} 条</span>
        <div class="head-actions">
          <button type="button" class="primary-btn" :disabled="busy" @click="startCreateScheme">
            新建方案
          </button>
        </div>
      </div>
      <p class="section-hint">
        作用域越具体越优先（global → 职业 → 角色 → 技能组 → 招式），同一
        <span class="mono">scope + target_id</span>
        只能有一条方案。条目写法：
        <span class="mono">key / label / action(inherit|replace|disable) / module / params / when</span>；
        带 module 或 params 时 action 必须是 replace。
      </p>

      <div class="split">
        <div class="item-list">
          <p v-if="!schemes.length" class="list-empty">还没有乘区方案。数据库为空时计算走代码内置方案。</p>
          <div
            v-for="doc in schemes"
            :key="doc.id"
            class="config-row"
            :class="{ active: schemeForm.id === doc.id }"
          >
            <div class="config-main">
              <span class="config-name">{{ doc.name }}</span>
              <span class="config-meta">
                {{ scopeLabel(doc.scope) }} ·
                <span class="mono">{{ doc.target_id || '(全局)' }}</span>
                · 优先级 {{ doc.priority }} · v{{ doc.version }} · {{ doc.rules.length }} 条规则
              </span>
            </div>
            <div class="config-actions">
              <span class="chip" :class="{ active: doc.enabled, static: true }">
                {{ doc.enabled ? '已启用' : '已停用' }}
              </span>
              <button
                type="button"
                class="secondary-btn small"
                :disabled="busy"
                @click="startEditScheme(doc)"
              >
                编辑
              </button>
              <button
                type="button"
                class="danger-btn small"
                :disabled="busy"
                @click="pendingSchemeDelete = doc"
              >
                删除
              </button>
            </div>
          </div>
        </div>

        <form v-if="schemeFormVisible" class="editor-form" @submit.prevent="saveScheme">
          <div class="field-row three">
            <label class="field">
              <span class="field-label">作用域</span>
              <select v-model="schemeForm.scope" class="field-input">
                <option v-for="scope in ZONE_SCHEME_SCOPES" :key="scope" :value="scope">
                  {{ ZONE_SCHEME_SCOPE_LABELS[scope] }}（{{ scope }}）
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">target_id</span>
              <input
                v-model="schemeForm.target_id"
                class="field-input mono"
                :disabled="schemeForm.scope === 'global'"
                :placeholder="targetPlaceholder"
                list="zone-target-options"
              />
              <datalist id="zone-target-options">
                <option v-for="item in targetOptions" :key="item.id" :value="item.id">
                  {{ item.label }}
                </option>
              </datalist>
            </label>
            <label class="field">
              <span class="field-label">方案名称</span>
              <input v-model="schemeForm.name" class="field-input" placeholder="叶瞬光 · 帷幕易伤" />
            </label>
          </div>

          <div class="field-row three">
            <label class="field">
              <span class="field-label">优先级（priority）</span>
              <input v-model="schemeForm.priority" class="field-input" type="number" min="0" max="1000" step="1" />
            </label>
            <label class="field">
              <span class="field-label">状态</span>
              <span class="checkbox-item">
                <input v-model="schemeForm.enabled" type="checkbox" />
                启用该方案
              </span>
            </label>
            <span class="field-hint">
              同作用域内 priority 大的后应用（覆盖小的）。
            </span>
          </div>

          <label class="field">
            <span class="field-label">rules（JSON 数组，每条一个乘区条目）</span>
            <textarea
              v-model="schemeForm.rulesText"
              class="field-textarea mono rules-textarea"
              rows="14"
              spellcheck="false"
            ></textarea>
            <span v-if="rulesParse.error" class="form-error">{{ rulesParse.error }}</span>
            <span class="field-hint">
              保存前会解析校验；scope + target_id 已存在的方案会被整份覆盖（版本由服务端递增）。
            </span>
          </label>

          <p v-if="schemeFormError" class="form-error">{{ schemeFormError }}</p>
          <div class="form-actions">
            <button type="submit" class="primary-btn" :disabled="busy">
              {{ busy ? '保存中…' : '保存方案' }}
            </button>
            <button type="button" class="secondary-btn" :disabled="busy" @click="cancelSchemeForm">
              取消
            </button>
          </div>
        </form>
        <p v-else class="pick-hint">选择左侧「编辑」，或点「新建方案」开始配置。</p>
      </div>
    </section>

    <AdminDamageChainSection />

    <AdminConfirmDialog
      :visible="Boolean(pendingDefinitionDelete)"
      title="删除乘区定义"
      :message="`确认删除「${pendingDefinitionDelete?.label ?? ''}」(${pendingDefinitionDelete?.zone_key ?? ''})？仍被方案引用时后端会拒绝删除，可改为停用。`"
      confirm-text="删除"
      danger
      @confirm="confirmDeleteDefinition"
      @cancel="pendingDefinitionDelete = null"
    />
    <AdminConfirmDialog
      :visible="Boolean(pendingSchemeDelete)"
      title="删除乘区方案"
      :message="`确认删除「${pendingSchemeDelete?.name ?? ''}」？删除后该作用域回到上级方案或代码内置方案。`"
      confirm-text="删除"
      danger
      @confirm="confirmDeleteScheme"
      @cancel="pendingSchemeDelete = null"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，乘区配置没法写进数据库。请重新登录管理员账号。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
.zone-panel {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.zone-section {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

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

.head-actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
}

.section-hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.72;
}

.toolbar {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar .field-input {
  width: auto;
  min-width: 12rem;
}

.table-scroll {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: auto;
  max-height: 340px;
  background: var(--color-background-soft);
}

.zone-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.zone-table th,
.zone-table td {
  padding: 0.4rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.zone-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-weight: 600;
}

.zone-table tbody tr:last-child td {
  border-bottom: none;
}

.zone-table td.num,
.zone-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
}

.cell-tag {
  margin-left: 0.35rem;
  padding: 0 0.35rem;
  border-radius: 4px;
  background: color-mix(in srgb, #e8a838 18%, transparent);
  color: var(--color-text);
  font-size: 0.68rem;
}

/* ---- 内置乘区公式 ---- */

.zone-formula-row {
  cursor: pointer;
}

.zone-formula-row:hover td {
  background: color-mix(in srgb, var(--color-background-mute) 60%, transparent);
}

.zone-formula-row.expanded td {
  background: color-mix(in srgb, var(--color-background-mute) 80%, transparent);
}

.zone-formula-cell {
  white-space: normal;
  max-width: 26rem;
}

.zone-formula-brief {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 22rem;
  vertical-align: bottom;
  opacity: 0.85;
}

.zone-formula-toggle {
  margin-left: 0.5rem;
  font-size: 0.7rem;
  color: var(--color-heading);
  opacity: 0.8;
  text-decoration: underline;
}

.zone-formula-missing {
  opacity: 0.6;
  font-size: 0.75rem;
}

.zone-formula-detail-row td {
  padding: 0.2rem 0.6rem 0.7rem;
  white-space: normal;
  background: color-mix(in srgb, var(--color-background-mute) 55%, transparent);
}

.zone-formula-detail {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.zone-formula-block {
  margin: 0;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  overflow-x: auto;
  white-space: pre;
  line-height: 1.5;
}

.zone-formula-meta {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text);
}

.group-formula-card {
  margin-top: 0.7rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.group-formula-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.group-formula-doc {
  opacity: 0.65;
}

@media (max-width: 900px) {
  .zone-formula-cell {
    max-width: 14rem;
  }
  .zone-formula-brief {
    max-width: 10rem;
  }
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 1rem;
  align-items: start;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.75rem;
  max-height: 640px;
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

.chip:disabled {
  opacity: 0.5;
  cursor: default;
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

.checkbox-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.rules-textarea {
  min-height: 14rem;
}

.reference-list {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--color-heading);
}

@media (max-width: 1100px) {
  .split {
    grid-template-columns: 1fr;
  }

  .checkbox-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
