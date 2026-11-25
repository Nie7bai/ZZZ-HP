<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DAMAGE_CHAIN_SCOPES,
  DAMAGE_CHAIN_SCOPE_LABELS,
  fetchDamageChains,
  isAdminDamageChainAuthError,
  type DamageChainDoc,
  type DamageChainScope,
} from '@/api/adminDamageChains'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import {
  BUILT_IN_DAMAGE_CHAINS,
  STAGE_KIND_LABELS,
  getDamageChain,
  resolveDamageChain,
  resolveDamageChainId,
  type DamageChainDefinition,
  type StageDefinition,
} from '@/zones/pipeline'
import { adaptDamageChain } from '@/zones/chainAdapter'
import { getMergedDamageChains, resolveCurrentDamageChain } from '@/zones/chainSource'
import { resolveBaseDamageSourceForProfession } from '@/utils/damageCalc'
import type { ZoneScope } from '@/zones/scheme'
import { DAMAGE_CHAIN_SAMPLE_HITS, previewDamageChain, type DamageChainPreview } from '@/zones/preview'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 管理端 → 角色计算器 → 计算链路（只读展示）。
 *
 * 列出全部链路（代码内置 + 数据库里的作用域覆盖），选中一条查看它的乘区顺序；
 * 不提供新建 / 编辑 / 删除 / 排序等写操作 —— 链路内容由代码与数据库维护，
 * 本面板只回答「这条链路有哪些乘区、按什么顺序」。
 *
 * 作用域筛选（二级多选）：先选作用域层级（全局 / 职业 / 角色 / 技能组 / 招式，可多选），
 * 选了「角色」或「招式」后出现第二级目标多选（角色 / 招式 id），用于只看对特定角色
 * 或特定角色招式生效的链路；「全局」没有后续层级。
 */

const router = useRouter()
const calculatorBuffStore = useCalculatorBuffStore()

const chains = ref<DamageChainDoc[]>([])
const loading = ref(false)
const error = ref('')
const authDialogVisible = ref(false)

/** 选中行：`builtin:<id>` / `db:<id>` */
const selectedRowKey = ref('')

const previewResult = ref<DamageChainPreview | null>(null)
const previewError = ref('')
const previewSampleId = ref(DAMAGE_CHAIN_SAMPLE_HITS[0]!.id)

// ---- 作用域筛选（一级：层级多选；二级：目标多选） ----

const scopeFilter = ref<DamageChainScope[]>([])
const agentFilter = ref<string[]>([])
const skillFilter = ref<string[]>([])

const scopeOptions = computed(() =>
  DAMAGE_CHAIN_SCOPES.map((scope) => ({
    id: scope,
    label: DAMAGE_CHAIN_SCOPE_LABELS[scope],
  })),
)

function toggleScopeFilter(scope: DamageChainScope) {
  const index = scopeFilter.value.indexOf(scope)
  if (index >= 0) scopeFilter.value.splice(index, 1)
  else scopeFilter.value.push(scope)
  // 换层级时清掉二级选择，避免残留不属于当前层级的目标
  agentFilter.value = []
  skillFilter.value = []
}

function toggleAgentFilter(agentId: string) {
  const index = agentFilter.value.indexOf(agentId)
  if (index >= 0) agentFilter.value.splice(index, 1)
  else agentFilter.value.push(agentId)
}

function toggleSkillFilter(skillId: string) {
  const index = skillFilter.value.indexOf(skillId)
  if (index >= 0) skillFilter.value.splice(index, 1)
  else skillFilter.value.push(skillId)
}

/** 二级候选：选了「角色」列角色；选了「招式」列该角色（或全部）招式 */
const filterAgentOptions = computed(() => calculatorBuffStore.agents)

const filterSkillOptions = computed(() => {
  const skills = calculatorBuffStore.skills
  if (agentFilter.value.length) return skills.filter((skill) => agentFilter.value.includes(skill.agentId))
  return skills
})

