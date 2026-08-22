<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminDeductionFuzzySelect from './AdminDeductionFuzzySelect.vue'
import {
  createDeductionAdminNode,
  createDeductionAdminPeriod,
  deleteDeductionAdminNode,
  deleteDeductionAdminPeriod,
  fetchDeductionAdminNodes,
  fetchDeductionAdminPeriods,
  fetchDeductionPickBosses,
  fetchDeductionPickBuffs,
  fetchDeductionShiyuMinions,
  renameDeductionAdminPeriod,
  updateDeductionAdminNode,
  type AdminDeductionNode,
  type AdminDeductionPeriod,
  type AdminPickBoss,
  type AdminPickBuff,
} from '@/api/deductionAdmin'
import { deductionNodeTypeLabel, isDeductionBattleNode, isDeductionStoryNode } from '@/api/deduction'

const NODE_TYPES = [
  { value: 1, label: '剧情' },
  { value: 2, label: '战斗' },
  { value: 3, label: '最终战' },
  { value: 4, label: '开场' },
  { value: 5, label: '剧情(变体)' },
]

const ELEMENTS = ['冰', '火', '电', '以太', '物理', '风', '霜', '流明']

const periods = ref<AdminDeductionPeriod[]>([])
const selectedVersion = ref<string | null>(null)
const nodes = ref<AdminDeductionNode[]>([])
const selectedNodeId = ref<number | null>(null)

// 下拉数据源（全局去重）
const pickBosses = ref<AdminPickBoss[]>([])
const pickBuffs = ref<AdminPickBuff[]>([])
/** shiyu 小怪候选：非 STAGE（小怪）层使用 */
const shiyuMinions = ref<AdminPickBoss[]>([])

const loading = ref(false)
const message = ref('')
const messageError = ref(false)
/** 下拉数据源（Boss / Buff / shiyu 小怪）加载中标记，用于搜索框显示加载态 */
const pickersLoading = ref(false)

// 新建期数
const newPeriodVersion = ref('')
const newPeriodName = ref('')
// 期数改名
const renameDraft = ref<Record<string, string>>({})
// 新建节点
const showAddNode = ref(false)
const newNodeType = ref(2)
// 节点编辑草稿
const draft = ref<AdminDeductionNode | null>(null)

const selectedNode = computed(() =>
  nodes.value.find((n) => n.id === selectedNodeId.value) ?? null,
)

function flash(msg: string, isError = false) {
  message.value = msg
  messageError.value = isError
  window.setTimeout(() => {
    message.value = ''
    messageError.value = false
  }, 3000)
}

async function loadPeriods() {
  loading.value = true
  try {
    periods.value = await fetchDeductionAdminPeriods()
    const last = periods.value[periods.value.length - 1]
    if (!selectedVersion.value && last) {
      selectedVersion.value = last.version
    }
    await loadNodes()
  } catch (err) {
    flash(err instanceof Error ? err.message : '加载期数失败', true)
  } finally {
    loading.value = false
  }
}

async function loadNodes() {
  nodes.value = []
  selectedNodeId.value = null
  draft.value = null
  if (!selectedVersion.value) return
  try {
    nodes.value = await fetchDeductionAdminNodes(selectedVersion.value)
    const first = nodes.value[0]
    if (first) selectNode(first.id)
  } catch (err) {
    flash(err instanceof Error ? err.message : '加载节点失败', true)
  }
}

function selectPeriod(version: string) {
  selectedVersion.value = version
  loadNodes()
}

function selectNode(id: number) {
  selectedNodeId.value = id
  const node = nodes.value.find((n) => n.id === id)
  draft.value = node
    ? JSON.parse(
        JSON.stringify(node),
      )
    : null
}

// ── 期数操作 ──────────────────────────────

async function createPeriod() {
  const version = newPeriodVersion.value.trim()
  if (!version) {
    flash('请输入期数编号（如 301）', true)
    return
  }
  try {
    await createDeductionAdminPeriod({
      version,
      periodName: newPeriodName.value.trim(),
    })
    newPeriodVersion.value = ''
    newPeriodName.value = ''
    await loadPeriods()
    selectedVersion.value = version
    await loadNodes()
    flash('期数已创建')
  } catch (err) {
    flash(err instanceof Error ? err.message : '创建失败', true)
  }
}

