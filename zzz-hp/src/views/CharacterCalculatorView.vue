<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BuffModsDisplay from '@/components/calculator/BuffModsDisplay.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import DamageCalcPage from '@/components/calculator/DamageCalcPage.vue'
import { DAMAGE_CALC_SECTIONS } from '@/constants/damageCalcNav'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'

import { AGENT_MINDSCAPE_RANKS, AGENT_ROLES, collectMindscapeRankBuffs, createEmptyBuffStatModifiers, getMindscapeNote, getMindscapeRankOnlyBuffs, REFINEMENT_RANKS, SUPPORT_STAT_OPTIONS, WENGINE_RARITIES } from '@/utils/calculatorUi'

type CalcPage = 'damage' | 'role-buff' | 'wengine-buff' | 'bangboo-buff' | 'drive-disc-buff'
type MindscapeBuffMode = 'current' | 'cumulative'

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, wengines: wengineDocs, bangboos: bangbooDocs, driveDiscs: driveDiscDocs, loading, loaded, error } =
  storeToRefs(calculatorBuffStore)

onMounted(() => {
  void calculatorBuffStore.ensureLoaded()
})

watch(loaded, (ready) => {
  if (!ready) return
  if (!selectedAgentDocId.value && agents.value[0]) {
    selectedAgentDocId.value = agents.value[0].id
  }
  if (!selectedWengineDocId.value && wengineDocs.value[0]) {
    selectedWengineDocId.value = wengineDocs.value[0].id
  }
  if (!selectedBangbooDocId.value && bangbooDocs.value[0]) {
    selectedBangbooDocId.value = bangbooDocs.value[0].id
  }
  if (!selectedDriveDiscDocId.value && driveDiscDocs.value[0]) {
    selectedDriveDiscDocId.value = driveDiscDocs.value[0].id
  }
})

const pageTitleMap: Record<CalcPage, string> = {
  damage: '伤害计算',
  'role-buff': '角色增益详细',
  'wengine-buff': '音擎增益详细',
  'bangboo-buff': '邦布增益详细',
  'drive-disc-buff': '驱动盘增益',
}

const damageSubNav = DAMAGE_CALC_SECTIONS

const activePage = ref<CalcPage>('damage')
const damageCalcPageRef = ref<InstanceType<typeof DamageCalcPage> | null>(null)
const roleDocSearch = ref('')
const roleDocRoleFilter = ref('')
const wengineSearch = ref('')
const wengineRarityFilter = ref('')
const bangbooSearch = ref('')
const driveDiscSearch = ref('')

const selectedAgentDocId = ref(agents.value[0]?.id ?? '')
const selectedWengineDocId = ref(wengineDocs.value[0]?.id ?? '')
const selectedBangbooDocId = ref(bangbooDocs.value[0]?.id ?? '')
const selectedDriveDiscDocId = ref(driveDiscDocs.value[0]?.id ?? '')
const selectedMindscapeRank = ref(0)
const mindscapeBuffMode = ref<MindscapeBuffMode>('current')
const selectedWengineRefinementRank = ref(1)
const selectedBangbooRefinementRank = ref(1)

const selectedAgentDoc = computed(() => {
  if (!agents.value.length) return null
  return agents.value.find((a) => a.id === selectedAgentDocId.value) ?? agents.value[0]!
})

const selectedWengineDoc = computed(() => {
  if (!wengineDocs.value.length) return null
  return wengineDocs.value.find((w) => w.id === selectedWengineDocId.value) ?? wengineDocs.value[0]!
})

const selectedBangbooDoc = computed(() => {
  if (!bangbooDocs.value.length) return null
  return bangbooDocs.value.find((b) => b.id === selectedBangbooDocId.value) ?? bangbooDocs.value[0]!
})

const selectedDriveDiscDoc = computed(() => {
  if (!driveDiscDocs.value.length) return null
  return (
    driveDiscDocs.value.find((d) => d.id === selectedDriveDiscDocId.value) ?? driveDiscDocs.value[0]!
  )
})

