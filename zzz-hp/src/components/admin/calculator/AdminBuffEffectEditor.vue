<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import NumberStepper from '@/components/common/NumberStepper.vue'
import type {
  BuffEffect,
  BuffEffectBlock,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { CHARACTER_ATTR_OPTIONS, SKILL_CATEGORY_OPTIONS } from '@/types/calculator'
import { AGENT_ELEMENTS } from '@/utils/calculatorUi'
import {
  BUFF_STAT_FIELDS,
  GENERAL_BUFF_STAT_FIELDS,
  SKILL_BUFF_STAT_FIELDS,
  buffStatFieldLabel,
} from '@/utils/calculatorUi'
import {
  createEmptyBuffEffect,
  createEmptyBuffEffectBlock,
  packFromBlocks,
} from '@/utils/buffEffect'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'

const props = defineProps<{
  lockApplyTarget?: 'self' | 'team' | null
  hint?: string
  /** 当前编辑的角色（招式小类创建/筛选） */
  agentId?: string
}>()

const model = defineModel<BuffEffectBlock[]>({ required: true })

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, skillSubcategories } = storeToRefs(calculatorBuffStore)

const creatingSubcatForId = ref<string | null>(null)
const newSubcat = ref({
  agentId: '',
  name: '',
  categoryId: 'basic' as SkillCategoryId,
})
const subcatMessage = ref('')
const subcatError = ref('')

const subcategoriesByCategory = computed(() => {
  const map = new Map<string, SkillSubcategory[]>()
  const agentFilter = props.agentId || newSubcat.value.agentId
  for (const item of skillSubcategories.value) {
    if (agentFilter && item.agentId && item.agentId !== agentFilter) continue
    const list = map.get(item.categoryId) ?? []
    list.push(item)
    map.set(item.categoryId, list)
  }
  return map
})

function isCreatingSubcat(effect: BuffEffect) {
  return creatingSubcatForId.value === effect.id
}

function statFieldsFor(effect: BuffEffect) {
  if (effect.scope === 'skill') {
    return [...SKILL_BUFF_STAT_FIELDS, ...GENERAL_BUFF_STAT_FIELDS]
  }
  return GENERAL_BUFF_STAT_FIELDS.length ? GENERAL_BUFF_STAT_FIELDS : BUFF_STAT_FIELDS
}

function addBlock() {
  model.value = [
    ...model.value,
    createEmptyBuffEffectBlock({
      name: `效果块 ${model.value.length + 1}`,
      effects: [
        createEmptyBuffEffect({
          applyTarget: props.lockApplyTarget ?? 'self',
        }),
      ],
    }),
  ]
}

function removeBlock(index: number) {
  model.value = model.value.filter((_, i) => i !== index)
}

function addEffect(block: BuffEffectBlock) {
  block.effects.push(
    createEmptyBuffEffect({
      applyTarget: props.lockApplyTarget ?? 'self',
    }),
  )
}

function removeEffect(block: BuffEffectBlock, effectIndex: number) {
  block.effects.splice(effectIndex, 1)
}

function onScopeChange(effect: BuffEffect) {
  if (effect.scope === 'skill') {
    effect.skillCategory = effect.skillCategory ?? 'basic'
    if (!SKILL_BUFF_STAT_FIELDS.some((f) => f.key === effect.stat)) {
      effect.stat = 'skillDmgBonus'
    }
  }
}

function ensureConvert(effect: BuffEffect) {
  if (!effect.convert) {
    effect.convert = { from: 'externalAtk', ratioPercent: 0, cap: null, defaultBase: null }
  }
  if (effect.convert.defaultBase === undefined) {
    effect.convert.defaultBase = null
  }
  return effect.convert
}

async function createSubcategory(effect: BuffEffect) {
  subcatMessage.value = ''
  subcatError.value = ''
  const name = newSubcat.value.name.trim()
  const agentId = props.agentId || newSubcat.value.agentId
  if (!agentId) {
    subcatError.value = '请先选择角色'
    return
  }
  if (!name) {
    subcatError.value = '小类名称为必填'
    return
  }
  try {
    const saved = await calculatorBuffStore.upsertSkillSubcategoryDoc({
      id: '',
      agentId,
      categoryId: newSubcat.value.categoryId,
      name,
    })
    effect.skillCategory = saved.categoryId
    effect.skillSubcategoryId = saved.id
    creatingSubcatForId.value = null
    newSubcat.value = {
      agentId: props.agentId || agentId,
      name: '',
      categoryId: effect.skillCategory ?? 'basic',
    }
    subcatMessage.value = `已添加小类「${saved.name}」`
  } catch (err) {
    subcatError.value = err instanceof Error ? err.message : '添加失败'
  }
}

function openCreateSubcat(effect: BuffEffect) {
  creatingSubcatForId.value = effect.id
  newSubcat.value = {
    agentId: props.agentId || agents.value[0]?.id || '',
    name: '',
    categoryId: effect.skillCategory ?? 'basic',
  }
  subcatError.value = ''
  subcatMessage.value = ''
}