/** 是否出现二级筛选：角色 / 技能组 / 招式都要挑具体目标（职业候选来自角色职业去重） */
const needsAgentTargets = computed(() => scopeFilter.value.includes('agent'))
const needsSkillTargets = computed(() => scopeFilter.value.includes('skill'))

function resetScopeFilter() {
  scopeFilter.value = []
  agentFilter.value = []
  skillFilter.value = []
}

const scopeFilterActive = computed(() => scopeFilter.value.length > 0)

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

/** 后端 scope 枚举（`skill_group`）→ 前端 ZoneScope（`skillGroup`） */
function toZoneScope(value: string): ZoneScope {
  return value === 'skill_group' ? 'skillGroup' : (value as ZoneScope)
}

// ---- 列表：内置链路 + 数据库覆盖 ----

interface ChainRow {
  key: string
  origin: 'builtin' | 'db'
  chainKey: string
  label: string
  scope: ZoneScope
  targetId: string
  priority: number
  enabled: boolean
  damageKinds: string[]
  /** 该链路解析后的生效阶段（内置链路就是内置定义，覆盖走合并规则） */
  stages: readonly StageDefinition[]
  /** 数据库覆盖行的元信息（内置行为空） */
  doc?: DamageChainDoc
  /** 是否有数据库覆盖（内置链路被覆盖时提示） */
  overridden: boolean
}

function resolveStagesFor(doc: DamageChainDoc | undefined, chainKey: string): readonly StageDefinition[] {
  const builtin = BUILT_IN_DAMAGE_CHAINS.find((chain) => chain.id === chainKey)
  const extra: DamageChainDefinition[] = []
  if (doc) {
    const definition = adaptDamageChain(doc)
    if (definition) {
      extra.push({ ...definition, scope: 'global', targetId: '', enabled: true })
    }
  }
  const resolved = resolveDamageChain(chainKey, {}, builtin ? [builtin, ...extra] : extra)
  return resolved.stages
}

const chainRows = computed<ChainRow[]>(() => {
  const rows: ChainRow[] = []
  const dbByKey = new Map<string, DamageChainDoc[]>()
  for (const doc of chains.value) {
    const list = dbByKey.get(doc.chainKey) ?? []
    list.push(doc)
    dbByKey.set(doc.chainKey, list)
  }

  for (const builtin of BUILT_IN_DAMAGE_CHAINS) {
    const overrides = dbByKey.get(builtin.id) ?? []
    rows.push({
      key: `builtin:${builtin.id}`,
      origin: 'builtin',
      chainKey: builtin.id,
      label: builtin.label,
      scope: builtin.scope ?? 'global',
      targetId: builtin.targetId ?? '',
      priority: builtin.priority ?? 0,
      enabled: true,
      damageKinds: [...builtin.appliesTo.damageKinds],
      stages: builtin.stages,
      overridden: overrides.length > 0,
    })
  }

  for (const doc of chains.value) {
    rows.push({
      key: `db:${doc.id}`,
      origin: 'db',
      chainKey: doc.chainKey,
      label: doc.label || doc.chainKey,
      scope: toZoneScope(doc.scope),
      targetId: doc.targetId,
      priority: doc.priority,
      enabled: doc.enabled,
      damageKinds: doc.appliesTo.damageKinds,
      stages: resolveStagesFor(doc, doc.chainKey),
      doc,
      overridden: false,
    })
  }

  return rows
})

const selectedRow = computed<ChainRow | null>(
  () => chainRows.value.find((row) => row.key === selectedRowKey.value) ?? null,
)

/**
 * 作用域筛选：一级选层级（多选），二级按层级挑具体目标（角色 / 招式，多选）。
 * 未选任何层级 = 全部显示；选了层级后只显示命中任一（层级 + 目标）组合的链路。
 * 选了「角色」但二级为空 → 显示该层级全部（所有角色）；「招式」同理。
 */