async function renamePeriod(period: AdminDeductionPeriod) {
  const name = (renameDraft.value[period.version] ?? '').trim()
  try {
    await renameDeductionAdminPeriod(period.version, name)
    delete renameDraft.value[period.version]
    await loadPeriods()
    flash('期数名已更新')
  } catch (err) {
    flash(err instanceof Error ? err.message : '改名失败', true)
  }
}

async function removePeriod(period: AdminDeductionPeriod) {
  if (!window.confirm(`确认删除期数「${period.periodName ?? period.version}」及其全部节点/怪物/Buff？`)) {
    return
  }
  try {
    await deleteDeductionAdminPeriod(period.version)
    if (selectedVersion.value === period.version) selectedVersion.value = null
    await loadPeriods()
    flash('期数已删除')
  } catch (err) {
    flash(err instanceof Error ? err.message : '删除失败', true)
  }
}

// ── 节点操作 ──────────────────────────────

async function addNode() {
  if (!selectedVersion.value) return
  try {
    const created = await createDeductionAdminNode(selectedVersion.value, {
      name: '未命名节点',
      type: newNodeType.value,
      storyText: '',
      layers: [],
      buffs: [],
    })
    await loadNodes()
    const found = nodes.value.find((n) => n.id === created.id)
    if (found) selectNode(found.id)
    flash('节点已创建')
  } catch (err) {
    flash(err instanceof Error ? err.message : '创建节点失败', true)
  }
}

async function saveNode() {
  if (!draft.value) return
  const savedId = draft.value.id
  try {
    await updateDeductionAdminNode(savedId, {
      name: draft.value.name,
      type: draft.value.type,
      storyText: draft.value.storyText,
      layers: draft.value.layers,
      buffs: draft.value.buffs,
      sortOrder: draft.value.sortOrder,
    })
    await loadNodes()
    // 保存后保持当前节点选中，不跳回第一个
    const found = nodes.value.find((n) => n.id === savedId)
    if (found) selectNode(found.id)
    flash('节点已保存')
  } catch (err) {
    flash(err instanceof Error ? err.message : '保存失败', true)
  }
}

async function removeNode(node: AdminDeductionNode) {
  if (!window.confirm(`确认删除节点「${node.name}」？`)) return
  try {
    await deleteDeductionAdminNode(node.id)
    await loadNodes()
    flash('节点已删除')
  } catch (err) {
    flash(err instanceof Error ? err.message : '删除失败', true)
  }
}

// ── 层 / 怪物 / 增益编辑 ──────────────────

/** 属性文本 → 元素数组（剥「属性」后缀） */
function splitElements(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[、,]/)
    .map((s) => s.replace(/属性$/, '').trim())
    .filter(Boolean)
}

function joinElements(list: string[]): string | null {
  return list.length ? [...new Set(list)].join('、') : null
}

function toggleElement(list: string[], el: string): string[] {
  return list.includes(el) ? list.filter((x) => x !== el) : [...list, el]
}

async function loadPickers() {
  pickersLoading.value = true
  try {
    // 各源独立加载：shiyu 小怪抓取 nanoka 较慢/偶发失败，不应拖累 Boss / Buff 数据源
    const results = await Promise.allSettled([
      fetchDeductionPickBosses(),
      fetchDeductionPickBuffs(),
      fetchDeductionShiyuMinions(),
    ])
    if (results[0].status === 'fulfilled') pickBosses.value = results[0].value
    else console.warn('[deduction] Boss 数据源加载失败:', results[0].reason)
    if (results[1].status === 'fulfilled') pickBuffs.value = results[1].value
    else console.warn('[deduction] Buff 数据源加载失败:', results[1].reason)
    if (results[2].status === 'fulfilled') shiyuMinions.value = results[2].value
    else console.warn('[deduction] shiyu 小怪数据源加载失败:', results[2].reason)
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed) flash(`部分下拉数据源加载失败（${failed}/3），可刷新重试`, true)
  } finally {
    pickersLoading.value = false
  }
}

