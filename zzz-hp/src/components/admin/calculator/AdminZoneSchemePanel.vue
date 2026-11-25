<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import AdminDamageChainSection from '@/components/admin/calculator/AdminDamageChainSection.vue'
import {
  ZONE_PROVIDER_OPTIONS,
  ZONE_SCHEME_SCOPES,
  ZONE_SCHEME_SCOPE_LABELS,
  fetchZoneDefinitions,
  fetchZoneSchemes,
  isAdminZoneAuthError,
  type ZoneDefinitionDoc,
  type ZoneSchemeDoc,
} from '@/api/adminZones'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import { ZONE_DEFINITIONS } from '@/zones/catalog'
import { ZONE_GROUP_FORMULAS, getZoneFormulaNote } from '@/zones/formulaNotes'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 管理端 → 角色计算器 → 乘区方案（只读展示）。
 *
 * 五个模块（内置乘区 / 分组公式 / 乘区定义 / 乘区方案 / 计算链路）通过左侧导航切换，
 * 每次只显示一个。整个面板不参与写入：内置乘区随代码发版，乘区定义与乘区方案存数据库，
 * 由脚本与 API 维护，这里只回答「有哪些乘区、怎么求值、在哪个作用域生效」。
 */

const router = useRouter()

const ZONE_GROUP_LABELS: Record<string, string> = {
  core: '核心',
  direct: '直伤',
  anomaly: '异常',
  radianceSelf: '耀变（本人）',
  special: '特殊',
  custom: '自定义',
}

// ---- 左侧模块导航 ----

type SectionId = 'builtin' | 'groupFormulas' | 'definitions' | 'schemes' | 'chains'

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'builtin', label: '内置乘区' },
  { id: 'groupFormulas', label: '分组公式' },
  { id: 'definitions', label: '乘区定义' },
  { id: 'schemes', label: '乘区方案' },
  { id: 'chains', label: '计算链路' },
]

const activeSection = ref<SectionId>('builtin')

// ---- 通用 ----

const definitions = ref<ZoneDefinitionDoc[]>([])
const schemes = ref<ZoneSchemeDoc[]>([])
const loading = ref(false)
const error = ref('')
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

function scopeLabel(value: string): string {
  return ZONE_SCHEME_SCOPE_LABELS[value as (typeof ZONE_SCHEME_SCOPES)[number]] || value
}

function groupLabel(value: string): string {
  return ZONE_GROUP_LABELS[value] ?? value
}

