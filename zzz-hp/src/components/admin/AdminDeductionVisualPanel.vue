<script setup lang="ts">
import { provide, ref } from 'vue'
import DeductionDetailPanel from '@/components/deduction/DeductionDetailPanel.vue'
import {
  createDeductionAdminNode,
  createDeductionAdminPeriod,
  deleteDeductionAdminNode,
  deleteDeductionAdminPeriod,
  fetchDeductionAdminNodes,
  reorderDeductionAdminNodes,
  renameDeductionAdminPeriod,
  updateDeductionAdminNode,
  importDeductionFromNanoka,
  DEDUCTION_NODE_PERSIST_KEY,
  type AdminDeductionNode,
} from '@/api/deductionAdmin'
import type { DeductionMonster, DeductionNode, DeductionPeriod } from '@/api/deduction'
import { deductionPeriodDisplay } from '@/api/deduction'

const detailRef = ref<{
  reload?: (target?: { periodId?: string; nodeId?: string }) => Promise<void>
} | null>(null)

const actionError = ref('')
const actionMessage = ref('')

// 期数新建 / 改名
const newPeriodOpen = ref(false)
const newPeriodVersion = ref('')
const newPeriodName = ref('')
const renamePeriodOpen = ref(false)
const renameDraft = ref('')
const renameTarget = ref<DeductionPeriod | null>(null)

const acting = ref(false)

const nanokaSimulIds = ref('')
const nanokaImporting = ref(false)

async function runNanokaImport(dryRun: boolean) {
  if (
    !dryRun &&
    !window.confirm(
      '将从 nanoka 刷新指定期数的节点、怪物与 Buff（整期覆盖）。期数显示名与已上传图片会保留。继续？',
    )
  ) {
    return
  }
  nanokaImporting.value = true
  actionError.value = ''
  actionMessage.value = ''
  try {
    const raw = nanokaSimulIds.value.trim()
    const simulIds = raw
      ? raw
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : 'all'
    const result = await importDeductionFromNanoka({ simulIds, dryRun })
    if (dryRun) {
      const parts =
        result.periods?.map((p) => `${p.periodId}（${p.nodes} 节点 / ${p.bosses} 怪 / ${p.buffs} Buff）`) ??
        []
      actionMessage.value = parts.length
        ? `预览：${parts.join('；')}`
        : '预览完成（无数据）'
    } else {
      const parts = result.summary?.map((s) => s.periodId) ?? []
      actionMessage.value = parts.length
        ? `已从 nanoka 更新期数：${parts.join('、')}`
        : '更新完成'
      await reloadDetail()
    }
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'nanoka 更新失败'
  } finally {
    nanokaImporting.value = false
  }
}

async function reloadDetail(target?: { periodId?: string; nodeId?: string }) {
  try {
    await detailRef.value?.reload?.(target)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '刷新失败'
  }
}

// ── 节点内联保存 ──────────────────────

/** 按 version+nodeId 取出管理端节点，套用变更后提交并刷新 */
async function applyNodeUpdate(
  version: string,
  nodeId: string,
  mutate: (node: AdminDeductionNode) => void,
  okMessage?: string,
) {
  actionError.value = ''
  try {
    const nodes = await fetchDeductionAdminNodes(version)
    const admin = nodes.find((n) => n.nodeId === nodeId)
    if (!admin) {
      actionError.value = '未找到对应节点，请刷新后重试'
      return
    }
    mutate(admin)
    await updateDeductionAdminNode(admin.id, {
      name: admin.name,
      type: admin.type,
      storyText: admin.storyText,
      prevNode: admin.prevNode,
      storyOptions: admin.storyOptions ?? [],
      layers: admin.layers,
      buffs: admin.buffs,
      sortOrder: admin.sortOrder,
    })
    if (okMessage) actionMessage.value = okMessage
    await reloadDetail()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '保存失败'
    throw error
  }
}

provide(DEDUCTION_NODE_PERSIST_KEY, applyNodeUpdate)

