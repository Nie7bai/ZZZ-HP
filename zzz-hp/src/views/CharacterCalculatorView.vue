<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BuffEffectBlocksDisplay from '@/components/calculator/BuffEffectBlocksDisplay.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import CalculatorLoadStatus from '@/components/calculator/CalculatorLoadStatus.vue'
import DamageCalcPage from '@/components/calculator/DamageCalcPage.vue'
import { DAMAGE_CALC_SECTIONS, DAMAGE_CALC_MODE_ITEMS, type DamageCalcNavItem } from '@/constants/damageCalcNav'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { useThemeStore } from '@/stores/theme'

import '@/assets/calculatorLight.css'

import { AGENT_ELEMENTS, AGENT_MINDSCAPE_RANKS, AGENT_ROLES, collectMindscapeRankBuffs, createEmptyBuffStatModifiers, createEmptySelfTeamBuffs, getMindscapeNote, getMindscapeRankOnlyBuffs, numericStatFieldLabel, REFINEMENT_RANKS, SUPPORT_STAT_OPTIONS, WENGINE_ADVANCED_STAT_FIELDS, WENGINE_RARITIES } from '@/utils/calculatorUi'

defineOptions({ name: 'CharacterCalculatorView' })

type CalcPage = 'damage' | 'role-buff' | 'wengine-buff' | 'bangboo-buff' | 'drive-disc-buff'
type MindscapeBuffMode = 'current' | 'cumulative'
type CalculatorLoadState = 'loading' | 'error' | 'ready'

const calculatorBuffStore = useCalculatorBuffStore()
const themeStore = useThemeStore()
const { mode: themeMode } = storeToRefs(themeStore)
const { agents, wengines: wengineDocs, bangboos: bangbooDocs, driveDiscs: driveDiscDocs, skillSubcategories, loading, loaded, error } =
  storeToRefs(calculatorBuffStore)

const calculatorLoadState = computed<CalculatorLoadState>(() => {
  if (loading.value) return 'loading'
  if (error.value) return 'error'
  if (loaded.value) return 'ready'
  return 'loading'
})

function ensureCalculatorData() {
  void calculatorBuffStore.ensureLoaded().catch(() => {
    // error 已写入 store，由页面错误态展示
  })
}

function retryCalculatorData() {
  if (loading.value) return
  void calculatorBuffStore.loadAll(true).catch(() => {
    // error 已写入 store，由页面错误态展示
  })
}

onMounted(() => {
  ensureCalculatorData()
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
const damageCalcModeItems = DAMAGE_CALC_MODE_ITEMS
const damageCalcModeHint = ref<'panel' | 'affix' | 'optimal'>('panel')
const activePage = ref<CalcPage>('damage')
const mobileNavOpen = ref(false)
const damageCalcPageRef = ref<InstanceType<typeof DamageCalcPage> | null>(null)

const mobileSubtitle = computed(() => pageTitleMap[activePage.value])

watch(activePage, () => {
  mobileNavOpen.value = false
})

watch(mobileNavOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  document.body.style.overflow = ''
})

function selectPage(page: CalcPage) {
  activePage.value = page
  mobileNavOpen.value = false
}

async function scrollToDamageSection(item: DamageCalcNavItem | { id: 'damage-calc-mode' }) {
  const wasDamage = activePage.value === 'damage'
  activePage.value = 'damage'
  mobileNavOpen.value = false
  if ('calcMode' in item && item.calcMode) {
    damageCalcModeHint.value = item.calcMode
    damageCalcPageRef.value?.setCalcMode(item.calcMode)
  }
  await nextTick()
  if (!wasDamage) await nextTick()
  await damageCalcPageRef.value?.scrollToSection(item.id)
}

const roleDocSearch = ref('')
const roleDocRoleFilter = ref('')
const roleDocElementFilter = ref('')
const wengineSearch = ref('')
const wengineRoleFilter = ref('')
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
    const byElement = !roleDocElementFilter.value || a.element === roleDocElementFilter.value
    return bySearch && byRole && byElement
  }),
)

function toggleRoleDocRoleFilter(role: string) {
  roleDocRoleFilter.value = roleDocRoleFilter.value === role ? '' : role
}

function toggleRoleDocElementFilter(element: string) {
  roleDocElementFilter.value = roleDocElementFilter.value === element ? '' : element
}

