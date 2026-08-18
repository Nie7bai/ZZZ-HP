<script setup lang="ts">
import { computed } from 'vue'
import ExtraBuffGainEditor, {
  type ExtraBuffGain,
} from '@/components/calculator/ExtraBuffGainEditor.vue'
import type { SkillCategoryId } from '@/types/calculator'
import type { AgentBuffDoc } from '@/types/calculator'

const open = defineModel<boolean>('open', { default: false })
const gains = defineModel<ExtraBuffGain[]>('gains', { required: true })

defineProps<{
  skillSubcategories?: Array<{
    id: string
    agentId: string
    categoryId: SkillCategoryId
    name: string
  }>
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: AgentBuffDoc[]
}>()

const gainCount = computed(() => gains.value.length)

function close() {
  open.value = false
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="buff-picker-overlay" role="presentation" @click.self="close">
      <div
        class="buff-picker-modal extra-buff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="额外 Buff 增益"
      >
        <header class="buff-picker-header">
          <div class="buff-picker-header-main">
            <div class="buff-picker-title-row">
              <h3>额外 Buff 增益</h3>
              <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
            </div>
            <p>
              未录入角色/音擎/邦布数据时的补充增益。目标按槽位固定（全队或角色1/2/3），不跟编辑中角色走。
            </p>
          </div>
        </header>

        <div class="extra-buff-modal-body">
          <ExtraBuffGainEditor
            v-model="gains"
            :skill-subcategories="skillSubcategories"
            :team-slots="teamSlots"
            :agents="agents"
          />
        </div>

        <footer class="buff-picker-footer">
          <span class="muted">已添加 {{ gainCount }} 条</span>
          <button type="button" class="primary" @click="close">完成</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.buff-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 12, 20, 0.72);
}

.buff-picker-modal {
  width: min(980px, calc(100vw - 16px));
  max-height: min(88vh, 900px);
  display: flex;
  flex-direction: column;
  border: 1px solid #4a5563;
  border-radius: 14px;
  background: #141922;
  color: #e8ecf4;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.buff-picker-header {
  padding: 1rem 1.1rem 0.85rem;
  border-bottom: 1px solid #2d3646;
  flex-shrink: 0;
}

.buff-picker-header-main {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.buff-picker-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.buff-picker-header h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #f4f7fc;
}

.buff-picker-header p {
  margin: 0;
  font-size: 0.78rem;
  color: #9aa3b5;
}

.close-btn {
  border: none;
  background: transparent;
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
  color: #c5ccd8;
}

.extra-buff-modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.9rem 1.1rem;
}

.buff-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1.1rem;
  border-top: 1px solid #2d3646;
  flex-shrink: 0;
}

.buff-picker-footer .muted {
  font-size: 0.8rem;
  color: #9aa3b5;
}

.primary {
  border: 1px solid #6b8f4e;
  border-radius: 8px;
  background: #243018;
  color: #e8f0dc;
  padding: 0.4rem 0.95rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.primary:hover {
  background: #2c3a1c;
}
</style>