const filteredChainRows = computed<ChainRow[]>(() => {
  if (!scopeFilterActive.value) return chainRows.value
  const pickedAgents = agentFilter.value
  const pickedSkills = skillFilter.value
  return chainRows.value.filter((row) => {
    if (scopeFilter.value.includes('global') && row.scope === 'global') return true
    if (scopeFilter.value.includes('profession') && row.scope === 'profession') return true
    if (scopeFilter.value.includes('agent') && row.scope === 'agent') {
      if (!pickedAgents.length) return true
      if (pickedAgents.includes(row.targetId)) return true
    }
    if (scopeFilter.value.includes('skill_group') && row.scope === 'skillGroup') return true
    if (scopeFilter.value.includes('skill') && row.scope === 'skill') {
      if (!pickedSkills.length) return true
      if (pickedSkills.includes(row.targetId)) return true
    }
    return false
  })
})

function selectRow(row: ChainRow) {
  selectedRowKey.value = row.key
  previewResult.value = null
  previewError.value = ''
}

/** 阶段条件摘要：只读展示，用来提示「这个阶段什么时候生效」 */
function formatWhen(stage: StageDefinition): string {
  if (stage.when === undefined) return ''
  try {
    return JSON.stringify(stage.when)
  } catch {
    return String(stage.when)
  }
}

/** 阶段参数摘要：只读展示（cap / floor / statKeys 等） */
function formatParams(stage: StageDefinition): string {
  if (!stage.params || !Object.keys(stage.params).length) return ''
  try {
    return JSON.stringify(stage.params)
  } catch {
    return String(stage.params)
  }
}

// ---- 链路一致性核查：全角色 × 全招式，列出链路解析结果与常规链路不一致的条目 ----

interface ChainAuditRow {
  agentId: string
  agentName: string
  profession: string
  skillId: string
  skillName: string
  damageType: string
  /** 命中上下文解析出的链路 id（含数据库覆盖优先） */
  resolvedChainId: string
  /** 不考虑数据库覆盖时按伤害类型 / 职业推导的常规链路 id */
  expectedChainId: string
  /** 常规链路的乘区顺序（expectedChainId 对应的内置阶段） */
  expectedStages: readonly StageDefinition[]
  /** 实际生效链路的乘区顺序（resolvedChainId 对应的内置 / 覆盖阶段） */
  resolvedStages: readonly StageDefinition[]
  /** 乘区阶段序列（id + 顺序）与常规链路不一致 */
  stageMismatch: boolean
  /** 链路 id 本身与常规推导不一致（角色专属 / 招式专属覆盖） */
  chainMismatch: boolean
}

/** 按伤害类型 / 基础伤害来源推导常规链路 id（不考虑数据库覆盖） */
function expectedChainIdFor(damageType: string, baseDamageSource: string, useSharpen: boolean): string {
  return resolveDamageChainId({ damageKind: damageType, baseDamageSource, useSharpen })
}

function stagesForChainId(chainId: string): readonly StageDefinition[] {
  const merged = getMergedDamageChains()
  const fromDb = [...merged].reverse().find((chain) => chain.id === chainId)
  if (fromDb) return fromDb.stages
  return getDamageChain(chainId)?.stages ?? []
}

function stagesSignature(stages: readonly StageDefinition[]): string {
  return stages
    .filter((stage) => stage.enabled !== false)
    .map((stage) => `${stage.order}:${stage.id}`)
    .join(',')
}

/**
 * 核查思路：把每个角色按其职业推导基础伤害来源（命破 → pierce、锋御 → def、其余 atk），
 * 对其每条招式按伤害类型解析「常规链路」（无数据库覆盖时的推导结果），
 * 再按同一上下文跑一次真实解析（内置 + 数据库覆盖 + 运行时链路）。
 * 链路 id 不同或乘区序列不同的条目列为「角色/招式特定链路」。
 */