function onSaveInfo(
  version: string,
  nodeId: string,
  payload: { name: string; type: number; storyText: string; prevNode?: string | null },
) {
  void applyNodeUpdate(
    version,
    nodeId,
    (node) => {
      node.name = payload.name
      node.type = payload.type
      node.storyText = payload.storyText
      if (payload.prevNode !== undefined) node.prevNode = payload.prevNode
    },
    '节点信息已保存',
  )
}

function onSaveBuff(
  version: string,
  nodeId: string,
  index: number,
  payload: {
    title: string
    desc: string
    buff_image?: string | null
    effect_blocks?: AdminDeductionNode['buffs'][number]['effect_blocks']
  },
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    node.buffs[index] = { ...node.buffs[index], ...payload }
  }, '增益已保存')
}

/** 新增增益的保存：在指定位置插入 */
function onCreateBuff(
  version: string,
  nodeId: string,
  index: number,
  payload: {
    title: string
    desc: string
    buff_image?: string | null
    effect_blocks?: AdminDeductionNode['buffs'][number]['effect_blocks']
  },
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    node.buffs.splice(Math.min(index, node.buffs.length), 0, {
      title: payload.title,
      desc: payload.desc,
      buff_image: payload.buff_image ?? null,
      effect_blocks: payload.effect_blocks ?? null,
    })
  }, '增益已保存')
}

/** 仅从本节点增益列表移除，不删除 buff 表记录 */
function onRemoveBuff(version: string, nodeId: string, index: number) {
  void applyNodeUpdate(version, nodeId, (node) => {
    node.buffs.splice(index, 1)
  }, '已从本节点移除增益')
}

function onSaveStoryOption(
  version: string,
  nodeId: string,
  index: number,
  payload: { name: string; desc: string },
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    const opts = node.storyOptions ?? (node.storyOptions = [])
    if (opts[index]) {
      opts[index] = { name: payload.name, desc: payload.desc || null }
    }
  }, '选项已保存')
}

/** 新增选项的保存：在指定位置插入 */
function onCreateStoryOption(
  version: string,
  nodeId: string,
  index: number,
  payload: { name: string; desc: string },
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    const opts = node.storyOptions ?? (node.storyOptions = [])
    opts.splice(Math.min(index, opts.length), 0, {
      name: payload.name,
      desc: payload.desc || null,
    })
  }, '选项已保存')
}

function onRemoveStoryOption(version: string, nodeId: string, index: number) {
  void applyNodeUpdate(version, nodeId, (node) => {
    const opts = node.storyOptions ?? []
    if (index >= 0 && index < opts.length) opts.splice(index, 1)
  }, '选项已删除')
}

function onSaveLayer(
  version: string,
  nodeId: string,
  index: number,
  payload: { name: string; isBoss: boolean; fieldBuffSetId?: string | null },
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    const layer = node.layers[index]
    if (!layer) return
    layer.name = payload.name
    // 前战=false（shiyu 数据源）/ 终局=true（危局数据源）
    layer.isBoss = payload.isBoss
    if (payload.fieldBuffSetId !== undefined) {
      layer.fieldBuffSetId =
        payload.fieldBuffSetId == null || String(payload.fieldBuffSetId).trim() === ''
          ? null
          : String(payload.fieldBuffSetId).trim()
    }
  }, '层已保存')
}

function onAddLayer(version: string, nodeId: string, isBoss: boolean) {
  void applyNodeUpdate(version, nodeId, (node) => {
    node.layers.push({
      name: isBoss ? '终局' : '前战',
      monsters: [],
      isBoss,
    })
  }, isBoss ? '已新增终局层' : '已新增前战层')
}

function onRemoveLayer(version: string, nodeId: string, index: number) {
  void applyNodeUpdate(version, nodeId, (node) => {
    node.layers.splice(index, 1)
  }, '层已删除')
}

function onSaveMonster(
  version: string,
  nodeId: string,
  layer: number,
  index: number,
  payload: DeductionMonster,
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    const monsters = node.layers[layer]?.monsters
    if (!monsters) return
    monsters[index] = payload as AdminDeductionNode['layers'][number]['monsters'][number]
  }, '怪物已保存')
}