const filteredRoleDocs = computed(() =>
  agents.value.filter((a) => {
    const keyword = roleDocSearch.value.trim()
    const bySearch =
      !keyword || `${a.name}${a.profession}${a.element}${a.id}`.includes(keyword)
    const byRole = !roleDocRoleFilter.value || a.profession === roleDocRoleFilter.value
    return bySearch && byRole
  }),
)

function toggleRoleDocRoleFilter(role: string) {
  roleDocRoleFilter.value = roleDocRoleFilter.value === role ? '' : role
}

function supportNeedLabels(needs: string[]) {
  return needs
    .map((need) => SUPPORT_STAT_OPTIONS.find((option) => option.id === need)?.label ?? need)
    .join('、')
}

const selectedMindscapeBuffs = computed(() => {
  if (!selectedAgentDoc.value) {
    return { selfMods: createEmptyBuffStatModifiers(), teamMods: createEmptyBuffStatModifiers() }
  }
  const { mindscapeBuffs } = selectedAgentDoc.value
  const rank = selectedMindscapeRank.value
  if (mindscapeBuffMode.value === 'cumulative') {
    return collectMindscapeRankBuffs(mindscapeBuffs, rank)
  }
  return getMindscapeRankOnlyBuffs(mindscapeBuffs, rank)
})

const mindscapeBuffScopeLabel = computed(() =>
  mindscapeBuffMode.value === 'cumulative' ? '含低阶' : '仅当前影画',
)

const selectedMindscapeNote = computed(() => {
  if (!selectedAgentDoc.value) return ''
  return getMindscapeNote(selectedAgentDoc.value, selectedMindscapeRank.value)
})

const selectedWengineRefinementBuffs = computed(() => {
  if (!selectedWengineDoc.value) {
    return { selfMods: createEmptyBuffStatModifiers(), teamMods: createEmptyBuffStatModifiers() }
  }
  return (
    selectedWengineDoc.value.refinementBuffs[selectedWengineRefinementRank.value - 1] ?? {
      selfMods: createEmptyBuffStatModifiers(),
      teamMods: createEmptyBuffStatModifiers(),
    }
  )
})

const selectedBangbooRefinementBuffs = computed(() => {
  if (!selectedBangbooDoc.value) return createEmptyBuffStatModifiers()
  return (
    selectedBangbooDoc.value.refinementMods[selectedBangbooRefinementRank.value - 1] ??
    createEmptyBuffStatModifiers()
  )
})

function selectAgentDoc(id: string) {
  selectedAgentDocId.value = id
  selectedMindscapeRank.value = 0
}

const filteredWengineDocs = computed(() =>
  wengineDocs.value.filter((w) => {
    const bySearch = !wengineSearch.value || w.name.includes(wengineSearch.value.trim())
    const byRarity = !wengineRarityFilter.value || w.rarity === wengineRarityFilter.value
    return bySearch && byRarity
  }),
)

const filteredBangbooDocs = computed(() =>
  bangbooDocs.value.filter(
    (b) => !bangbooSearch.value || b.name.includes(bangbooSearch.value.trim()),
  ),
)

const filteredDriveDiscDocs = computed(() =>
  driveDiscDocs.value.filter(
    (d) => !driveDiscSearch.value || d.name.includes(driveDiscSearch.value.trim()),
  ),
)

async function scrollToDamageSection(sectionId: (typeof DAMAGE_CALC_SECTIONS)[number]['id']) {
  const wasDamage = activePage.value === 'damage'
  activePage.value = 'damage'
  await nextTick()
  if (!wasDamage) await nextTick()
  await damageCalcPageRef.value?.scrollToSection(sectionId)
}
</script>

