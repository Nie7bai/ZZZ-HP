<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
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
  resolveDamageChain,
  type DamageChainDefinition,
  type StageDefinition,
} from '@/zones/pipeline'
import { adaptDamageChain } from '@/zones/chainAdapter'
import type { ZoneScope } from '@/zones/scheme'
import { DAMAGE_CHAIN_SAMPLE_HITS, previewDamageChain, type DamageChainPreview } from '@/zones/preview'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 管理端 → 角色计算器 → 计算链路（只读展示）。
 *
 * 列出全部链路（代码内置 + 数据库里的作用域覆盖），选中一条查看它的乘区顺序；
 * 不提供新建 / 编辑 / 删除 / 排序等写操作 —— 链路内容由代码与数据库维护，
 * 本面板只回答「这条链路有哪些乘区、按什么顺序」。
 */

const router = useRouter()

const chains = ref<DamageChainDoc[]>([])
const loading = ref(false)
const error = ref('')
const authDialogVisible = ref(false)

/** 选中行：`builtin:<id>` / `db:<id>` */
const selectedRowKey = ref('')

const previewResult = ref<DamageChainPreview | null>(null)
const previewError = ref('')
const previewSampleId = ref(DAMAGE_CHAIN_SAMPLE_HITS[0]!.id)

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
      <span class="chain-count">{{ chainRows.length }} 条</span>
    </header>
    <p class="chain-hint">
      列出代码内置链路与数据库里的作用域覆盖，点击一条查看它的乘区顺序。
      本面板只读：链路由代码与数据库维护，不在此新增、编辑或删除。
    </p>

    <p v-if="error" class="form-error">{{ error }}</p>

    <div class="chain-display-layout">
      <div class="item-list list-scroll chain-list">
        <p v-if="loading" class="chain-empty">读取中…</p>
        <p v-else-if="!chainRows.length" class="chain-empty">没有可展示的链路。</p>
        <button
          v-for="row in chainRows"
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