/** 新增怪物的保存：在指定层指定位置插入 */
function onCreateMonster(
  version: string,
  nodeId: string,
  layer: number,
  index: number,
  payload: DeductionMonster,
) {
  void applyNodeUpdate(version, nodeId, (node) => {
    const monsters = node.layers[layer]?.monsters
    if (!monsters) return
    monsters.splice(
      Math.min(index, monsters.length),
      0,
      payload as AdminDeductionNode['layers'][number]['monsters'][number],
    )
  }, '怪物已保存')
}

function onRemoveMonster(version: string, nodeId: string, layer: number, index: number) {
  void applyNodeUpdate(version, nodeId, (node) => {
    node.layers[layer]?.monsters.splice(index, 1)
  }, '怪物已删除')
}

async function onAdminDeleteNode(version: string, node: DeductionNode) {
  if (!window.confirm(`确认删除节点「${node.name}」？此操作不可恢复。`)) return
  try {
    const nodes = await fetchDeductionAdminNodes(version)
    const admin = nodes.find((n) => n.nodeId === node.nodeId)
    if (admin) await deleteDeductionAdminNode(admin.id)
    await reloadDetail()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '删除节点失败'
  }
}

async function onAdminCreateNode(version: string) {
  try {
    const created = await createDeductionAdminNode(version, {
      name: '未命名节点',
      type: 2,
      storyText: '',
      layers: [],
      buffs: [],
    })
    // 刷新后跳转到新建的节点页签
    await reloadDetail({ periodId: version, nodeId: created.nodeId })
    actionMessage.value = '已创建节点，可直接在下方编辑'
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '创建节点失败'
  }
}

// ── 节点排序 ──────────────────────────────

const reorderOpen = ref(false)
const reorderVersion = ref('')
const reorderNodes = ref<AdminDeductionNode[]>([])
const reorderActing = ref(false)

async function onAdminReorderNodes(version: string) {
  try {
    const nodes = await fetchDeductionAdminNodes(version)
    reorderNodes.value = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder)
    reorderVersion.value = version
    reorderOpen.value = true
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '加载节点失败'
  }
}

function moveReorderNode(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= reorderNodes.value.length) return
  const list = [...reorderNodes.value]
  const item = list.splice(index, 1)[0]
  if (item == null) return
  list.splice(target, 0, item)
  reorderNodes.value = list
}

function closeReorder() {
  reorderOpen.value = false
  reorderNodes.value = []
  reorderVersion.value = ''
}

async function saveReorder() {
  if (!reorderVersion.value) return
  reorderActing.value = true
  try {
    await reorderDeductionAdminNodes(
      reorderVersion.value,
      reorderNodes.value.map((n) => n.id),
    )
    closeReorder()
    await reloadDetail()
    actionMessage.value = '节点顺序已保存'
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '保存排序失败'
  } finally {
    reorderActing.value = false
  }
}

// ── 期数 ──────────────────────────────

function openCreatePeriod() {
  newPeriodVersion.value = ''
  newPeriodName.value = ''
  newPeriodOpen.value = true
}

async function createPeriod() {
  const version = newPeriodVersion.value.trim()
  if (!version) {
    actionError.value = '请输入期数编号'
    return
  }
  acting.value = true
  try {
    const created = await createDeductionAdminPeriod({
      version,
      periodName: newPeriodName.value.trim(),
    })
    newPeriodOpen.value = false
    // 刷新后跳转到新期数
    await reloadDetail({ periodId: created.version })
    actionMessage.value = `期数 ${version} 已创建`
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '创建期数失败'
  } finally {
    acting.value = false
  }
}

function openRenamePeriod(period: DeductionPeriod) {
  renameTarget.value = period
  renameDraft.value = period.periodName ?? ''
  renamePeriodOpen.value = true
}

async function renamePeriod() {
  if (!renameTarget.value) return
  acting.value = true
  try {
    await renameDeductionAdminPeriod(renameTarget.value.periodId, renameDraft.value.trim())
    renamePeriodOpen.value = false
    renameTarget.value = null
    await reloadDetail()
    actionMessage.value = '期数名已更新'
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '改名失败'
  } finally {
    acting.value = false
  }
}