<template>
  <main class="calculator-page">
    <aside class="sidebar">
      <RouterLink to="/" class="back">← 返回首页</RouterLink>
      <h1 class="sidebar-title">角色计算器</h1>
      <nav class="sidebar-nav">
        <div v-for="p in (['damage', 'role-buff', 'wengine-buff', 'bangboo-buff', 'drive-disc-buff'] as CalcPage[])" :key="p" class="sidebar-nav-group">
          <button
            class="sidebar-btn"
            :class="{ active: activePage === p }"
            type="button"
            @click="activePage = p"
          >
            {{ pageTitleMap[p] }}
          </button>
          <div
            v-if="p === 'damage'"
            class="damage-subnav-wrap"
            :class="{ expanded: activePage === 'damage' }"
          >
            <div class="damage-subnav-inner">
              <nav class="damage-subnav" :aria-hidden="activePage !== 'damage'">
                <button
                  v-for="item in damageSubNav"
                  :key="item.id"
                  type="button"
                  class="damage-subnav-btn"
                  :tabindex="activePage === 'damage' ? 0 : -1"
                  @click="scrollToDamageSection(item.id)"
                >
                  {{ item.label }}
                </button>
              </nav>
            </div>
          </div>
        </div>
      </nav>
    </aside>

    <section class="content">
      <p v-if="loading || !loaded" class="load-hint">正在从数据库加载计算器数据...</p>
      <p v-else-if="error" class="load-error">{{ error }}</p>
      <template v-else>
      <DamageCalcPage v-show="activePage === 'damage'" ref="damageCalcPageRef" />

      <article v-if="activePage === 'role-buff'" class="card">
        <h2>角色增益详细</h2>
        <p class="helper-text">点击头像查看该角色“面板外增益”明细（对自己 / 对队友）。</p>
        <div class="grid four compact-grid">
          <label class="field"><span>搜索角色</span><input v-model="roleDocSearch" type="text" placeholder="输入角色名/职业/属性" /></label>
        </div>
        <div class="filter-block">
          <p class="filter-label">职业筛选</p>
          <div class="chip-row">
            <button
              v-for="role in AGENT_ROLES"
              :key="role"
              type="button"
              class="chip"
              :class="{ active: roleDocRoleFilter === role }"
              @click="toggleRoleDocRoleFilter(role)"
            >
              {{ role }}
            </button>
          </div>
        </div>
        <div class="doc-grid">
          <button
            v-for="agent in filteredRoleDocs"
            :key="agent.id"
            class="doc-item"
            :class="{ active: selectedAgentDocId === agent.id }"
            @click="selectAgentDoc(agent.id)"
          >
            <CalculatorAvatar :avatar-image="agent.avatar_image" :name="agent.name" />
            <strong>{{ agent.name }}</strong>
            <span>{{ agent.profession }} · {{ agent.element }}</span>
          </button>
        </div>
        <div v-if="selectedAgentDoc" class="doc-detail">
          <h3>{{ selectedAgentDoc.name }}</h3>
          <p class="doc-meta">
            职业：{{ selectedAgentDoc.profession }} · 属性：{{ selectedAgentDoc.element }}
          </p>
          <p class="doc-meta">
            辅助需求属性：{{
              selectedAgentDoc.supportNeeds.length
                ? supportNeedLabels(selectedAgentDoc.supportNeeds)
                : '未设置'
            }}
          </p>
          <p v-if="selectedAgentDoc.note.trim()" class="doc-note">
            <span class="doc-note-label">角色注释</span>
            {{ selectedAgentDoc.note }}
          </p>

          <div class="mindscape-tabs">
            <button
              v-for="rank in AGENT_MINDSCAPE_RANKS"
              :key="rank"
              type="button"
              class="mindscape-tab"
              :class="{ active: selectedMindscapeRank === rank }"
              @click="selectedMindscapeRank = rank"
            >
              {{ rank }}影
            </button>
          </div>

          <div class="filter-block mindscape-mode-block">
            <p class="filter-label">影画增益显示</p>
            <div class="chip-row">
              <button
                type="button"
                class="chip"
                :class="{ active: mindscapeBuffMode === 'current' }"
                @click="mindscapeBuffMode = 'current'"
              >
                仅当前影画
              </button>
              <button
                type="button"
                class="chip"
                :class="{ active: mindscapeBuffMode === 'cumulative' }"
                @click="mindscapeBuffMode = 'cumulative'"
              >
                含低阶叠加
              </button>
            </div>
          </div>

          <p v-if="selectedMindscapeNote" class="doc-note">
            <span class="doc-note-label">{{ selectedMindscapeRank }} 影注释</span>
            {{ selectedMindscapeNote }}
          </p>

          <p>{{ selectedMindscapeRank }} 影 · 对自身增益（{{ mindscapeBuffScopeLabel }}）</p>
          <BuffModsDisplay :mods="selectedMindscapeBuffs.selfMods" />
          <p>{{ selectedMindscapeRank }} 影 · 对队友增益（{{ mindscapeBuffScopeLabel }}）</p>
          <BuffModsDisplay :mods="selectedMindscapeBuffs.teamMods" />
        </div>
      </article>

      <article v-if="activePage === 'wengine-buff'" class="card">
        <h2>音擎增益详细</h2>
        <p class="helper-text">点击音擎查看面板外增益说明。</p>
        <div class="grid four compact-grid">
          <label class="field"><span>搜索音擎</span><input v-model="wengineSearch" type="text" placeholder="输入音擎名称" /></label>
          <label class="field">
            <span>稀有度筛选</span>
            <select v-model="wengineRarityFilter">
              <option value="">全部</option>
              <option v-for="rarity in WENGINE_RARITIES" :key="rarity" :value="rarity">
                {{ rarity }}
              </option>
            </select>
          </label>
        </div>
        <div class="doc-grid">
          <button
            v-for="w in filteredWengineDocs"
            :key="w.id"
            class="doc-item"
            :class="{ active: selectedWengineDocId === w.id }"
            @click="
              selectedWengineDocId = w.id;
              selectedWengineRefinementRank = 1
            "
          >
            <CalculatorAvatar :avatar-image="w.avatar_image" :name="w.name" />
            <strong>{{ w.name }}</strong>
            <span>{{ w.rarity }}级</span>
          </button>
        </div>
        <div v-if="selectedWengineDoc" class="doc-detail">
          <h3>{{ selectedWengineDoc.name }}</h3>
          <p v-if="selectedWengineDoc.note.trim()" class="doc-note">
            <span class="doc-note-label">音擎注释</span>
            {{ selectedWengineDoc.note }}
          </p>
          <h4 class="doc-subtitle">固定增益</h4>
          <p>自身增益</p>
          <BuffModsDisplay :mods="selectedWengineDoc.fixedBuffs.selfMods" />
          <p>队友增益</p>
          <BuffModsDisplay :mods="selectedWengineDoc.fixedBuffs.teamMods" />
          <h4 class="doc-subtitle">精炼增益</h4>
          <div class="mindscape-tabs">
            <button
              v-for="rank in REFINEMENT_RANKS"
              :key="rank"
              type="button"
              class="mindscape-tab"
              :class="{ active: selectedWengineRefinementRank === rank }"
              @click="selectedWengineRefinementRank = rank"
            >
              精{{ rank }}
            </button>
          </div>
          <p>精{{ selectedWengineRefinementRank }} · 自身增益</p>
          <BuffModsDisplay :mods="selectedWengineRefinementBuffs.selfMods" />
          <p>精{{ selectedWengineRefinementRank }} · 队友增益</p>
          <BuffModsDisplay :mods="selectedWengineRefinementBuffs.teamMods" />
        </div>
      </article>

      <article v-if="activePage === 'bangboo-buff'" class="card">
        <h2>邦布增益详细</h2>
        <p class="helper-text">点击邦布查看面板外增益说明。</p>
        <div class="grid four compact-grid">
          <label class="field"><span>搜索邦布</span><input v-model="bangbooSearch" type="text" placeholder="输入邦布名称" /></label>
        </div>
        <div class="doc-grid">
          <button
            v-for="b in filteredBangbooDocs"
            :key="b.id"
            class="doc-item"
            :class="{ active: selectedBangbooDocId === b.id }"
            @click="
              selectedBangbooDocId = b.id;
              selectedBangbooRefinementRank = 1
            "
          >
            <CalculatorAvatar :avatar-image="b.avatar_image" :name="b.name" />
            <strong>{{ b.name }}</strong>
          </button>
        </div>
        <div v-if="selectedBangbooDoc" class="doc-detail">
          <h3>{{ selectedBangbooDoc.name }}</h3>
          <h4 class="doc-subtitle">固定增益</h4>
          <BuffModsDisplay :mods="selectedBangbooDoc.fixedMods" />
          <h4 class="doc-subtitle">精炼增益</h4>
          <div class="mindscape-tabs">
            <button
              v-for="rank in REFINEMENT_RANKS"
              :key="rank"
              type="button"
              class="mindscape-tab"
              :class="{ active: selectedBangbooRefinementRank === rank }"
              @click="selectedBangbooRefinementRank = rank"
            >
              精{{ rank }}
            </button>
          </div>
          <p>精{{ selectedBangbooRefinementRank }}</p>
          <BuffModsDisplay :mods="selectedBangbooRefinementBuffs" />
        </div>
      </article>

      <article v-if="activePage === 'drive-disc-buff'" class="card">
        <h2>驱动盘增益</h2>
        <p class="helper-text">点击驱动盘查看 2 件套 / 4 件套效果，方便将面板外增益纳入计算。</p>
        <div class="grid four compact-grid">
          <label class="field"><span>搜索驱动盘</span><input v-model="driveDiscSearch" type="text" placeholder="输入驱动盘名称" /></label>
        </div>
        <div class="doc-grid">
          <button
            v-for="d in filteredDriveDiscDocs"
            :key="d.id"
            class="doc-item"
            :class="{ active: selectedDriveDiscDocId === d.id }"
            @click="selectedDriveDiscDocId = d.id"
          >
            <CalculatorAvatar :avatar-image="d.avatar_image" :name="d.name" />
            <strong>{{ d.name }}</strong>
          </button>
        </div>
        <div v-if="selectedDriveDiscDoc" class="doc-detail">
          <h3>{{ selectedDriveDiscDoc.name }}</h3>
          <p v-if="selectedDriveDiscDoc.twoPieceNote.trim()" class="doc-note">
            <span class="doc-note-label">2 件套注释</span>
            {{ selectedDriveDiscDoc.twoPieceNote }}
          </p>
          <p v-if="selectedDriveDiscDoc.fourPieceNote.trim()" class="doc-note">
            <span class="doc-note-label">4 件套注释</span>
            {{ selectedDriveDiscDoc.fourPieceNote }}
          </p>
          <p>2 件套效果</p>
          <BuffModsDisplay :mods="selectedDriveDiscDoc.twoPieceMods" />
          <p>4 件套 · 自身增益</p>
          <BuffModsDisplay :mods="selectedDriveDiscDoc.fourPieceBuffs.selfMods" />
          <p>4 件套 · 队友增益</p>
          <BuffModsDisplay :mods="selectedDriveDiscDoc.fourPieceBuffs.teamMods" />
        </div>
      </article>
      </template>
    </section>
  </main>