function supportNeedLabels(needs: string[]) {
  return needs
    .map((need) => SUPPORT_STAT_OPTIONS.find((option) => option.id === need)?.label ?? need)
    .join('、')
}

const selectedMindscapeBuffs = computed(() => {
  if (!selectedAgentDoc.value) {
    return createEmptySelfTeamBuffs()
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
    return createEmptySelfTeamBuffs()
  }
  return (
    selectedWengineDoc.value.refinementBuffs[selectedWengineRefinementRank.value - 1] ??
    createEmptySelfTeamBuffs()
  )
})

const selectedWengineAdvancedStatEntries = computed(() => {
  if (!selectedWengineDoc.value) return []
  const stats = selectedWengineDoc.value.advancedStats
  return WENGINE_ADVANCED_STAT_FIELDS.filter((field) => stats[field.key] !== 0)
})

function toggleWengineDocRoleFilter(role: string) {
  wengineRoleFilter.value = wengineRoleFilter.value === role ? '' : role
}

function toggleWengineDocRarityFilter(rarity: string) {
  wengineRarityFilter.value = wengineRarityFilter.value === rarity ? '' : rarity
}

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
    if (w.id === 'none') return false
    const keyword = wengineSearch.value.trim()
    const bySearch = !keyword || `${w.name}${w.profession}${w.rarity}${w.id}`.includes(keyword)
    const byRole = !wengineRoleFilter.value || w.profession === wengineRoleFilter.value
    const byRarity = !wengineRarityFilter.value || w.rarity === wengineRarityFilter.value
    return bySearch && byRole && byRarity
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
</script>