async function onAdminDeletePeriod(period: DeductionPeriod) {
  if (
    !window.confirm(
      `确认删除期数「${deductionPeriodDisplay(period)}」及其全部节点/怪物/Buff？此操作不可恢复。`,
    )
  ) {
    return
  }
  try {
    await deleteDeductionAdminPeriod(period.periodId)
    await reloadDetail()
    actionMessage.value = '期数已删除'
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '删除期数失败'
  }
}
</script>

<template>
  <div class="admin-deduction-visual">
    <p class="adv-hint">
      临界推演在节点内直接编辑：战斗节点可「+ 新增增益」「+ 怪物」「+ 新增层」；选中战斗层后点编辑即可改怪物属性，增益支持按名搜索复用历史 Buff。
    </p>
    <div class="adv-nanoka">
      <label class="adv-nanoka-label" for="adv-nanoka-ids">nanoka 更新</label>
      <input
        id="adv-nanoka-ids"
        v-model="nanokaSimulIds"
        class="adv-nanoka-input"
        type="text"
        placeholder="期数 id：201 或 101,102（留空=全部）"
      />
      <button
        type="button"
        class="adv-btn adv-btn--primary adv-btn--sm"
        :disabled="nanokaImporting"
        @click="runNanokaImport(false)"
      >
        {{ nanokaImporting ? '更新中…' : '从 nanoka 更新' }}
      </button>
      <button
        type="button"
        class="adv-btn adv-btn--sm"
        :disabled="nanokaImporting"
        @click="runNanokaImport(true)"
      >
        预览
      </button>
      <span class="adv-nanoka-note">拉取 simul 数据写入本地；前战小怪编辑仍用本地防卫战库。</span>
    </div>
    <p v-if="actionError" class="adv-error">{{ actionError }}</p>
    <p v-if="actionMessage" class="adv-ok">{{ actionMessage }}</p>

    <DeductionDetailPanel
      ref="detailRef"
      admin-mode
      @admin-save-info="onSaveInfo"
      @admin-save-buff="onSaveBuff"
      @admin-create-buff="onCreateBuff"
      @admin-remove-buff="onRemoveBuff"
      @admin-save-story-option="onSaveStoryOption"
      @admin-create-story-option="onCreateStoryOption"
      @admin-remove-story-option="onRemoveStoryOption"
      @admin-save-layer="onSaveLayer"
      @admin-add-layer="onAddLayer"
      @admin-remove-layer="onRemoveLayer"
      @admin-save-monster="onSaveMonster"
      @admin-create-monster="onCreateMonster"
      @admin-remove-monster="onRemoveMonster"
      @admin-delete-node="onAdminDeleteNode"
      @admin-create-node="onAdminCreateNode"
      @admin-reorder-nodes="onAdminReorderNodes"
      @admin-create-period="openCreatePeriod"
      @admin-rename-period="openRenamePeriod"
      @admin-delete-period="onAdminDeletePeriod"
    />

    <!-- 节点排序 -->
    <Teleport to="body">
      <div v-if="reorderOpen" class="adv-modal-mask" @click.self="closeReorder">
        <div class="adv-modal adv-modal--wide" role="dialog" aria-modal="true" aria-label="节点排序">
          <h3 class="adv-modal-title">节点排序 · {{ reorderVersion }}</h3>
          <p class="adv-hint">使用上/下按钮调整节点顺序，保存后生效。</p>
          <div v-if="reorderNodes.length" class="adv-reorder-list">
            <div v-for="(node, index) in reorderNodes" :key="node.id" class="adv-reorder-row">
              <span class="adv-reorder-index">{{ index + 1 }}</span>
              <span class="adv-reorder-name" :title="node.name">{{ node.name }}</span>
              <div class="adv-reorder-actions">
                <button
                  type="button"
                  class="adv-btn adv-btn--sm"
                  :disabled="index === 0"
                  @click="moveReorderNode(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="adv-btn adv-btn--sm"
                  :disabled="index >= reorderNodes.length - 1"
                  @click="moveReorderNode(index, 1)"
                >
                  ↓
                </button>
              </div>
            </div>
          </div>
          <div v-else class="adv-empty">该期数暂无节点</div>
          <div class="adv-modal-actions">
            <button type="button" class="adv-btn" @click="closeReorder">取消</button>
            <button
              type="button"
              class="adv-btn adv-btn--primary"
              :disabled="reorderActing || !reorderNodes.length"
              @click="saveReorder"
            >
              {{ reorderActing ? '保存中…' : '保存排序' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 新建期数 -->
    <Teleport to="body">
      <div v-if="newPeriodOpen" class="adv-modal-mask" @click.self="newPeriodOpen = false">
        <div class="adv-modal" role="dialog" aria-modal="true" aria-label="新建期数">
          <h3 class="adv-modal-title">新建期数</h3>
          <div class="adv-field">
            <label class="adv-label">期数编号 *</label>
            <input v-model="newPeriodVersion" class="adv-input" placeholder="如 301" />
          </div>
          <div class="adv-field">
            <label class="adv-label">期数名（可选）</label>
            <input v-model="newPeriodName" class="adv-input" placeholder="如 临界推演：xxx" />
          </div>
          <div class="adv-modal-actions">
            <button type="button" class="adv-btn" @click="newPeriodOpen = false">取消</button>
            <button
              type="button"
              class="adv-btn adv-btn--primary"
              :disabled="acting"
              @click="createPeriod"
            >
              {{ acting ? '创建中…' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 期数改名 -->
    <Teleport to="body">
      <div v-if="renamePeriodOpen && renameTarget" class="adv-modal-mask" @click.self="renamePeriodOpen = false">
        <div class="adv-modal" role="dialog" aria-modal="true" aria-label="期数改名">
          <h3 class="adv-modal-title">
            改名 · {{ deductionPeriodDisplay(renameTarget) }}
          </h3>
          <div class="adv-field">
            <label class="adv-label">期数名</label>
            <input v-model="renameDraft" class="adv-input" placeholder="如 临界推演：xxx" />
          </div>
          <div class="adv-modal-actions">
            <button type="button" class="adv-btn" @click="renamePeriodOpen = false">取消</button>
            <button
              type="button"
              class="adv-btn adv-btn--primary"
              :disabled="acting"
              @click="renamePeriod"
            >
              {{ acting ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-deduction-visual {
  min-height: 100%;
  width: 100%;
}

.adv-hint {
  margin: 0;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  opacity: 0.85;
  font-size: 0.82rem;
  line-height: 1.45;
}

.adv-nanoka {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.65rem;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-mute);
}

.adv-nanoka-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-heading);
}

.adv-nanoka-input {
  flex: 1;
  min-width: 140px;
  max-width: 280px;
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.82rem;
  background: var(--color-background);
  color: var(--color-text);
}

.adv-nanoka-note {
  font-size: 0.75rem;
  color: var(--color-text);
  opacity: 0.65;
}

.adv-error {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.1);
  color: #e8a8a8;
  font-size: 0.85rem;
}

.adv-ok {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid rgba(46, 160, 120, 0.35);
  background: rgba(46, 160, 120, 0.1);
  color: #8fd6b8;
  font-size: 0.85rem;
}

.adv-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.adv-modal {
  width: min(92vw, 420px);
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.adv-modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: var(--color-heading);
}

.adv-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.adv-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-text);
}

.adv-input {
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.9rem;
}

.adv-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.3rem;
}

.adv-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.adv-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #141412;
}

.adv-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 节点排序 */
.adv-modal--wide {
  width: min(92vw, 520px);
}

.adv-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.7;
}

.adv-reorder-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 55vh;
  overflow-y: auto;
}

.adv-reorder-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-mute);
}

.adv-reorder-index {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #fcd34d;
  font-size: 0.75rem;
  font-weight: 800;
}

.adv-reorder-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-heading);
}

.adv-reorder-actions {
  display: flex;
  gap: 0.3rem;
  flex-shrink: 0;
}

.adv-btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
}

.adv-empty {
  padding: 1rem 0;
  text-align: center;
  color: var(--color-text);
  opacity: 0.55;
  font-size: 0.85rem;
}
</style>