</template>

<style scoped>
.calculator-page {
  height: 100vh;
  overflow: hidden;
  display: grid;
  grid-template-columns: 220px 1fr;
  background: #0f1012;
  color: #e9eaec;
}

.sidebar {
  border-right: 1px solid #25282e;
  background: #121419;
  padding: 1rem;
}

.back {
  font-size: 0.84rem;
  color: #b7bec8;
  text-decoration: none;
}

.sidebar-title {
  margin: 0.9rem 0 0.7rem;
  font-size: 1.1rem;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.sidebar-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.sidebar-btn {
  border: 1px solid #2a2d33;
  border-radius: 8px;
  background: #171a1f;
  color: #dce1ea;
  text-align: left;
  padding: 0.45rem 0.6rem;
  cursor: pointer;
}

.sidebar-btn.active {
  border-color: #c9a55c;
  background: #1f1a14;
}

.damage-subnav-wrap {
  display: grid;
  grid-template-rows: 0fr;
  margin: 0 0 0 0.45rem;
  transition: grid-template-rows 0.28s ease;
}

.damage-subnav-wrap.expanded {
  grid-template-rows: 1fr;
}

.damage-subnav-inner {
  overflow: hidden;
  min-height: 0;
}

.damage-subnav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 0.55rem;
  border-left: 1px solid #2a2d33;
  opacity: 0;
  transform: translateY(-6px);
  transition:
    opacity 0.22s ease,
    transform 0.28s ease;
  pointer-events: none;
}