const chainAuditRows = computed<ChainAuditRow[]>(() => {
  const rows: ChainAuditRow[] = []
  for (const agent of calculatorBuffStore.agents) {
    const skills = calculatorBuffStore.skills.filter((skill) => skill.agentId === agent.id)
    const baseDamageSource = resolveBaseDamageSourceForProfession(agent.profession)
    for (const skill of skills) {
      const useSharpen = skill.damageType === 'sharpen' || agent.profession === '锋御'
      const expectedChainId = expectedChainIdFor(skill.damageType, baseDamageSource, useSharpen)
      const resolved = resolveCurrentDamageChain({
        damageKind: skill.damageType,
        baseDamageSource,
        useSharpen,
        context: {
          agentId: agent.id,
          profession: agent.profession,
          skillId: skill.id,
        },
      })
      const expectedStages = stagesForChainId(expectedChainId)
      const resolvedStages = stagesForChainId(resolved.chainId)
      const stageMismatch = stagesSignature(expectedStages) !== stagesSignature(resolvedStages)
      const chainMismatch = resolved.chainId !== expectedChainId
      if (!chainMismatch && !stageMismatch) continue
      rows.push({
        agentId: agent.id,
        agentName: agent.name,
        profession: agent.profession,
        skillId: skill.id,
        skillName: skill.name,
        damageType: skill.damageType,
        resolvedChainId: resolved.chainId,
        expectedChainId,
        expectedStages,
        resolvedStages,
        stageMismatch,
        chainMismatch,
      })
    }
  }
  return rows
})

/** 汇总为「角色级」条目：该角色所有招式解析结果一致时合并成一行 */
const chainAuditSummary = computed(() => {
  const byAgent = new Map<string, ChainAuditRow[]>()
  for (const row of chainAuditRows.value) {
    const list = byAgent.get(row.agentId) ?? []
    list.push(row)
    byAgent.set(row.agentId, list)
  }
  return [...byAgent.entries()].map(([agentId, list]) => {
    const first = list[0]!
    const allSameChain = list.every((row) => row.resolvedChainId === first.resolvedChainId)
    const allSameStages = new Set(list.map((row) => stagesSignature(row.resolvedStages))).size === 1
    return {
      agentId,
      agentName: first.agentName,
      profession: first.profession,
      skillCount: list.length,
      chainId: allSameChain ? first.resolvedChainId : null,
      stageSignature: allSameStages ? stagesSignature(first.resolvedStages) : null,
      chainMismatchCount: list.filter((row) => row.chainMismatch).length,
      stageMismatchCount: list.filter((row) => row.stageMismatch).length,
      rows: list,
    }
  })
})

const auditExpandedAgentId = ref('')

function toggleAuditAgent(agentId: string) {
  auditExpandedAgentId.value = auditExpandedAgentId.value === agentId ? '' : agentId
}

function auditStageLabels(stages: readonly StageDefinition[]): string {
  return stages
    .filter((stage) => stage.enabled !== false)
    .map((stage) => stage.label)
    .join(' → ')
}

// ---- 预览：合成面板按当前链路的阶段顺序算一次，只读 ----