<template>
  <main
    class="calculator-page"
    :class="{ 'theme-light': themeMode === 'light', 'nav-open': mobileNavOpen }"
  >
    <header class="mobile-topbar">
      <button
        type="button"
        class="mobile-menu-btn"
        aria-label="打开菜单"
        @click="mobileNavOpen = true"
      >
        菜单
      </button>
      <div class="mobile-topbar-text">
        <strong>角色计算器</strong>
        <span>{{ mobileSubtitle }}</span>
      </div>
    </header>

    <button
      v-show="mobileNavOpen"
      type="button"
      class="sidebar-backdrop"
      aria-label="关闭菜单"
      @click="mobileNavOpen = false"
    />

    <aside class="sidebar" :class="{ 'sidebar--open': mobileNavOpen }">
      <RouterLink to="/" class="back" @click="mobileNavOpen = false">
        <span class="back-arrow" aria-hidden="true">◄</span>返回首页
      </RouterLink>
      <h1 class="sidebar-title zzz-display">
        <span class="sidebar-title-text">角色计算器</span>
        <span class="sidebar-title-bar" aria-hidden="true" />
      </h1>
      <nav class="sidebar-nav">
        <div v-for="p in (['damage', 'role-buff', 'wengine-buff', 'bangboo-buff', 'drive-disc-buff'] as CalcPage[])" :key="p" class="sidebar-nav-group">
          <button
            class="sidebar-btn"
            :class="{ active: activePage === p }"
            type="button"
            @click="selectPage(p)"
          >
            <span class="nav-btn-tick" aria-hidden="true" />
            <span class="nav-btn-label">{{ pageTitleMap[p] }}</span>
          </button>
          <div
            v-if="p === 'damage'"
            class="damage-subnav-wrap"
            :class="{ expanded: activePage === 'damage' }"
          >
            <div class="damage-subnav-inner">
              <nav class="damage-subnav" :aria-hidden="activePage !== 'damage'">
                <template v-for="item in damageSubNav" :key="item.id">
                  <div v-if="item.id === 'damage-calc-mode'" class="damage-calc-mode-group">
                    <button
                      type="button"
                      class="damage-subnav-btn damage-calc-mode-label"
                      :tabindex="activePage === 'damage' ? 0 : -1"
                      @click="scrollToDamageSection({ id: 'damage-calc-mode' })"
                    >
                      计算方式
                    </button>
                    <div class="damage-calc-mode-children">
                      <button
                        v-for="modeItem in damageCalcModeItems"
                        :key="modeItem.id"
                        type="button"
                        class="damage-subnav-btn"
                        :class="{ active: damageCalcModeHint === modeItem.calcMode }"
                        :tabindex="activePage === 'damage' ? 0 : -1"
                        @click="scrollToDamageSection(modeItem)"
                      >
                        {{ modeItem.label }}
                      </button>
                    </div>
                  </div>
                  <button
                    v-else
                    type="button"
                    class="damage-subnav-btn"
                    :tabindex="activePage === 'damage' ? 0 : -1"
                    @click="scrollToDamageSection(item)"
                  >
                    {{ item.label }}
                  </button>
                </template>
              </nav>
            </div>
          </div>
        </div>
      </nav>
      <div class="sidebar-foot" aria-hidden="true">ZZZ-HP</div>
    </aside>

    <section class="content">
      <CalculatorLoadStatus
        :state="calculatorLoadState"
        :error="error"
        @retry="retryCalculatorData"
      />
      <template v-if="calculatorLoadState === 'ready'">
      <DamageCalcPage
        v-show="activePage === 'damage'"
        ref="damageCalcPageRef"
        @update:calc-mode="damageCalcModeHint = $event"
      />

      <article v-if="activePage === 'role-buff'" class="card">
        <h2>角色增益详细</h2>
        <p class="helper-text">点击头像查看该角色“面板外增益”明细（对自己 / 对队友）。</p>
        <div class="grid four compact-grid">
          <label class="field"><span>搜索角色</span><input v-model="roleDocSearch" type="text" placeholder="输入角色名/职业/属性" /></label>
        </div>
        <div class="filter-block">
          <p class="filter-label">特性</p>
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
        <div class="filter-block">
          <p class="filter-label">属性</p>
          <div class="chip-row">
            <button
              v-for="element in AGENT_ELEMENTS"
              :key="element"
              type="button"
              class="chip"
              :class="{ active: roleDocElementFilter === element }"
              @click="toggleRoleDocElementFilter(element)"
            >
              {{ element }}
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

          <p>{{ selectedMindscapeRank }} 影 · 增益效果块（{{ mindscapeBuffScopeLabel }}）</p>
          <BuffEffectBlocksDisplay :skill-subcategories="skillSubcategories" :blocks="selectedMindscapeBuffs.effectBlocks" />
        </div>
      </article>

      <article v-if="activePage === 'wengine-buff'" class="card">
        <h2>音擎增益详细</h2>
        <p class="helper-text">点击音擎查看基础属性与面板外增益说明；异职佩戴时仅基础属性参与计算。</p>
        <div class="grid four compact-grid">
          <label class="field"><span>搜索音擎</span><input v-model="wengineSearch" type="text" placeholder="输入音擎名称/职业" /></label>
        </div>
        <div class="filter-block">
          <p class="filter-label">特性</p>
          <div class="chip-row">
            <button
              v-for="role in AGENT_ROLES"
              :key="role"
              type="button"
              class="chip"
              :class="{ active: wengineRoleFilter === role }"
              @click="toggleWengineDocRoleFilter(role)"
            >
              {{ role }}
            </button>
          </div>
        </div>
        <div class="filter-block">
          <p class="filter-label">稀有度</p>
          <div class="chip-row">
            <button
              v-for="rarity in WENGINE_RARITIES"
              :key="rarity"
              type="button"
              class="chip"
              :class="{ active: wengineRarityFilter === rarity }"
              @click="toggleWengineDocRarityFilter(rarity)"
            >
              {{ rarity }}
            </button>
          </div>
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
            <span>{{ w.profession || '未分类' }} · {{ w.rarity }}级</span>
          </button>
        </div>
        <div v-if="selectedWengineDoc" class="doc-detail">
          <h3>{{ selectedWengineDoc.name }}</h3>
          <p class="doc-meta">
            职业：{{ selectedWengineDoc.profession || '未分类' }} · 稀有度：{{ selectedWengineDoc.rarity }}
          </p>
          <p v-if="selectedWengineDoc.note.trim()" class="doc-note">
            <span class="doc-note-label">音擎注释</span>
            {{ selectedWengineDoc.note }}
          </p>
          <h4 class="doc-subtitle">基础属性</h4>
          <p class="helper-text wengine-base-hint">
            计入局外面板；异职佩戴时不享受下方固定/精炼增益。
          </p>
          <div class="wengine-base-stats">
            <div class="wengine-stat-item">
              <span class="wengine-stat-label">基础攻击</span>
              <strong class="wengine-stat-value">{{ selectedWengineDoc.baseAtk }}</strong>
            </div>
            <div
              v-for="field in selectedWengineAdvancedStatEntries"
              :key="field.key"
              class="wengine-stat-item"
            >
              <span class="wengine-stat-label">{{ numericStatFieldLabel(field.label, field.unit) }}</span>
              <strong class="wengine-stat-value">{{ selectedWengineDoc.advancedStats[field.key] }}</strong>
            </div>
          </div>
          <p v-if="!selectedWengineAdvancedStatEntries.length && !selectedWengineDoc.baseAtk" class="empty-mods">
            暂无额外高级属性
          </p>
          <h4 class="doc-subtitle">固定增益</h4>
          <BuffEffectBlocksDisplay :skill-subcategories="skillSubcategories" :blocks="selectedWengineDoc.fixedBuffs.effectBlocks" />
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
          <p>精{{ selectedWengineRefinementRank }}</p>
          <BuffEffectBlocksDisplay :skill-subcategories="skillSubcategories" :blocks="selectedWengineRefinementBuffs.effectBlocks" />
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
          <BuffEffectBlocksDisplay
            :skill-subcategories="skillSubcategories"
            :blocks="selectedBangbooDoc.effectBlocks"
            :effects="selectedBangbooDoc.effects"
            title="固定增益"
          />
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
          <BuffEffectBlocksDisplay
            :skill-subcategories="skillSubcategories"
            :blocks="
              selectedBangbooDoc.refinementEffectBlocks?.[selectedBangbooRefinementRank - 1]
            "
            :effects="
              selectedBangbooDoc.refinementEffects[selectedBangbooRefinementRank - 1] ?? []
            "
            :title="`精${selectedBangbooRefinementRank}`"
          />
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
          <BuffEffectBlocksDisplay
            :skill-subcategories="skillSubcategories"
            :blocks="selectedDriveDiscDoc.twoPieceEffectBlocks"
            :effects="selectedDriveDiscDoc.twoPieceEffects"
            title="2 件套"
          />
          <p>4 件套效果</p>
          <BuffEffectBlocksDisplay :skill-subcategories="skillSubcategories" :blocks="selectedDriveDiscDoc.fourPieceBuffs.effectBlocks" />
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
  transition:
    background-color 0.2s,
    color 0.2s;
}