.damage-subnav-wrap.expanded .damage-subnav {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.damage-subnav-btn {
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #9ea6b3;
  text-align: left;
  padding: 0.28rem 0.45rem;
  font-size: 0.76rem;
  cursor: pointer;
}

.damage-subnav-btn:hover {
  color: #dce1ea;
  background: #171a1f;
}

.content {
  min-height: 0;
  padding: 1rem;
  overflow-y: auto;
}

.load-hint,
.load-error {
  margin: 0 0 1rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
}

.load-hint {
  border: 1px solid #34302a;
  background: #14120f;
  color: #d8c39a;
}

.load-error {
  border: 1px solid #5a2f2f;
  background: #241515;
  color: #ffb4b4;
}

.card {
  border: 1px solid #23262c;
  border-radius: 12px;
  background: linear-gradient(180deg, #16191f 0%, #13161b 100%);
  padding: 0.9rem;
}

.card h2 {
  margin: 0 0 0.6rem;
}

.helper-text {
  margin: 0 0 0.7rem;
  color: #9ea6b3;
  font-size: 0.82rem;
}

.grid {
  display: grid;
  gap: 0.55rem;
}

.grid.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.compact-grid {
  margin-bottom: 0.45rem;
}

.filter-block {
  margin-bottom: 0.55rem;
}

.filter-label {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.28rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field span {
  font-size: 0.76rem;
  color: #aab2bf;
}

.field input,
.field select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.44rem 0.54rem;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.45rem;
  margin: 0.8rem 0;
}

.doc-item {
  border: 1px solid #2e333b;
  border-radius: 8px;
  background: #11151b;
  color: #dce1ea;
  padding: 0.45rem;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.doc-item span {
  font-size: 0.74rem;
  color: #93a0b2;
}

.doc-item.active {
  border-color: #c9a55c;
}

.doc-detail {
  border: 1px solid #2b3139;
  border-radius: 10px;
  padding: 0.7rem;
  background: #11151b;
}

.doc-detail h3 {
  margin: 0 0 0.45rem;
}

.doc-note {
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  border: 1px solid #34302a;
  background: #14120f;
  color: #d8c39a;
  white-space: pre-wrap;
  line-height: 1.5;
  font-size: 0.82rem;
}

.doc-note-label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.74rem;
  color: #b7aa93;
}

.doc-subtitle {
  margin: 0.65rem 0 0.35rem;
  font-size: 0.84rem;
  color: #d5dae4;
}

.empty-hint {
  color: #7a828f;
  list-style: none;
  margin-left: -1.05rem;
}

.doc-meta {
  margin: 0 0 0.45rem;
  color: #9ea6b3;
  font-size: 0.8rem;
}

.mindscape-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.65rem 0;
}

.mindscape-mode-block {
  margin-bottom: 0.65rem;
}

.mindscape-tab {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.25rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.mindscape-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}

.doc-detail p {
  margin: 0.5rem 0 0.25rem;
  color: #9ea6b3;
  font-size: 0.8rem;
}

.doc-detail ul {
  margin: 0;
  padding-left: 1.05rem;
}

.doc-detail li {
  margin: 0.2rem 0;
}

@media (max-width: 1100px) {
  .calculator-page {
    grid-template-columns: 1fr;
  }

  .grid.four,
  .doc-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .grid.four,
  .doc-grid {
    grid-template-columns: 1fr;
  }
}
</style>