function closeCreateSubcat() {
  creatingSubcatForId.value = null
  subcatError.value = ''
  subcatMessage.value = ''
}

defineExpose({
  syncPack: () => packFromBlocks(model.value),
})
</script>

<template>
  <div class="effect-editor">
    <p v-if="hint !== ''" class="hint">
      {{
        hint ??
        '每个效果块可包含多条效果。招式未选小类时整大类生效。默认：通用增益参与异常；招式伤害/倍率不参与，除非勾选「异常计算时也生效」。'
      }}
    </p>

    <div v-if="!model.length" class="empty">暂无效果块</div>

    <article v-for="(block, blockIndex) in model" :key="block.id" class="block-card">
      <header class="block-head">
        <label class="field name-field">
          <span>效果块名称</span>
          <input v-model="block.name" type="text" />
        </label>
        <button type="button" class="danger-btn" @click="removeBlock(blockIndex)">删除块</button>
      </header>

      <label class="field note-field">
        <span>块备注</span>
        <input v-model="block.note" type="text" placeholder="可选说明" />
      </label>

      <div v-for="(effect, effectIndex) in block.effects" :key="effect.id" class="effect-card">
        <header class="effect-card-head">
          <strong>效果 {{ effectIndex + 1 }}</strong>
          <button type="button" class="danger-btn" @click="removeEffect(block, effectIndex)">
            删除
          </button>
        </header>

        <div class="grid">
          <label class="field">
            <span>作用情况</span>
            <select
              :value="effect.applySituation ?? 'global'"
              @change="
                (e) => {
                  const v = (e.target as HTMLSelectElement).value
                  effect.applySituation =
                    v === 'stagger' || v === 'non_stagger' ? v : 'global'
                }
              "
            >
              <option value="global">全局</option>
              <option value="stagger">失衡期</option>
              <option value="non_stagger">非失衡期</option>
            </select>
          </label>

          <label class="field">
            <span>作用域</span>
            <select v-model="effect.scope" @change="onScopeChange(effect)">
              <option value="general">通用</option>
              <option value="skill">招式</option>
            </select>
          </label>

          <label v-if="!lockApplyTarget" class="field">
            <span>目标</span>
            <select v-model="effect.applyTarget">
              <option value="self">自身</option>
              <option value="team">全队（含自己）</option>
            </select>
          </label>

          <label class="field">
            <span>数值类型</span>
            <select v-model="effect.kind">
              <option value="fixed">固定</option>
              <option value="stacked">叠层</option>
              <option value="convert">转模</option>
            </select>
          </label>

          <label class="field">
            <span>属性</span>
            <select v-model="effect.stat">
              <option
                v-for="field in statFieldsFor(effect)"
                :key="field.key"
                :value="field.key"
              >
                {{ buffStatFieldLabel(field) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>属性限定</span>
            <select
              :value="
                Array.isArray(effect.elementFilter)
                  ? effect.elementFilter[0] ?? 'all'
                  : effect.elementFilter ?? 'all'
              "
              @change="
                (e) => {
                  const v = (e.target as HTMLSelectElement).value
                  effect.elementFilter = v === 'all' ? 'all' : [v]
                }
              "
            >
              <option value="all">全部属性</option>
              <option v-for="el in AGENT_ELEMENTS" :key="el" :value="el">{{ el }}</option>
            </select>
          </label>

          <template v-if="effect.scope === 'skill'">
            <label class="field">
              <span>招式大类</span>
              <select v-model="effect.skillCategory">
                <option
                  v-for="opt in SKILL_CATEGORY_OPTIONS"
                  :key="opt.id"
                  :value="opt.id"
                >
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>招式小类</span>
              <select v-model="effect.skillSubcategoryId">
                <option :value="null">整大类</option>
                <option
                  v-for="sub in subcategoriesByCategory.get(
                    (effect.skillCategory as SkillCategoryId) ?? 'basic',
                  ) ?? []"
                  :key="sub.id"
                  :value="sub.id"
                >
                  {{ sub.name }}
                </option>
              </select>
            </label>
            <div class="field subcat-actions">
              <button type="button" class="ghost-btn" @click="openCreateSubcat(effect)">
                ＋ 新建招式小类
              </button>
            </div>
          </template>

          <label class="field checkbox">
            <input v-model="effect.enabledDefault" type="checkbox" />
            <span>默认启用</span>
          </label>

          <label class="field checkbox" title="默认：通用增益参与异常；招式伤害/倍率不参与。勾选后异常结算也会计入。">
            <input
              :checked="effect.appliesToAnomaly === true"
              type="checkbox"
              @change="
                (e) => {
                  effect.appliesToAnomaly = (e.target as HTMLInputElement).checked
                    ? true
                    : undefined
                }
              "
            />
            <span>异常计算时也生效</span>
          </label>
        </div>

        <div v-if="isCreatingSubcat(effect)" class="subcat-create">
          <header class="subcat-create-head">
            <p class="hint">新建招式小类（仅当前效果）</p>
            <button type="button" class="close-subcat" aria-label="关闭" @click="closeCreateSubcat">
              ×
            </button>
          </header>
          <div class="grid">
            <label v-if="!agentId" class="field">
              <span>角色</span>
              <select v-model="newSubcat.agentId">
                <option value="">请选择角色</option>
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">
                  {{ agent.name }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>招式大类</span>
              <select v-model="newSubcat.categoryId">
                <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>小类名称</span>
              <input v-model="newSubcat.name" type="text" placeholder="显示名称" />
            </label>
          </div>
          <div class="subcat-create-actions">
            <button type="button" class="ghost-btn" @click="createSubcategory(effect)">保存小类</button>
            <button type="button" class="ghost-btn" @click="closeCreateSubcat">取消</button>
          </div>
          <p v-if="subcatError" class="err">{{ subcatError }}</p>
          <p v-if="subcatMessage" class="ok">{{ subcatMessage }}</p>
        </div>

        <div v-if="effect.kind === 'fixed'" class="grid">
          <label class="field">
            <span>数值</span>
            <NumberStepper
              :model-value="effect.value ?? 0"
              :min="-999999"
              :max="999999"
              :step="0.1"
              @update:model-value="effect.value = $event"
            />
          </label>
        </div>

        <div v-else-if="effect.kind === 'stacked'" class="grid">
          <label class="field">
            <span>每层数值</span>
            <NumberStepper
              :model-value="effect.valuePerStack ?? 0"
              :min="-999999"
              :max="999999"
              :step="0.1"
              @update:model-value="effect.valuePerStack = $event"
            />
          </label>
          <label class="field">
            <span>最大层数</span>
            <NumberStepper
              :model-value="effect.maxStacks ?? 1"
              :min="1"
              :max="99"
              @update:model-value="effect.maxStacks = $event"
            />
          </label>
          <label class="field">
            <span>默认层数</span>
            <NumberStepper
              :model-value="effect.defaultStacks ?? 1"
              :min="0"
              :max="99"
              @update:model-value="effect.defaultStacks = $event"
            />
          </label>
        </div>

        <div v-else class="grid">
          <label class="field">
            <span>来源属性</span>
            <select v-model="ensureConvert(effect).from">
              <option v-for="opt in CHARACTER_ATTR_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>转换比例%</span>
            <NumberStepper
              :model-value="ensureConvert(effect).ratioPercent"
              :min="-9999"
              :max="9999"
              :step="0.1"
              @update:model-value="ensureConvert(effect).ratioPercent = $event"
            />
          </label>
          <label class="field">
            <span>默认基础数值</span>
            <NumberStepper
              :model-value="ensureConvert(effect).defaultBase ?? 0"
              :min="0"
              :max="999999"
              :step="0.1"
              @update:model-value="
                (v) => {
                  ensureConvert(effect).defaultBase = v > 0 ? v : 0
                }
              "
            />
          </label>
          <label class="field">
            <span>上限（0=无上限）</span>
            <NumberStepper
              :model-value="ensureConvert(effect).cap ?? 0"
              :min="0"
              :max="999999"
              :step="0.1"
              @update:model-value="
                (v) => {
                  ensureConvert(effect).cap = v > 0 ? v : null
                }
              "
            />
          </label>
        </div>
      </div>

      <button type="button" class="add-btn" @click="addEffect(block)">＋ 在此块添加效果</button>
    </article>

    <button type="button" class="add-btn" @click="addBlock">＋ 添加效果块</button>
  </div>
</template>

<style scoped>
.effect-editor {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.hint {
  margin: 0;
  font-size: 0.76rem;
  opacity: 0.72;
  line-height: 1.45;
  color: var(--color-text);
}

.empty {
  font-size: 0.85rem;
  opacity: 0.65;
  padding: 0.5rem 0;
}

.block-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.85rem;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.block-head {
  display: flex;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
}

.name-field {
  flex: 1;
}

.effect-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.7rem;
  background: var(--color-background);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.effect-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.76rem;
  color: var(--color-text);
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  padding-top: 1.1rem;
}

.field input[type='text'],
.field select {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.4rem 0.5rem;
}

.note-field {
  width: 100%;
}

.subcat-actions {
  justify-content: end;
  padding-top: 1.1rem;
}

.subcat-create {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  background: var(--color-background-soft, transparent);
}

.subcat-create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.subcat-create-head .hint {
  margin: 0;
}

.close-subcat {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}

.subcat-create-actions {
  display: flex;
  gap: 0.45rem;
}

.add-btn,
.danger-btn,
.ghost-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font-size: 0.82rem;
}

.danger-btn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.4);
}

.err {
  margin: 0;
  color: #c45c5c;
  font-size: 0.78rem;
}

.ok {
  margin: 0;
  color: hsl(160, 100%, 32%);
  font-size: 0.78rem;
}
</style>