function runPreview() {
  previewError.value = ''
  previewResult.value = null
  const row = selectedRow.value
  if (!row) return
  if (!row.stages.length) {
    previewError.value = '该链路没有可用阶段'
    return
  }
  previewResult.value = previewDamageChain(row.chainKey, row.stages, {}, previewSampleId.value)
}

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    chains.value = await fetchDamageChains()
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '读取计算链路失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="zone-section">
    <header class="chain-header">
      <h3 class="chain-title">计算链路（只读）</h3>
      <span class="chain-count">
        {{ scopeFilterActive ? `${filteredChainRows.length} / ${chainRows.length} 条` : `${chainRows.length} 条` }}
      </span>
    </header>
    <p class="chain-hint">
      列出代码内置链路与数据库里的作用域覆盖，点击一条查看它的乘区顺序。
      本面板只读：链路由代码与数据库维护，不在此新增、编辑或删除。
    </p>

    <div class="chain-filter-block">
      <div class="chain-filter-row">
        <span class="chain-filter-label">作用域</span>
        <button
          v-for="option in scopeOptions"
          :key="option.id"
          type="button"
          class="chip"
          :class="{ active: scopeFilter.includes(option.id) }"
          @click="toggleScopeFilter(option.id)"
        >
          {{ option.label }}
        </button>
        <button
          v-if="scopeFilterActive"
          type="button"
          class="secondary-btn small"
          @click="resetScopeFilter"
        >
          清除筛选
        </button>
      </div>
      <div v-if="needsAgentTargets" class="chain-filter-row">
        <span class="chain-filter-label">角色</span>
        <button
          v-for="agent in filterAgentOptions"
          :key="agent.id"
          type="button"
          class="chip"
          :class="{ active: agentFilter.includes(agent.id) }"
          @click="toggleAgentFilter(agent.id)"
        >
          {{ agent.name }}
        </button>
        <span v-if="!filterAgentOptions.length" class="chain-filter-empty">加载角色库中…</span>
      </div>
      <div v-if="needsSkillTargets" class="chain-filter-row">
        <span class="chain-filter-label">招式</span>
        <button
          v-for="skill in filterSkillOptions"
          :key="skill.id"
          type="button"
          class="chip"
          :class="{ active: skillFilter.includes(skill.id) }"
          @click="toggleSkillFilter(skill.id)"
        >
          {{ skill.name }}
        </button>
        <span v-if="!filterSkillOptions.length" class="chain-filter-empty">
          {{ needsAgentTargets && !agentFilter.length ? '先选角色或直接看全部招式链路' : '招式库为空' }}
        </span>
      </div>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <div class="chain-display-layout">
      <div class="item-list list-scroll chain-list">
        <p v-if="loading" class="chain-empty">读取中…</p>
        <p v-else-if="!filteredChainRows.length" class="chain-empty">
          {{ scopeFilterActive ? '筛选条件下没有匹配的链路。' : '没有可展示的链路。' }}
        </p>
        <button
          v-for="row in filteredChainRows"
          :key="row.key"
          type="button"
          class="list-item"
          :class="{ active: selectedRowKey === row.key }"
          @click="selectRow(row)"
        >
          <span class="list-name">{{ row.label }}</span>
          <span class="list-meta mono">{{ row.chainKey }}</span>
          <span class="list-meta">
            {{ row.origin === 'builtin' ? '内置' : '数据库覆盖' }} · {{ scopeLabel(row.scope) }}
            <template v-if="row.targetId"> · {{ row.targetId }}</template>
            · {{ row.stages.length }} 个乘区
          </span>
          <span class="list-meta">
            {{ row.damageKinds.join(' / ') || '全部伤害类型' }}
            <template v-if="row.origin === 'db'"> · {{ row.enabled ? '已启用' : '已停用' }}</template>
          </span>
        </button>
      </div>

      <div class="chain-display-detail">
        <template v-if="selectedRow">
          <header class="chain-header">
            <h4 class="chain-title">{{ selectedRow.label }}</h4>
            <span class="chain-count mono">{{ selectedRow.chainKey }}</span>
          </header>
          <p class="chain-hint">
            {{ scopeLabel(selectedRow.scope) }}
            <template v-if="selectedRow.targetId"> · 目标 {{ selectedRow.targetId }}</template>
            · 优先级 {{ selectedRow.priority }}
            <template v-if="selectedRow.overridden"> · 该内置链路存在数据库覆盖行</template>
          </p>

          <div class="chain-stage-grid">
            <div
              v-for="stage in selectedRow.stages"
              :key="`stage-${stage.id}`"
              class="chain-stage-cell"
              :class="`chain-stage-cell--${stage.kind}`"
            >
              <div class="cell-head">
                <span class="cell-kind">{{ STAGE_KIND_LABELS[stage.kind] ?? stage.kind }}</span>
                <span class="cell-order">{{ stage.order }}</span>
              </div>
              <span class="cell-label">{{ stage.label }}</span>
              <span class="cell-module mono">{{ stage.module || '—' }}</span>
              <span v-if="formatParams(stage)" class="cell-detail mono">{{ formatParams(stage) }}</span>
              <span v-if="formatWhen(stage)" class="cell-detail mono">条件 {{ formatWhen(stage) }}</span>
            </div>
          </div>

          <div class="chain-preview">
            <div class="chain-preview-head">
              <strong>预览示例</strong>
              <select v-model="previewSampleId" class="field-input preview-sample-select">
                <option v-for="sample in DAMAGE_CHAIN_SAMPLE_HITS" :key="sample.id" :value="sample.id">
                  {{ sample.label }}
                </option>
              </select>
              <button type="button" class="secondary-btn small" @click="runPreview">计算</button>
            </div>
            <p v-if="previewError" class="form-error">{{ previewError }}</p>
            <template v-if="previewResult">
              <div class="chain-preview-grid">
                <div v-for="stage in previewResult.stages" :key="`preview-${stage.id}`" class="preview-cell">
                  <span class="preview-kind">{{ STAGE_KIND_LABELS[stage.kind] ?? stage.kind }}</span>
                  <span class="preview-label">{{ stage.label }}</span>
                  <span class="preview-value">
                    {{ Number.isInteger(stage.value) ? stage.value.toLocaleString('en-US') : stage.value }}
                  </span>
                </div>
              </div>
              <p class="chain-hint">
                示例命中「{{ previewResult.sampleLabel }}」· 合成面板（攻击 3000 / 增伤 50% / 暴击 50%-100%），
                与线上真实面板无关。示例最终伤害
                {{ Math.round(previewResult.final).toLocaleString('en-US') }}。
              </p>
            </template>
          </div>
        </template>
        <p v-else class="chain-hint">选择左侧链路查看乘区顺序。</p>
      </div>
    </div>

    <!-- 链路一致性核查：全角色 × 全招式，链路解析结果与常规推导不一致的条目 -->
    <section class="chain-audit">
      <header class="chain-header">
        <h4 class="chain-title">链路一致性核查</h4>
        <span class="chain-count">
          {{ chainAuditSummary.length ? `${chainAuditSummary.length} 个角色存在差异` : '全部一致' }}
        </span>
      </header>
      <p class="chain-hint">
        按角色职业推导常规链路（命破 → 命破链路、锋御 → 锐化链路、其余 → 按伤害类型），
        再对每条招式跑真实解析（含数据库覆盖）。链路 id 或乘区顺序与常规不一致的角色列在下面，
        展开可看具体是哪些招式、差在哪。
      </p>
      <p v-if="!chainAuditSummary.length" class="chain-empty">所有角色的所有招式都走常规链路，没有角色专属 / 招式专属差异。</p>
      <div v-for="item in chainAuditSummary" :key="item.agentId" class="chain-audit-agent">
        <button
          type="button"
          class="chain-audit-head"
          :aria-expanded="auditExpandedAgentId === item.agentId"
          @click="toggleAuditAgent(item.agentId)"
        >
          <strong>{{ item.agentName }}</strong>
          <span class="list-meta">
            {{ item.profession || '无职业' }} · {{ item.skillCount }} 条招式
            <template v-if="item.chainId"> · 生效链路 {{ item.chainId }}</template>
            · 链路差异 {{ item.chainMismatchCount }} / 乘区差异 {{ item.stageMismatchCount }}
          </span>
          <span class="chain-audit-toggle">{{ auditExpandedAgentId === item.agentId ? '收起' : '展开' }}</span>
        </button>
        <div v-if="auditExpandedAgentId === item.agentId" class="chain-audit-detail">
          <div v-for="row in item.rows" :key="row.skillId" class="chain-audit-row">
            <div class="chain-audit-row-head">
              <strong>{{ row.skillName }}</strong>
              <span class="list-meta mono">{{ row.damageType }}</span>
              <span class="list-meta">
                {{ row.chainMismatch ? '链路专属' : '链路相同但乘区不同' }}
                <template v-if="row.chainMismatch">
                  · {{ row.expectedChainId }} → {{ row.resolvedChainId }}
                </template>
              </span>
            </div>
            <p class="chain-audit-stages">
              <span>常规（{{ row.expectedChainId }}）：{{ auditStageLabels(row.expectedStages) || '—' }}</span>
              <span>实际（{{ row.resolvedChainId }}）：{{ auditStageLabels(row.resolvedStages) || '—' }}</span>
            </p>
          </div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="authDialogVisible" class="auth-mask">
        <div class="auth-card">
          <h3>管理员登录已失效</h3>
          <p>请重新登录后查看计算链路。</p>
          <button type="button" class="primary-btn" @click="goRelogin">去登录</button>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.chain-display-layout {
  display: grid;
  grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.chain-list {
  max-height: none;
}

.chain-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.chain-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.chain-count {
  font-size: 0.75rem;
  opacity: 0.7;
}

.chain-empty,
.chain-hint {
  font-size: 0.8rem;
  opacity: 0.75;
  margin: 0.3rem 0;
}

/* ---- 作用域筛选（一级层级 + 二级目标，多选 chips） ---- */

.chain-filter-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.4rem 0;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.chain-filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chain-filter-label {
  flex: 0 0 auto;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.8;
  min-width: 2.6rem;
}

.chain-filter-empty {
  font-size: 0.72rem;
  opacity: 0.6;
}

.chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.chip.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  color: var(--color-heading);
  font-weight: 700;
}