.mobile-topbar,
.sidebar-backdrop {
  display: none;
}

.calculator-page.theme-light {
  /* 对齐危局/防卫内容区纸色底 */
  background: var(--zzz-bg, #ece9e0);
  color: var(--color-text, #1c212a);
}

/* 对齐危局 ModeSidebar：深色棋盘侧栏，明暗主题不变 */
.sidebar {
  width: 220px;
  height: 100vh;
  padding: 1.4rem 0.9rem;
  border-right: 2px solid #000;
  background: var(--zzz-ink, #000);
  background-image: var(--zzz-tex-chessboard-dark);
  background-position:
    0 0,
    3px 3px;
  background-size: 6px 6px;
  color: #f5f5f0;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  overflow-y: auto;
}

.calculator-page.theme-light .sidebar {
  background: var(--zzz-ink, #000);
  background-image: var(--zzz-tex-chessboard-dark);
  background-position:
    0 0,
    3px 3px;
  background-size: 6px 6px;
  border-right-color: #000;
  color: #f5f5f0;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--zzz-font-mono, ui-monospace, monospace);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(245, 245, 240, 0.55);
  text-decoration: none;
  transition: color 0.18s ease-out;
}

.back-arrow {
  font-size: 0.62rem;
  color: var(--zzz-yellow, #fbfe00);
}

.back:hover {
  color: #f5f5f0;
}

.calculator-page.theme-light .back {
  color: rgba(245, 245, 240, 0.55);
}

.sidebar-title {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--zzz-line, #3a3a3a);
}

.sidebar-title-text {
  font-size: 1.2rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #f5f5f0;
}

.sidebar-title-bar {
  width: 2.4rem;
  height: 4px;
  background: var(--zzz-yellow, #fbfe00);
  transform: skew(-24deg);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  flex: 1;
}

.sidebar-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.sidebar-btn {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.72rem 0.9rem;
  border: 1px solid #000;
  border-radius: var(--zzz-radius-btn, 4px);
  background: var(--zzz-ink-2, #1c1c1c);
  color: rgba(245, 245, 240, 0.85);
  font-size: 0.9rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px #2e2e2e,
    inset 0 0 0 3px var(--zzz-ink-2, #1c1c1c);
  transition:
    background-color 0.16s ease-out,
    color 0.16s ease-out,
    box-shadow 0.16s ease-out;
}

.nav-btn-tick {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  background: transparent;
  transform: skew(-24deg);
  border: 1px solid rgba(245, 245, 240, 0.35);
  transition:
    background-color 0.16s ease-out,
    border-color 0.16s ease-out;
}

.nav-btn-label {
  min-width: 0;
}

.sidebar-btn:hover {
  color: #f5f5f0;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px var(--zzz-yellow, #fbfe00),
    inset 0 0 0 3px var(--zzz-ink-2, #1c1c1c);
}

.sidebar-btn:hover .nav-btn-tick {
  border-color: var(--zzz-yellow, #fbfe00);
}

.sidebar-btn.active {
  color: #0a0a0a;
  font-weight: 800;
  animation: zzz-flash-bg 1s ease-in-out infinite alternate;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.35),
    inset 0 0 0 2px rgba(0, 0, 0, 0.6);
}

.sidebar-btn.active .nav-btn-tick {
  background: #0a0a0a;
  border-color: #0a0a0a;
}

.sidebar-foot {
  margin-top: auto;
  font-family: var(--zzz-font-display, inherit);
  font-size: 0.9rem;
  letter-spacing: 0.14em;
  color: transparent;
  -webkit-text-stroke: 1px var(--zzz-line, #3a3a3a);
  user-select: none;
}

.sidebar-foot::before {
  content: '';
  display: block;
  height: 10px;
  margin-bottom: 0.7rem;
  border-radius: 2px;
  background: #050505 url('/zzz-assets/tab-bg-point.webp') repeat;
}

.damage-subnav-wrap {
  display: grid;
  grid-template-rows: 0fr;
  margin: 0 0 0 0.35rem;
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
  border-left: 1px solid rgba(245, 245, 240, 0.18);
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
  border-radius: 4px;
  background: transparent;
  color: rgba(245, 245, 240, 0.55);
  text-align: left;
  padding: 0.28rem 0.45rem;
  font-size: 0.76rem;
  cursor: pointer;
}

.damage-subnav-btn:hover {
  color: #f5f5f0;
  background: rgba(251, 254, 0, 0.08);
}

.damage-subnav-btn.active {
  color: var(--zzz-yellow, #fbfe00);
  background: rgba(251, 254, 0, 0.12);
}

.damage-calc-mode-group {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.1rem;
}

.damage-calc-mode-label {
  color: rgba(245, 245, 240, 0.7);
  font-weight: 600;
}

.damage-calc-mode-children {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  margin-left: 0.35rem;
  padding-left: 0.5rem;
  border-left: 1px solid rgba(245, 245, 240, 0.14);
}

.content {
  min-height: 0;
  padding: 1rem;
  overflow-y: auto;
}

.calculator-page.theme-light .content {
  background: transparent;
  background-image: var(--zzz-tex-dots);
  background-size: 14px 14px;
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

.wengine-base-hint {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
}

.wengine-base-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.45rem;
  margin-bottom: 0.65rem;
}

.wengine-stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
}

.wengine-stat-label {
  font-size: 0.72rem;
  color: #9aa3b0;
}

.wengine-stat-value {
  font-size: 0.92rem;
  color: #e4e8ef;
  font-weight: 600;
}

.empty-mods {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  color: #7a828f;
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

.calculator-page.theme-light .card {
  border-color: #d5dae3;
  background: linear-gradient(180deg, #ffffff 0%, #f6f8fb 100%);
  color: #1c212a;
}

.calculator-page.theme-light .helper-text,
.calculator-page.theme-light .doc-detail p,
.calculator-page.theme-light .doc-meta,
.calculator-page.theme-light .filter-label,
.calculator-page.theme-light .field span {
  color: #667085;
}

.calculator-page.theme-light .doc-detail {
  border-color: #d5dae3;
  background: #f5f7fa;
  color: #1c212a;
}

.calculator-page.theme-light .doc-note {
  border-color: #e6d7b0;
  background: #fff9ef;
  color: #5c4818;
}

.calculator-page.theme-light .doc-note-label {
  color: #8a6d2e;
}

.calculator-page.theme-light .doc-subtitle {
  color: #1c212a;
}

.calculator-page.theme-light .wengine-stat-item {
  border-color: #d5dae3;
  background: #fff;
}

.calculator-page.theme-light .wengine-stat-label {
  color: #667085;
}

.calculator-page.theme-light .wengine-stat-value {
  color: #1c212a;
}

.calculator-page.theme-light .empty-mods,
.calculator-page.theme-light .wengine-base-hint {
  color: #667085;
}

.calculator-page.theme-light .doc-item {
  border-color: #d5dae3;
  background: #f5f7fa;
  color: #1c212a;
}

.calculator-page.theme-light .doc-item span {
  color: #667085;
}

.calculator-page.theme-light .field input:not(.preset-combo__input),
.calculator-page.theme-light .field select {
  border-color: #d5dae3;
  background: #fff;
  color: #1c212a;
}

.calculator-page.theme-light .chip,
.calculator-page.theme-light .mindscape-tab {
  border-color: #d5dae3;
  background: #f5f7fa;
  color: #1c212a;
}

.calculator-page.theme-light .chip.active,
.calculator-page.theme-light .mindscape-tab.active,
.calculator-page.theme-light .doc-item.active {
  border-color: #c9a55c;
  background: #fff8eb;
  color: #5c4818;
}

@media (max-width: 768px) {
  .calculator-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    height: 100dvh;
  }

  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    grid-column: 1;
    grid-row: 1;
    z-index: 1;
    padding: 0.55rem 0.75rem;
    padding-top: max(0.55rem, env(safe-area-inset-top));
    border-bottom: 1px solid #25282e;
    background: #121419;
  }

  .calculator-page.theme-light .mobile-topbar {
    border-bottom-color: #d8dde5;
    background: #f7f8fa;
  }

  .mobile-menu-btn {
    flex-shrink: 0;
    min-height: 2.4rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid #2a2d33;
    border-radius: 8px;
    background: #171a1f;
    color: #e9eaec;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .calculator-page.theme-light .mobile-menu-btn {
    border-color: #d0d5dd;
    background: #fff;
    color: #2d3440;
  }

  .mobile-topbar-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .mobile-topbar-text strong {
    font-size: 0.92rem;
    line-height: 1.2;
  }

  .mobile-topbar-text span {
    font-size: 0.75rem;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1190;
    border: none;
    padding: 0;
    margin: 0;
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1200;
    width: min(288px, 86vw);
    height: 100dvh;
    border-right: 1px solid #25282e;
    box-shadow: 8px 0 28px rgba(0, 0, 0, 0.35);
    transform: translateX(-105%);
    transition: transform 0.22s ease;
    padding-top: max(1rem, env(safe-area-inset-top));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .sidebar-btn {
    min-height: 2.65rem;
    font-size: 0.9rem;
  }

  .damage-subnav-btn {
    min-height: 2.2rem;
    font-size: 0.8rem;
  }

  .content {
    grid-column: 1;
    grid-row: 2;
    min-height: 0;
    padding: 0.65rem 0.6rem 1rem;
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
    -webkit-overflow-scrolling: touch;
  }

  .card {
    padding: 0.75rem;
  }

  .card h2 {
    font-size: 1.05rem;
  }

  .grid.four,
  .doc-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .doc-grid {
    gap: 0.4rem;
  }

  .doc-item {
    padding: 0.4rem;
  }

  .mindscape-tabs {
    gap: 0.35rem;
  }

  .mindscape-tab,
  .chip {
    min-height: 2rem;
  }

  .grid.four,
  .compact-grid {
    grid-template-columns: 1fr;
  }

  .field input,
  .field select {
    width: 100%;
    min-width: 0;
    min-height: 2.4rem;
    font-size: 0.9rem;
  }

  .doc-detail {
    padding: 0.6rem;
  }

  .helper-text {
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .damage-subnav-wrap {
    margin-left: 0.25rem;
  }
}

@media (max-width: 480px) {
  .grid.four,
  .doc-grid {
    grid-template-columns: 1fr;
  }
}
</style>