/** Boss 关开关控制数据源：开 = 危局 Boss 候选；关（默认）= shiyu 小怪候选 */
function isBossLayer(layer: { isBoss?: boolean } | null | undefined): boolean {
  return layer?.isBoss === true
}

function onPickMonster(
  layerIndex: number,
  monsterIndex: number,
  option: { name: string; [key: string]: unknown },
) {
  const monster = draft.value?.layers[layerIndex]?.monsters[monsterIndex]
  if (!monster) return
  monster.level = Number(option.level) || 1
  monster.hp = Number(option.hp) || 0
  monster.defense = Number(option.defense) || 0
  monster.weakness = option.weakness == null ? null : String(option.weakness)
  monster.resistance = option.resistance == null ? null : String(option.resistance)
  // 候选自带图片则写入节点，展示侧优先使用（不依赖 boss 表回填）
  if (option.boss_image) monster.boss_image = String(option.boss_image)
}

/** 名字变化（手输或下拉选择）：先清旧图，选择事件随后写入新候选图，避免手输残留旧图 */
function onMonsterName(layerIndex: number, monsterIndex: number, name: string) {
  const monster = draft.value?.layers[layerIndex]?.monsters[monsterIndex]
  if (!monster) return
  if (monster.name !== name) monster.boss_image = null
  monster.name = name
}

function onPickBuff(buffIndex: number, option: { name: string; [key: string]: unknown }) {
  const buff = draft.value?.buffs[buffIndex]
  if (!buff) return
  buff.desc = option.desc == null ? '' : String(option.desc)
  // 候选自带图片则写入节点，展示侧优先使用
  if (option.buff_image) buff.buff_image = String(option.buff_image)
}

/** 增益名变化（手输或下拉选择）：先清旧图，选择事件随后写入新候选图 */
function onBuffTitle(buffIndex: number, title: string) {
  const buff = draft.value?.buffs[buffIndex]
  if (!buff) return
  if (buff.title !== title) buff.buff_image = null
  buff.title = title
}

function addLayer() {
  if (!draft.value) return
  draft.value.layers.push({ name: '默认层', monsters: [], isBoss: false })
}

function removeLayer(index: number) {
  if (!draft.value) return
  draft.value.layers.splice(index, 1)
}

function addMonster(layerIndex?: number) {
  if (!draft.value) return
  // 不强制挂钩某一层：无层时自动建默认层（默认小怪层）
  if (!draft.value.layers.length) draft.value.layers.push({ name: '默认层', monsters: [], isBoss: false })
  const index = layerIndex ?? 0
  const layer = draft.value.layers[index]
  if (!layer) return
  layer.monsters.push({
    name: '',
    hp: 0,
    defense: 0,
    level: 1,
    weakness: null,
    resistance: null,
    boss_image: null,
  })
}

function removeMonster(layerIndex: number, monsterIndex: number) {
  if (!draft.value) return
  const layer = draft.value.layers[layerIndex]
  if (!layer) return
  layer.monsters.splice(monsterIndex, 1)
}

function addBuff() {
  if (!draft.value) return
  draft.value.buffs.push({ title: '', desc: '', buff_image: null })
}

function removeBuff(index: number) {
  if (!draft.value) return
  draft.value.buffs.splice(index, 1)
}

onMounted(() => {
  loadPeriods()
  loadPickers()
})
</script>