function providerLabel(mode: string): string {
  return ZONE_PROVIDER_OPTIONS.find((item) => item.id === mode)?.label ?? mode
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

// ---- 载入 ----

async function refreshAll() {
  loading.value = true
  error.value = ''
  try {
    const [defs, schms] = await Promise.all([fetchZoneDefinitions(), fetchZoneSchemes()])
    definitions.value = defs
    schemes.value = schms
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '读取乘区配置失败'
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
        本面板只读：配置通过脚本与 API 维护。每个乘区的计算公式可在「内置乘区」模块展开查看，
        权威来源是仓库根目录的 <span class="mono">CALCULATOR_FORMULAS.md</span>。
      </p>
    </header>

    <p v-if="error" class="form-error">{{ error }}</p>

    <div class="zone-module-layout">
      <nav class="zone-module-nav" aria-label="乘区方案模块">
        <button
          v-for="section in SECTIONS"
          :key="section.id"
          type="button"
          class="zone-module-item"
          :class="{ active: activeSection === section.id }"
          @click="activeSection = section.id"
        >
          <span>{{ section.label }}</span>
          <span v-if="section.id === 'builtin'" class="zone-module-count">
            {{ ZONE_DEFINITIONS.length }}
          </span>
          <span v-else-if="section.id === 'groupFormulas'" class="zone-module-count">
            {{ builtinGroups.length }}
          </span>
          <span v-else-if="section.id === 'definitions'" class="zone-module-count">
            {{ definitions.length }}
          </span>
          <span v-else-if="section.id === 'schemes'" class="zone-module-count">
            {{ schemes.length }}
          </span>
        </button>
      </nav>

      <div class="zone-module-body">
        <!-- 内置乘区 -->
        <section v-if="activeSection === 'builtin'" class="zone-section">
          <div class="section-head">
            <h3 class="section-title">内置乘区（只读）</h3>
            <span class="section-tag">
              {{ builtinFiltered.length }} / {{ ZONE_DEFINITIONS.length }} 条
            </span>
          </div>
          <p class="section-hint">随代码发版更新，不可在此编辑。</p>
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

        <!-- 分组公式总览 -->
        <section v-else-if="activeSection === 'groupFormulas'" class="zone-section">
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

        <!-- 乘区定义（只读） -->
        <section v-else-if="activeSection === 'definitions'" class="zone-section">
          <div class="section-head">
            <h3 class="section-title">乘区定义（数据库）</h3>
            <span class="section-tag">{{ definitions.length }} 条</span>
            <div class="head-actions">
              <button type="button" class="secondary-btn" :disabled="loading" @click="refreshAll">
                {{ loading ? '读取中…' : '刷新' }}
              </button>
            </div>
          </div>
          <p class="section-hint">
            <span class="mono">zone_key</span> 为保存主键：内置键（如
            <span class="mono">stagger</span>）或自定义键（如
            <span class="mono">custom:eliteBonus</span>）。内置 40 条乘区不落库，这里只列管理员新增的定义。
          </p>
          <div class="readonly-list">
            <p v-if="!definitions.length" class="list-empty">还没有乘区定义。</p>
            <div v-for="doc in definitions" :key="doc.zone_key" class="readonly-row">
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
              <span class="chip" :class="{ active: doc.enabled, static: true }">
                {{ doc.enabled ? '已启用' : '已停用' }}
              </span>
            </div>
          </div>
        </section>

        <!-- 乘区方案（只读） -->
        <section v-else-if="activeSection === 'schemes'" class="zone-section">
          <div class="section-head">
            <h3 class="section-title">乘区方案（数据库）</h3>
            <span class="section-tag">{{ schemes.length }} 条</span>
            <div class="head-actions">
              <button type="button" class="secondary-btn" :disabled="loading" @click="refreshAll">
                {{ loading ? '读取中…' : '刷新' }}
              </button>
            </div>
          </div>
          <p class="section-hint">
            作用域越具体越优先（global → 职业 → 角色 → 技能组 → 招式），同一
            <span class="mono">scope + target_id</span> 只能有一条方案。数据库为空时计算走代码内置方案。
          </p>
          <div class="readonly-list">
            <p v-if="!schemes.length" class="list-empty">还没有乘区方案。</p>
            <div v-for="doc in schemes" :key="doc.id" class="readonly-row">
              <div class="config-main">
                <span class="config-name">{{ doc.name }}</span>
                <span class="config-meta">
                  {{ scopeLabel(doc.scope) }} ·
                  <span class="mono">{{ doc.target_id || '(全局)' }}</span>
                  · 优先级 {{ doc.priority }} · v{{ doc.version }} · {{ doc.rules.length }} 条规则
                </span>
              </div>
              <span class="chip" :class="{ active: doc.enabled, static: true }">
                {{ doc.enabled ? '已启用' : '已停用' }}
              </span>
            </div>
          </div>
        </section>

        <!-- 计算链路（只读，子组件自管加载） -->
        <AdminDamageChainSection v-else-if="activeSection === 'chains'" />
      </div>
    </div>

    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，乘区配置没法读取。请重新登录管理员账号。"
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
  /* 覆盖 .editor-panel 的 1080px 居中限宽：本面板是模块化的宽表格/多列布局，铺满内容区 */
  max-width: none;
  margin: 0;
}

.zone-module-layout {
  display: grid;
  grid-template-columns: minmax(9rem, 13rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  margin-top: 1rem;
}

.zone-module-nav {
  position: sticky;
  top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.zone-module-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}

.zone-module-item:hover {
  background: color-mix(in srgb, var(--color-background-mute) 60%, transparent);
}

.zone-module-item.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.1);
  color: var(--color-heading);
  font-weight: 600;
}

.zone-module-count {
  font-size: 0.7rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  opacity: 0.75;
}

.zone-module-body {
  min-width: 0;
}

.zone-section {
  padding-top: 0;
  border-top: none;
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
  max-height: 640px;
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
  margin-top: 0.2rem;
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

.readonly-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.75rem;
  max-height: 640px;
  overflow-y: auto;
  min-height: 100px;
}

.list-empty {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--color-text);
  opacity: 0.7;
}

.readonly-row {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
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

.chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  padding: 0.15rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
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

@media (max-width: 900px) {
  .zone-module-layout {
    grid-template-columns: 1fr;
  }

  .zone-module-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .zone-formula-cell {
    max-width: 14rem;
  }
  .zone-formula-brief {
    max-width: 10rem;
  }
}
</style>