/* ---- 链路一致性核查 ---- */

.chain-audit {
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--color-border);
}

.chain-audit-agent {
  margin-top: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  overflow: hidden;
}

.chain-audit-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: none;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}

.chain-audit-head:hover {
  background: color-mix(in srgb, var(--color-background-mute) 60%, transparent);
}

.chain-audit-toggle {
  margin-left: auto;
  font-size: 0.72rem;
  opacity: 0.7;
  text-decoration: underline;
  white-space: nowrap;
}

.chain-audit-detail {
  padding: 0.2rem 0.7rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chain-audit-row {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
}

.chain-audit-row-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem 0.6rem;
}

.chain-audit-stages {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0.3rem 0 0;
  font-size: 0.72rem;
  opacity: 0.78;
  word-break: break-all;
}

.chain-display-detail {
  min-width: 0;
}

.chain-stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem;
  margin: 0.6rem 0 1rem;
}

.chain-stage-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.35);
  min-height: 4.5rem;
}

.chain-stage-cell--final {
  border-color: rgba(250, 204, 21, 0.55);
}

.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
}

.cell-kind {
  font-size: 0.7rem;
  opacity: 0.75;
}

.cell-order {
  font-size: 0.7rem;
  opacity: 0.6;
}

.cell-label {
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.25;
}

.cell-module,
.cell-detail {
  font-size: 0.68rem;
  opacity: 0.7;
  word-break: break-all;
}

.chain-preview {
  margin-top: 0.8rem;
}

.chain-preview-head {
  display: flex;
  align-items: center;
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
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: 0.4rem;
}

.preview-cell {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 0.4rem;
}

.preview-kind {
  font-size: 0.66rem;
  opacity: 0.7;
}

.preview-label {
  font-size: 0.78rem;
}

.preview-value {
  font-size: 0.85rem;
  font-weight: 600;
}

.auth-mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.6);
  z-index: 60;
}

.auth-card {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 0.6rem;
  padding: 1.2rem 1.4rem;
  min-width: 16rem;
}

:global([data-theme='light']) .chain-stage-cell,
:global([data-theme='light']) .preview-cell {
  background: #f8fafc;
}
</style>