<template>
  <div class="admin-deduction">
    <div class="ad-notice" v-if="message">
      {{ message }}
    </div>

    <div v-if="loading" class="ad-state">加载中…</div>

    <div v-else class="ad-grid">
      <!-- 期数列表 -->
      <section class="ad-col">
        <h3 class="ad-col-title">推演期数</h3>
        <div class="ad-list">
          <div
            v-for="period in periods"
            :key="period.version"
            class="ad-row"
            :class="{ 'ad-row--active': selectedVersion === period.version }"
            @click="selectPeriod(period.version)"
          >
            <div class="ad-row-main">
              <strong class="ad-row-name">
                {{ period.periodName ?? `推演 ${period.version}` }}
              </strong>
              <span class="ad-row-meta">{{ period.nodeCount }} 节点</span>
            </div>
            <div class="ad-row-actions">
              <input
                v-model="renameDraft[period.version]"
                class="ad-input ad-input--sm"
                :placeholder="period.periodName ?? period.version"
                @click.stop
              />
              <button class="ad-btn ad-btn--sm" type="button" @click.stop="renamePeriod(period)">
                改名
              </button>
              <button
                class="ad-btn ad-btn--sm ad-btn--danger"
                type="button"
                @click.stop="removePeriod(period)"
              >
                删
              </button>
            </div>
          </div>
          <p v-if="!periods.length" class="ad-empty">暂无期数，先新建一个</p>
        </div>
        <div class="ad-create">
          <input v-model="newPeriodVersion" class="ad-input" placeholder="期数编号，如 301" />
          <input v-model="newPeriodName" class="ad-input" placeholder="期数名（可选）" />
          <button class="ad-btn" type="button" @click="createPeriod">新建期数</button>
        </div>
      </section>

      <!-- 节点列表 -->
      <section class="ad-col">
        <h3 class="ad-col-title">
          节点（{{ selectedVersion ?? '—' }}）
          <select v-model="newNodeType" class="ad-select ad-select--sm">
            <option v-for="t in NODE_TYPES" :key="t.value" :value="t.value">
              {{ t.label }}
            </option>
          </select>
          <button class="ad-btn ad-btn--sm" type="button" @click="addNode">+ 添加节点</button>
        </h3>
        <div class="ad-list">
          <div
            v-for="node in nodes"
            :key="node.id"
            class="ad-row"
            :class="{ 'ad-row--active': selectedNodeId === node.id }"
            @click="selectNode(node.id)"
          >
            <div class="ad-row-main">
              <strong class="ad-row-name">{{ node.name }}</strong>
              <span class="ad-row-meta">{{ deductionNodeTypeLabel(node.type) }}</span>
            </div>
            <button
              class="ad-btn ad-btn--sm ad-btn--danger"
              type="button"
              @click.stop="removeNode(node)"
            >
              删
            </button>
          </div>
          <p v-if="!nodes.length" class="ad-empty">该期暂无节点</p>
        </div>
      </section>

      <!-- 节点编辑器 -->
      <section class="ad-col ad-col--editor">
        <template v-if="draft">
          <h3 class="ad-col-title">编辑节点</h3>
          <div class="ad-field">
            <label class="ad-label">名称</label>
            <input v-model="draft.name" class="ad-input" />
          </div>
          <div class="ad-field">
            <label class="ad-label">类型</label>
            <select v-model="draft.type" class="ad-select">
              <option v-for="t in NODE_TYPES" :key="t.value" :value="t.value">
                {{ t.label }}
              </option>
            </select>
          </div>
          <!-- 剧情文本（仅剧情类节点：开场 / 剧情 / 剧情变体） -->
          <div v-if="isDeductionStoryNode(draft.type)" class="ad-field">
            <label class="ad-label">剧情文本</label>
            <textarea v-model="draft.storyText" class="ad-textarea" rows="12"></textarea>
          </div>

          <!-- 层 / 怪物（仅战斗/最终战节点） -->
          <div v-if="isDeductionBattleNode(draft.type)" class="ad-field">
            <label class="ad-label">关卡层</label>
            <div v-for="(layer, li) in draft.layers" :key="li" class="ad-sub-block">
              <div class="ad-sub-head">
                <span class="ad-mini-label">层名</span>
                <input v-model="layer.name" class="ad-input ad-input--sm" placeholder="如 1-1" />
                <label class="ad-toggle" :title="layer.isBoss ? 'Boss 关（危局数据源）' : '小怪关（shiyu 数据源）'">
                  <input v-model="layer.isBoss" type="checkbox" />
                  <span class="ad-toggle-label" :class="{ 'ad-toggle-label--on': layer.isBoss }">
                    {{ layer.isBoss ? 'Boss' : '小怪' }}
                  </span>
                </label>
                <button class="ad-btn ad-btn--sm ad-btn--danger" type="button" @click="removeLayer(li)">
                  删层
                </button>
              </div>
              <div v-for="(monster, mi) in layer.monsters" :key="mi" class="ad-monster">
                <div class="ad-monster-row">
                  <AdminDeductionFuzzySelect
                    :options="isBossLayer(layer) ? pickBosses : shiyuMinions"
                    :model-value="monster.name"
                    label="名字"
                    :placeholder="isBossLayer(layer) ? '搜索 Boss…' : '搜索小怪…'"
                    :loading="pickersLoading"
                    @update:model-value="onMonsterName(li, mi, $event)"
                    @select="onPickMonster(li, mi, $event)"
                  />
                  <span class="ad-badge-dd">临界</span>
                  <button
                    class="ad-btn ad-btn--sm ad-btn--danger"
                    type="button"
                    @click="removeMonster(li, mi)"
                  >
                    删
                  </button>
                </div>
                <div class="ad-monster-row">
                  <span class="ad-num-field">Lv<input v-model.number="monster.level" class="ad-input ad-input--num" type="number" /></span>
                  <span class="ad-num-field">HP<input v-model.number="monster.hp" class="ad-input ad-input--num" type="number" /></span>
                  <span class="ad-num-field">防御<input v-model.number="monster.defense" class="ad-input ad-input--num" type="number" /></span>
                </div>
                <div class="ad-monster-row">
                  <span class="ad-mini-label">弱点</span>
                  <button
                    v-for="el in ELEMENTS"
                    :key="'w' + el"
                    type="button"
                    class="ad-elem-chip"
                    :class="{ 'ad-elem-chip--on': splitElements(monster.weakness).includes(el) }"
                    @click="monster.weakness = joinElements(toggleElement(splitElements(monster.weakness), el))"
                  >
                    {{ el }}
                  </button>
                </div>
                <div class="ad-monster-row">
                  <span class="ad-mini-label">抗性</span>
                  <button
                    v-for="el in ELEMENTS"
                    :key="'r' + el"
                    type="button"
                    class="ad-elem-chip"
                    :class="{ 'ad-elem-chip--on ad-elem-chip--resist': splitElements(monster.resistance).includes(el) }"
                    @click="monster.resistance = joinElements(toggleElement(splitElements(monster.resistance), el))"
                  >
                    {{ el }}
                  </button>
                </div>
              </div>
              <button class="ad-btn ad-btn--sm" type="button" @click="addMonster(li)">+ 怪物</button>
            </div>
            <button class="ad-btn ad-btn--sm" type="button" @click="addLayer">+ 层</button>
          </div>

          <!-- 增益（仅战斗/最终战节点） -->
          <div v-if="isDeductionBattleNode(draft.type)" class="ad-field">
            <label class="ad-label">可选增益</label>
            <div v-for="(buff, bi) in draft.buffs" :key="bi" class="ad-sub-block">
              <div class="ad-sub-head">
                <AdminDeductionFuzzySelect
                  :options="pickBuffs"
                  :model-value="buff.title"
                  label="增益名"
                  placeholder="搜索 Buff…"
                  :loading="pickersLoading"
                  @update:model-value="onBuffTitle(bi, $event)"
                  @select="onPickBuff(bi, $event)"
                />
                <span class="ad-badge-dd">临界</span>
                <button class="ad-btn ad-btn--sm ad-btn--danger" type="button" @click="removeBuff(bi)">
                  删
                </button>
              </div>
              <textarea
                v-model="buff.desc"
                class="ad-textarea ad-textarea--sm"
                rows="2"
                placeholder="效果描述"
              ></textarea>
            </div>
            <button class="ad-btn ad-btn--sm" type="button" @click="addBuff">+ 增益</button>
          </div>

          <div class="ad-save-row">
            <button class="ad-btn ad-btn--primary" type="button" @click="saveNode">保存节点</button>
          </div>
        </template>
        <p v-else class="ad-empty">选择左侧节点进行编辑</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-deduction {
  height: 100%;
  overflow-y: auto;
  padding: 1rem;
}

.ad-notice {
  position: sticky;
  top: 0;
  z-index: 10;
  margin-bottom: 0.8rem;
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  background: color-mix(in srgb, #34d399 18%, transparent);
  color: var(--color-heading);
  font-size: 0.85rem;
}

.ad-state {
  padding: 3rem 0;
  text-align: center;
  color: var(--color-text);
  opacity: 0.6;
}

.ad-grid {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(240px, 1fr) minmax(320px, 2fr);
  gap: 1rem;
  align-items: start;
}

.ad-col {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  padding: 0.8rem;
}

.ad-col--editor {
  position: sticky;
  /* top 用 0：sticky 静止时与左右列顶部对齐（top: 3rem 会在静止状态把编辑器下推 3rem 造成错位） */
  top: 0;
  z-index: 5;
  max-height: calc(100vh - 8rem);
  overflow-y: auto;
}

.ad-col-title {
  margin: 0 0 0.7rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-heading);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.ad-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.7rem;
}

.ad-row {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
  background: var(--color-background-mute);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ad-row--active {
  border-color: #f59e0b;
}

.ad-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.ad-row-name {
  font-size: 0.9rem;
  color: var(--color-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ad-row-meta {
  font-size: 0.72rem;
  color: var(--color-text);
  opacity: 0.65;
  flex-shrink: 0;
}

.ad-row-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.ad-empty {
  color: var(--color-text);
  opacity: 0.55;
  font-size: 0.85rem;
  padding: 0.6rem 0;
}

.ad-create {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ad-field {
  margin-bottom: 0.8rem;
}

.ad-label {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-text);
}

.ad-input,
.ad-select,
.ad-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.85rem;
}

.ad-input--sm {
  flex: 1;
  min-width: 0;
}

.ad-input--num {
  width: 72px;
  flex: none;
}

.ad-textarea {
  resize: vertical;
}

.ad-textarea--sm {
  font-size: 0.8rem;
}

.ad-select--sm {
  width: auto;
  flex: none;
}

.ad-btn {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.ad-btn--sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.ad-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #141412;
}

.ad-btn--danger {
  color: #b91c1c;
  border-color: color-mix(in srgb, #b91c1c 40%, var(--color-border));
}

.ad-sub-block {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.5rem;
  margin-bottom: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ad-sub-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.ad-sub-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.ad-mini-label {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.75;
}

.ad-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  flex-shrink: 0;
}

.ad-toggle input[type='checkbox'] {
  width: 2rem;
  height: 1.05rem;
  appearance: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text) 22%, transparent);
  position: relative;
  transition: background 0.15s ease;
  cursor: pointer;
  margin: 0;
}

.ad-toggle input[type='checkbox']::after {
  content: '';
  position: absolute;
  top: 0.12rem;
  left: 0.15rem;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background: var(--color-background, #fff);
  transition: left 0.15s ease;
}

.ad-toggle input[type='checkbox']:checked {
  background: #f59e0b;
}

.ad-toggle input[type='checkbox']:checked::after {
  left: 1.05rem;
}

.ad-toggle-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.7;
  transition: color 0.15s ease;
}

.ad-toggle-label--on {
  color: #f59e0b;
  opacity: 1;
}

.ad-num-field {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.85;
}

.ad-monster {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ad-monster-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.ad-elem-chip {
  padding: 0.18rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.65;
}

.ad-elem-chip--on {
  background: color-mix(in srgb, #34d399 24%, transparent);
  border-color: #34d399;
  color: #047857;
  opacity: 1;
}

.ad-elem-chip--resist.ad-elem-chip--on {
  background: color-mix(in srgb, #f87171 24%, transparent);
  border-color: #f87171;
  color: #b91c1c;
}

.ad-badge-dd {
  flex-shrink: 0;
  padding: 0.14rem 0.45rem;
  border-radius: 4px;
  background: color-mix(in srgb, #a78bfa 22%, transparent);
  color: #6d28d9;
  font-size: 0.7rem;
  font-weight: 700;
}

.ad-save-row {
  margin-top: 0.8rem;
}

@media (max-width: 1100px) {
  .ad-grid {
    grid-template-columns: 1fr 1fr;
  }

  /* 窄屏：编辑器移到最上并固定在视口顶部，浏览/点选列表时始终可见 */
  .ad-col--editor {
    grid-column: 1 / -1;
    order: -1;
    position: sticky;
    top: 0;
    z-index: 5;
    max-height: 55vh;
    overflow-y: auto;
    background: var(--color-background-soft);
  }
}

@media (max-width: 700px) {
  .ad-grid {
    grid-template-columns: 1fr;
  }
}
</style>
