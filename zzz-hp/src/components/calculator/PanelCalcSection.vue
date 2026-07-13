<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AdminBuffStatFieldGrid from '@/components/admin/calculator/AdminBuffStatFieldGrid.vue'
import AdminImagePicker from '@/components/admin/AdminImagePicker.vue'
import BuffModSourcesDisplay from '@/components/calculator/BuffModSourcesDisplay.vue'
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, BangbooBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { DamageCalcPanelSnapshot } from '@/types/damageCalcHistory'
import {
  createDefaultExternalPanel,
  createDefaultAffixDriveDiscMainStats,
  createEmptyAffixCounts,
  type PanelCalcMode,
  type PanelStats,
} from '@/types/calculatorPanel'
import {
  AFFIX_COUNT_FIELDS,
  computeExternalPanelFromAffixes,
} from '@/utils/affixPanelCalc'
import {
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
  AFFIX_DRIVE_DISC_SLOT_1_HP,
  AFFIX_DRIVE_DISC_SLOT_2_ATK,
} from '@/utils/affixDriveDiscConfig'
import {
  BUFF_STAT_FIELDS,
  buffStatFieldLabel,
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
  createEmptyWengineAdvancedStats,
  getMindscapeNotesUpToRank,
} from '@/utils/calculatorUi'
import { computeFinalPanel } from '@/utils/panelBuffCalc'
import { computeDamageResult, type EnemyResistanceType } from '@/utils/damageCalc'
import { buildAtkPanelProcessItems, buildEnemyCombatProcessItems, buildStatSourceGroups, type StatSourceGroup } from '@/utils/statSourceTips'

type BaseDamageSource = 'atk' | 'pierce'

const MB_PROFESSION = '命破'
const PANEL_FIELDS: { key: keyof PanelStats; label: string }[] = [
  { key: 'hp', label: '生命值' },
  { key: 'atk', label: '攻击力' },
  { key: 'critRate', label: '暴击率%' },
  { key: 'critDmg', label: '暴伤%' },
  { key: 'dmgBonus', label: '增伤%' },
  { key: 'ignoreDefense', label: '无视防御%' },
  { key: 'reduceDefense', label: '减防%' },
  { key: 'penRate', label: '穿透率%' },
  { key: 'pen', label: '穿透值' },
  { key: 'resPen', label: '抗穿%' },
  { key: 'mastery', label: '精通' },
  { key: 'anomalyCritRate', label: '异常暴击%' },
  { key: 'anomalyCritDmg', label: '异常爆伤%' },
  { key: 'anomalyDmgBonus', label: '异常增伤%' },
  { key: 'directDmgMult', label: '直伤倍率%' },
  { key: 'anomalyMult', label: '异常倍率%' },
  { key: 'disorderBaseMult', label: '紊乱基础倍率%' },
  { key: 'anomalyDuration', label: '异常持续时间(s)' },
  { key: 'disorderCompMult', label: '紊乱补偿倍率%' },
  { key: 'turbulenceBaseMult', label: '乱流基础倍率%' },
  { key: 'turbulenceCompMult', label: '乱流补偿倍率%' },
  { key: 'disorderDmgBonus', label: '紊乱增伤%' },
  { key: 'turbulenceDmgBonus', label: '乱流增伤%' },
]

/** 局外初始面板不展示异常/紊乱/乱流增伤及异常暴击（仍参与局内计算） */
const EXTERNAL_PANEL_FIELDS = PANEL_FIELDS.filter(
  (field) =>
    field.key !== 'anomalyCritRate' &&
    field.key !== 'anomalyCritDmg' &&
    field.key !== 'anomalyDmgBonus' &&
    field.key !== 'disorderDmgBonus' &&
    field.key !== 'turbulenceDmgBonus',
)

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboos: BangbooBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  selectedBangbooId: string
  bangbooRefine: number
  calcMode: PanelCalcMode
}>()

const emptyBangboo: BangbooBuffDoc = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}

const panelImageUrl = ref('')
const panelImageName = ref('')
const baseDamageSource = ref<BaseDamageSource>('atk')
const showDetailedResults = ref(false)
const externalPanel = reactive<PanelStats>(createDefaultExternalPanel())
const affixCounts = reactive(createEmptyAffixCounts())
const affixDriveDiscMainStats = reactive(createDefaultAffixDriveDiscMainStats())
const extraMods = reactive(createEmptyBuffStatModifiers())

const enemyInput = reactive({
  defense: 953,
  resistanceType: 'normal' as EnemyResistanceType,
  vulnerableMultiplier: 1,
  staggerMultiplier: 1,
  specialMultiplier: 1,
  level: 60,
})

const mainSlotIndex = computed(() => {
  const index = props.teamSlots.findIndex((slot) => slot.isMainC)
  return index >= 0 ? index : 0
})

const mainSlot = computed(() => props.teamSlots[mainSlotIndex.value]!)

const mainAgent = computed(() =>
  props.agents.find((item) => item.id === mainSlot.value.agentId),
)

const mainWengine = computed(() => {
  const id = mainSlot.value.wengineId
  if (!id || id === 'none') return null
  return props.wengines.find((item) => item.id === id) ?? null
})

const derivedExternalPanel = computed(() =>
  computeExternalPanelFromAffixes({
    agentBase: mainAgent.value?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: mainWengine.value?.baseAtk ?? 0,
    wengineAdvanced: mainWengine.value?.advancedStats ?? createEmptyWengineAdvancedStats(),
    affixCounts,
    driveDiscSelection: {
      twoPieceDriveDiscId: mainSlot.value.twoPieceDriveDiscId,
      fourPieceDriveDiscId: mainSlot.value.fourPieceDriveDiscId,
    },
    driveDiscMainStats: affixDriveDiscMainStats,
    driveDiscs: props.driveDiscs,
  }),
)

function driveDiscNameById(id: string) {
  if (!id || id === 'none') return null
  return props.driveDiscs.find((item) => item.id === id)?.name ?? null
}

const mainDriveDiscSummary = computed(() => {
  const slot = mainSlot.value
  const fourName = driveDiscNameById(slot.fourPieceDriveDiscId)
  const twoName = driveDiscNameById(slot.twoPieceDriveDiscId)
  const parts: string[] = []
  if (fourName) parts.push(`4件：${fourName}`)
  if (twoName && twoName !== fourName) parts.push(`2件：${twoName}`)
  return parts.length ? parts.join(' · ') : '未选择（请在上方驱动盘区为主C选择）'
})

const effectiveExternalPanel = computed<PanelStats>(() =>
  props.calcMode === 'affix' ? derivedExternalPanel.value : externalPanel,
)

const isAffixMode = computed(() => props.calcMode === 'affix')

const isMbMainAgent = computed(() => mainAgent.value?.profession === MB_PROFESSION)

const selectedBangboo = computed(
  () =>
    props.bangboos.find((item) => item.id === props.selectedBangbooId) ??
    props.bangboos.find((item) => item.id === 'none') ??
    emptyBangboo,
)

const effectiveBaseDamageSource = computed<BaseDamageSource>(() =>
  isMbMainAgent.value ? 'pierce' : baseDamageSource.value,
)

const panelBreakdown = computed(() =>
  computeFinalPanel(effectiveExternalPanel.value, {
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscs: props.driveDiscs,
    extraMods,
  }),
)

const finalPanel = computed(() => panelBreakdown.value.finalPanel)

function round(v: number, p = 2) {
  const f = 10 ** p
  return Math.round(v * f) / f
}

function formatNumber(v: number) {
  return Math.round(v).toLocaleString('en-US')
}

function formatFormulaNumber(v: number, precision = 4) {
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v) || Math.abs(v) >= 1000) {
    return round(v, Math.abs(v) >= 1000 ? 2 : 0).toLocaleString('en-US')
  }
  const text = round(v, precision).toString()
  return text.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

function formatPanelValue(key: keyof PanelStats | 'pierce', value: number) {
  if (
    key === 'hp' ||
    key === 'atk' ||
    key === 'pen' ||
    key === 'mastery' ||
    key === 'pierce' ||
    key === 'anomalyDuration'
  ) {
    return formatNumber(value)
  }
  return round(value, 2)
}

function computePiercePower(hp: number, atk: number, pierceMod = 0) {
  return round(0.1 * hp + 0.3 * atk + pierceMod, 2)
}

const externalPiercePower = computed(() =>
  computePiercePower(effectiveExternalPanel.value.hp, effectiveExternalPanel.value.atk),
)

function onUploadPanelImage(file: File | null) {
  if (panelImageUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(panelImageUrl.value)
  }
  if (!file) {
    panelImageUrl.value = ''
    panelImageName.value = ''
    return
  }
  panelImageUrl.value = URL.createObjectURL(file)
  panelImageName.value = file.name
}

watch(
  isMbMainAgent,
  (isMb) => {
    if (isMb) {
      baseDamageSource.value = 'pierce'
    }
  },
  { immediate: true },
)

watch(
  () => mainAgent.value?.id,
  () => {
    if (!mainAgent.value || isAffixMode.value) return
    const base = mainAgent.value.basePanel
    externalPanel.directDmgMult = base.directDmgMult
    externalPanel.anomalyMult = base.anomalyMult
    externalPanel.anomalyCritRate = base.anomalyCritRate
    externalPanel.anomalyCritDmg = base.anomalyCritDmg
    externalPanel.anomalyDmgBonus = base.anomalyDmgBonus
    externalPanel.disorderBaseMult = base.disorderBaseMult
    externalPanel.anomalyDuration = base.anomalyDuration
    externalPanel.disorderCompMult = base.disorderCompMult
    externalPanel.turbulenceBaseMult = base.turbulenceBaseMult
    externalPanel.turbulenceCompMult = base.turbulenceCompMult
    externalPanel.disorderDmgBonus = base.disorderDmgBonus
    externalPanel.turbulenceDmgBonus = base.turbulenceDmgBonus
  },
  { immediate: true },
)

const piercePower = computed(() =>
  computePiercePower(
    finalPanel.value.hp,
    finalPanel.value.atk,
    panelBreakdown.value.totalMods.pierce,
  ),
)

const calcParts = computed(() =>
  computeDamageResult({
    finalPanel: finalPanel.value,
    piercePower: piercePower.value,
    baseDamageSource: effectiveBaseDamageSource.value,
    isMbMainAgent: isMbMainAgent.value,
    enemyInput,
    combatVulnerable: panelBreakdown.value.combatMods.vulnerable,
    combatStaggerVulnerable: panelBreakdown.value.combatMods.staggerVulnerable,
    combatSpecial: panelBreakdown.value.combatMods.special,
    mainAgentElement: mainAgent.value?.element ?? '',
    mainAgentId: mainAgent.value?.id ?? '',
    mainAgentName: mainAgent.value?.name ?? '',
  }),
)

const generalFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatFormulaNumber(p.baseDamage, 2),
    formatFormulaNumber(p.dmgMultiplier),
    formatFormulaNumber(p.defenseMultiplier),
    formatFormulaNumber(p.resistanceMultiplier),
    formatFormulaNumber(p.vulnerableMultiplier),
    formatFormulaNumber(p.staggerMultiplier),
  ]
})

const directFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.critMultiplier),
    formatFormulaNumber(p.specialMultiplier),
    formatFormulaNumber(p.directDmgMultZone),
  ]
})

const anomalyFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.masteryZone),
    formatFormulaNumber(p.levelZone),
  ]
})

const anomalyExpectedFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.anomalyDmgBonusZone),
    formatFormulaNumber(p.anomalyMultZone),
    formatFormulaNumber(p.anomalyCritZone),
  ]
})

const disorderFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.disorderZone),
    formatFormulaNumber(p.disorderDmgBonusZone),
  ]
})

const turbulenceFormulaParts = computed(() => {
  const p = calcParts.value
  const parts = [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.turbulenceZone),
    formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
  ]
  if (p.turbulenceUsesAnomalyCrit) {
    parts.push(formatFormulaNumber(p.anomalyCritZone))
  }
  return parts
})

type ValueTipsKey =
  | 'baseDamage'
  | 'dmgMultiplier'
  | 'defenseMultiplier'
  | 'resistanceMultiplier'
  | 'vulnerableMultiplier'
  | 'staggerMultiplier'
  | 'generalMultiplier'
  | 'critMultiplier'
  | 'specialMultiplier'
  | 'directDmgMultZone'
  | 'masteryZone'
  | 'levelZone'
  | 'anomalyBaseExpected'
  | 'anomalyDmgBonusZone'
  | 'anomalyMultZone'
  | 'anomalyCritZone'
  | 'disorderZone'
  | 'disorderDmgBonusZone'
  | 'turbulenceZone'
  | 'turbulenceDmgBonusZone'
  | 'turbulenceCombinedDmgBonusZone'

interface AlignedFormulaTerm {
  label: string
  value: string
  tipsKey: ValueTipsKey
}

type AlignedFormulaResultKey =
  | 'generalMultiplier'
  | 'directDamageExpected'
  | 'anomalyBaseExpected'
  | 'anomalyExpected'
  | 'disorderExpected'
  | 'turbulenceExpected'

const alignedGeneralFormula = computed(() => {
  const p = calcParts.value
  return {
    key: 'generalMultiplier' as AlignedFormulaResultKey,
    title: '公式',
    terms: [
      { label: '基础伤害', value: formatFormulaNumber(p.baseDamage, 2), tipsKey: 'baseDamage' },
      { label: '增伤区', value: formatFormulaNumber(p.dmgMultiplier), tipsKey: 'dmgMultiplier' },
      { label: '防御区', value: formatFormulaNumber(p.defenseMultiplier), tipsKey: 'defenseMultiplier' },
      { label: '抗性区', value: formatFormulaNumber(p.resistanceMultiplier), tipsKey: 'resistanceMultiplier' },
      { label: '易伤区', value: formatFormulaNumber(p.vulnerableMultiplier), tipsKey: 'vulnerableMultiplier' },
      { label: '失衡易伤区', value: formatFormulaNumber(p.staggerMultiplier), tipsKey: 'staggerMultiplier' },
    ] satisfies AlignedFormulaTerm[],
    result: formatNumber(p.generalMultiplier),
  }
})

const alignedDirectFormula = computed(() => {
  const p = calcParts.value
  return {
    key: 'directDamageExpected' as AlignedFormulaResultKey,
    title: '公式',
    terms: [
      { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
      { label: '暴击区', value: formatFormulaNumber(p.critMultiplier), tipsKey: 'critMultiplier' },
      { label: '特殊乘区', value: formatFormulaNumber(p.specialMultiplier), tipsKey: 'specialMultiplier' },
      { label: '直伤倍率区', value: formatFormulaNumber(p.directDmgMultZone), tipsKey: 'directDmgMultZone' },
    ] satisfies AlignedFormulaTerm[],
    result: formatNumber(p.directDamageExpected),
  }
})

const alignedAnomalyFormulas = computed(() => {
  const p = calcParts.value
  return [
    {
      key: 'anomalyBaseExpected' as AlignedFormulaResultKey,
      title: '异常基础',
      hint: '（不含异常增伤/倍率/暴击）',
      terms: [
        { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
        { label: '精通区', value: formatFormulaNumber(p.masteryZone), tipsKey: 'masteryZone' },
        { label: '等级区', value: formatFormulaNumber(p.levelZone), tipsKey: 'levelZone' },
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.anomalyBaseExpected),
    },
    {
      key: 'anomalyExpected' as AlignedFormulaResultKey,
      title: '异常期望',
      terms: [
        { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
        { label: '异常增伤区', value: formatFormulaNumber(p.anomalyDmgBonusZone), tipsKey: 'anomalyDmgBonusZone' },
        { label: '异常倍率区', value: formatFormulaNumber(p.anomalyMultZone), tipsKey: 'anomalyMultZone' },
        { label: '异常暴击区', value: formatFormulaNumber(p.anomalyCritZone), tipsKey: 'anomalyCritZone' },
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.anomalyExpected),
    },
    {
      key: 'disorderExpected' as AlignedFormulaResultKey,
      title: '紊乱期望',
      terms: [
        { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
        { label: '紊乱倍率区', value: formatFormulaNumber(p.disorderZone), tipsKey: 'disorderZone' },
        { label: '紊乱增伤区', value: formatFormulaNumber(p.disorderDmgBonusZone), tipsKey: 'disorderDmgBonusZone' },
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.disorderExpected),
    },
    {
      key: 'turbulenceExpected' as AlignedFormulaResultKey,
      title: '乱流期望',
      terms: [
        { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
        { label: '乱流倍率区', value: formatFormulaNumber(p.turbulenceZone), tipsKey: 'turbulenceZone' },
        {
          label: '乱流增伤区+异常增伤区',
          value: formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
          tipsKey: 'turbulenceCombinedDmgBonusZone',
        },
        ...(p.turbulenceUsesAnomalyCrit
          ? [
              {
                label: '异常暴击区',
                value: formatFormulaNumber(p.anomalyCritZone),
                tipsKey: 'anomalyCritZone' as ValueTipsKey,
              },
            ]
          : []),
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.turbulenceExpected),
    },
  ]
})

function formatSigned(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
}

function withTotal(groups: StatSourceGroup[], totalText: string, processItems?: string[]): StatSourceGroup[] {
  const result = [...groups]
  if (processItems?.length) {
    result.push({ label: '加减过程', items: processItems, fullWidth: true })
  }
  if (!result.length) {
    return [{ label: '合计', items: [totalText] }]
  }
  return [...result, { label: '合计', items: [totalText], fullWidth: true }]
}

const valueTips = computed(() => {
  const p = calcParts.value
  const panel = finalPanel.value
  const external = effectiveExternalPanel.value
  const sources = panelBreakdown.value.sources
  const combat = panelBreakdown.value.combatMods
  const enemy = enemyInput
  const pierceMod = panelBreakdown.value.totalMods.pierce

  const atkGroups = buildStatSourceGroups({
    keys: ['inCombatAtkPercent', 'atk'],
    externalPanel: external,
    sources,
    externalKeyMap: { inCombatAtkPercent: null, atk: null },
    extraGroups: external.atk
      ? [{ label: '局外面板', items: [`攻击力 ${formatFormulaNumber(external.atk, 2)}`] }]
      : [],
  })

  const hpGroups = buildStatSourceGroups({
    keys: ['inCombatHpPercent'],
    externalPanel: external,
    sources,
    externalKeyMap: { inCombatHpPercent: null },
    extraGroups: external.hp
      ? [{ label: '局外面板', items: [`生命值 ${formatFormulaNumber(external.hp, 2)}`] }]
      : [],
  })

  const pierceGroups = buildStatSourceGroups({
    keys: ['pierce'],
    externalPanel: external,
    sources,
    externalKeyMap: { pierce: null },
  })

  const atkProcessItems = buildAtkPanelProcessItems({
    externalAtk: external.atk,
    finalAtk: panel.atk,
    sources,
  })

  return {
    baseDamage:
      p.baseDamageSource === 'atk'
        ? withTotal(
            atkGroups,
            `局内攻击力 ${formatFormulaNumber(panel.atk, 2)}`,
            atkProcessItems,
          )
        : withTotal(
            [
              ...hpGroups.map((group) => ({
                ...group,
                items: group.items.map((item) => `生命：${item}`),
              })),
              ...atkGroups.map((group) => ({
                ...group,
                items: group.items.map((item) => `攻击：${item}`),
              })),
              ...pierceGroups,
            ],
            `贯穿力 ${formatFormulaNumber(piercePower.value, 2)} = 0.1×${formatFormulaNumber(panel.hp, 2)} + 0.3×${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)}`,
            [
              ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
              `贯穿力 = 0.1 × ${formatFormulaNumber(panel.hp, 2)} + 0.3 × ${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)} = ${formatFormulaNumber(piercePower.value, 2)}`,
            ],
          ),
    dmgMultiplier: withTotal(
      buildStatSourceGroups({
        keys: ['dmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { dmgBonus: panel.dmgBonus },
      }),
      `局内增伤 ${formatFormulaNumber(panel.dmgBonus, 2)}% → 增伤区 1 + ${formatFormulaNumber(panel.dmgBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`,
    ),
    defenseMultiplier: isMbMainAgent.value
      ? [{ label: '命破主C', items: ['防御区固定为 1'] }]
      : withTotal(
          buildStatSourceGroups({
            keys: ['reduceDefense', 'penRate'],
            externalPanel: external,
            sources,
            finalValues: { reduceDefense: panel.reduceDefense, penRate: panel.penRate },
            extraGroups: [
              {
                label: '敌方与环境 / 局外面板',
                items: [
                  `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
                  `无视防御 ${formatFormulaNumber(external.ignoreDefense, 2)}%`,
                  `穿透值 ${formatFormulaNumber(external.pen, 2)}`,
                ],
              },
            ],
            showAdditiveProcess: false,
          }),
          `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)} → 防御区 794 / (794 + ${formatFormulaNumber(p.effectiveDefense, 2)}) = ${formatFormulaNumber(p.defenseMultiplier)}`,
          [
            `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
            `794 / (794 + ${formatFormulaNumber(p.effectiveDefense, 2)}) = ${formatFormulaNumber(p.defenseMultiplier)}`,
          ],
        ),
    resistanceMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`敌方抗性 ${formatFormulaNumber(p.enemyResistance)}`],
        },
        ...buildStatSourceGroups({
          keys: ['resPen'],
          externalPanel: external,
          sources,
          finalValues: { resPen: panel.resPen },
          showAdditiveProcess: false,
        }),
      ],
      `抗性区 1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(panel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      [
        `敌方抗性 ${formatFormulaNumber(p.enemyResistance)}`,
        ...(panel.resPen || sources.some((s) => s.mods.resPen)
          ? [
              `局内抗穿 ${formatFormulaNumber(panel.resPen, 2)}%`,
              ...sources
                .filter((s) => s.mods.resPen)
                .map((s) => `${s.label} ${formatSigned(s.mods.resPen)}%`),
            ]
          : []),
        `1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(panel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      ],
    ),
    vulnerableMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`易伤基础 ${formatFormulaNumber(enemy.vulnerableMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['vulnerable'],
          externalPanel: external,
          sources,
          externalKeyMap: { vulnerable: null },
          showAdditiveProcess: false,
        }),
      ],
      `易伤区 ${formatFormulaNumber(p.vulnerableMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '易伤基础',
        baseValue: enemy.vulnerableMultiplier,
        sources,
        buffKey: 'vulnerable',
        finalValue: p.vulnerableMultiplier,
        resultLabel: '易伤区',
      }),
    ),
    staggerMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`失衡易伤基础 ${formatFormulaNumber(enemy.staggerMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['staggerVulnerable'],
          externalPanel: external,
          sources,
          externalKeyMap: { staggerVulnerable: null },
          showAdditiveProcess: false,
        }),
      ],
      `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '失衡易伤基础',
        baseValue: enemy.staggerMultiplier,
        sources,
        buffKey: 'staggerVulnerable',
        finalValue: p.staggerMultiplier,
        resultLabel: '失衡易伤区',
      }),
    ),
    generalMultiplier: [
      {
        label: '乘区组成',
        items: [
          `基础伤害 ${generalFormulaParts.value[0]}`,
          `增伤区 ${generalFormulaParts.value[1]}`,
          `防御区 ${generalFormulaParts.value[2]}`,
          `抗性区 ${generalFormulaParts.value[3]}`,
          `易伤区 ${generalFormulaParts.value[4]}`,
          `失衡易伤区 ${generalFormulaParts.value[5]}`,
          `合计 ${formatNumber(p.generalMultiplier)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${generalFormulaParts.value[0]} × ${generalFormulaParts.value[1]} × ${generalFormulaParts.value[2]} × ${generalFormulaParts.value[3]} × ${generalFormulaParts.value[4]} × ${generalFormulaParts.value[5]}`,
          `= ${formatNumber(p.generalMultiplier)}`,
        ],
      },
    ],
    critRateRatio: withTotal(
      buildStatSourceGroups({
        keys: ['critRate'],
        externalPanel: external,
        sources,
        finalValues: { critRate: panel.critRate },
      }),
      `局内暴击 ${formatFormulaNumber(panel.critRate, 2)}% = ${formatFormulaNumber(p.critRateRatio)}（计入上限）`,
    ),
    critMultiplier: withTotal(
      buildStatSourceGroups({
        keys: ['critRate', 'critDmg'],
        externalPanel: external,
        sources,
        finalValues: { critRate: panel.critRate, critDmg: panel.critDmg },
      }),
      `暴击区 1 + ${formatFormulaNumber(p.critRateRatio)} × ${formatFormulaNumber(p.critDmgRatio)} = ${formatFormulaNumber(p.critMultiplier)}`,
    ),
    specialMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`特殊乘区基础 ${formatFormulaNumber(enemy.specialMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['special'],
          externalPanel: external,
          sources,
          externalKeyMap: { special: null },
          showAdditiveProcess: false,
        }),
      ],
      `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '特殊乘区基础',
        baseValue: enemy.specialMultiplier,
        sources,
        buffKey: 'special',
        finalValue: p.specialMultiplier,
        resultLabel: '特殊乘区',
      }),
    ),
    directDmgMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['directDmgMult'],
        externalPanel: external,
        sources,
        finalValues: { directDmgMult: panel.directDmgMult },
      }),
      `直伤倍率区 ${formatFormulaNumber(panel.directDmgMult, 2)}% = ${formatFormulaNumber(p.directDmgMultZone)}`,
    ),
    penRateRatio: withTotal(
      buildStatSourceGroups({
        keys: ['penRate'],
        externalPanel: external,
        sources,
        finalValues: { penRate: panel.penRate },
      }),
      `局内穿透率 ${formatFormulaNumber(panel.penRate, 2)}% = ${formatFormulaNumber(p.penRateRatio)}（计入上限）`,
    ),
    effectiveDefense: withTotal(
      buildStatSourceGroups({
        keys: ['reduceDefense', 'penRate'],
        externalPanel: external,
        sources,
        finalValues: { reduceDefense: panel.reduceDefense, penRate: panel.penRate },
        extraGroups: [
          {
            label: '敌方与环境 / 局外面板',
            items: [
              `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
              `无视防御 ${formatFormulaNumber(external.ignoreDefense, 2)}%`,
              `穿透值 ${formatFormulaNumber(external.pen, 2)}`,
            ],
          },
        ],
        showAdditiveProcess: false,
      }),
      `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      [
        `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
        `无视防御 ${formatFormulaNumber(external.ignoreDefense, 2)}%`,
        `减防 ${formatFormulaNumber(panel.reduceDefense, 2)}%`,
        `穿透率 ${formatFormulaNumber(panel.penRate, 2)}%`,
        `穿透值 ${formatFormulaNumber(external.pen, 2)}`,
        `防御因子 ${formatFormulaNumber(p.defenseFactor)}`,
        `折后防御 ${formatFormulaNumber(enemy.defense * p.defenseFactor * (1 - p.penRateRatio), 2)}`,
        `折后防御 - 穿透值 = ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      ],
    ),
    piercePower: withTotal(
      [
        ...hpGroups.map((group) => ({
          ...group,
          items: group.items.map((item) => `生命：${item}`),
        })),
        ...atkGroups.map((group) => ({
          ...group,
          items: group.items.map((item) => `攻击：${item}`),
        })),
        ...pierceGroups,
      ],
      `贯穿力 ${formatFormulaNumber(piercePower.value, 2)} = 0.1×${formatFormulaNumber(panel.hp, 2)} + 0.3×${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)}`,
      [
        ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
        `贯穿力 = 0.1 × ${formatFormulaNumber(panel.hp, 2)} + 0.3 × ${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)} = ${formatFormulaNumber(piercePower.value, 2)}`,
      ],
    ),
    directDamageExpected: [
      {
        label: '乘区组成',
        items: [
          `通用乘区 ${directFormulaParts.value[0]}`,
          `暴击区 ${directFormulaParts.value[1]}`,
          `特殊乘区 ${directFormulaParts.value[2]}`,
          `直伤倍率区 ${directFormulaParts.value[3]}`,
          `合计 ${formatNumber(p.directDamageExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${directFormulaParts.value[0]} × ${directFormulaParts.value[1]} × ${directFormulaParts.value[2]} × ${directFormulaParts.value[3]}`,
          `= ${formatNumber(p.directDamageExpected)}`,
        ],
      },
    ],
    masteryZone: withTotal(
      buildStatSourceGroups({
        keys: ['mastery'],
        externalPanel: external,
        sources,
        finalValues: { mastery: panel.mastery },
      }),
      `精通区 ${formatFormulaNumber(panel.mastery, 2)} → ${formatFormulaNumber(p.masteryZone)}`,
    ),
    levelZone: [
      {
        label: '敌方与环境',
        items: [
          `代理人等级 ${Math.round(enemy.level)}`,
          `等级区 ${formatFormulaNumber(p.levelZone)} = 1 + (${Math.round(enemy.level)} - 1) / 59`,
        ],
      },
    ],
    anomalyDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyDmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { anomalyDmgBonus: panel.anomalyDmgBonus },
      }),
      `异常增伤区 1 + ${formatFormulaNumber(panel.anomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
    ),
    anomalyMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyMult'],
        externalPanel: external,
        sources,
        finalValues: { anomalyMult: panel.anomalyMult },
      }),
      `异常倍率区 ${formatFormulaNumber(panel.anomalyMult, 2)}% = ${formatFormulaNumber(p.anomalyMultZone)}`,
    ),
    anomalyCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyCritRate', 'anomalyCritDmg'],
        externalPanel: external,
        sources,
        finalValues: {
          anomalyCritRate: panel.anomalyCritRate,
          anomalyCritDmg: panel.anomalyCritDmg,
        },
      }),
      `异常暴击区 1 + ${formatFormulaNumber(p.anomalyCritRateRatio)} × ${formatFormulaNumber(p.anomalyCritDmgRatio)} = ${formatFormulaNumber(p.anomalyCritZone)}`,
    ),
    anomalyBaseExpected: [
      {
        label: '乘区组成（不含异常增伤/倍率/暴击）',
        items: [
          `通用乘区 ${anomalyFormulaParts.value[0]}`,
          `精通区 ${anomalyFormulaParts.value[1]}`,
          `等级区 ${anomalyFormulaParts.value[2]}`,
          `合计 ${formatNumber(p.anomalyBaseExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${anomalyFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.anomalyBaseExpected)}`,
        ],
      },
    ],
    anomalyExpected: [
      {
        label: '乘区组成（含异常增伤/倍率/暴击）',
        items: [
          `异常基础期望 ${anomalyExpectedFormulaParts.value[0]}`,
          `异常增伤区 ${anomalyExpectedFormulaParts.value[1]}`,
          `异常倍率区 ${anomalyExpectedFormulaParts.value[2]}`,
          `异常暴击区 ${anomalyExpectedFormulaParts.value[3]}`,
          `合计 ${formatNumber(p.anomalyExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${anomalyExpectedFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.anomalyExpected)}`,
        ],
      },
    ],
    disorderBaseMult: withTotal(
      buildStatSourceGroups({
        keys: ['disorderBaseMult'],
        externalPanel: external,
        sources,
        finalValues: { disorderBaseMult: panel.disorderBaseMult },
      }),
      `紊乱基础倍率 ${formatFormulaNumber(panel.disorderBaseMult, 2)}% = ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
    ),
    anomalyDuration: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyDuration'],
        externalPanel: external,
        sources,
        finalValues: { anomalyDuration: panel.anomalyDuration },
      }),
      `异常持续时间 ${formatFormulaNumber(panel.anomalyDuration, 2)}s → 有效 ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
    ),
    disorderCompMult: withTotal(
      buildStatSourceGroups({
        keys: ['disorderCompMult'],
        externalPanel: external,
        sources,
        finalValues: { disorderCompMult: panel.disorderCompMult },
      }),
      `紊乱补偿倍率 ${formatFormulaNumber(panel.disorderCompMult, 2)}% = ${formatFormulaNumber(p.disorderCompMultRatio)}`,
    ),
    disorderDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['disorderDmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { disorderDmgBonus: panel.disorderDmgBonus },
      }),
      `紊乱增伤区 1 + ${formatFormulaNumber(panel.disorderDmgBonus, 2)}% = ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
    ),
    disorderZone: [
      {
        label: '乘区组成',
        items: [
          `紊乱基础倍率 ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
          `有效异常持续时间 ${formatFormulaNumber(p.effectiveAnomalyDuration)}`,
          `紊乱补偿倍率 ${formatFormulaNumber(p.disorderCompMultRatio)}`,
          `紊乱倍率区 = 基础 + 时间 × 补偿 = ${formatFormulaNumber(p.disorderZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `基础 ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
          `时间项 ${formatFormulaNumber(p.effectiveAnomalyDuration)} × ${formatFormulaNumber(p.disorderCompMultRatio)} = ${formatFormulaNumber(p.effectiveAnomalyDuration * p.disorderCompMultRatio)}`,
          `${formatFormulaNumber(p.disorderBaseMultRatio)} + ${formatFormulaNumber(p.effectiveAnomalyDuration * p.disorderCompMultRatio)} = ${formatFormulaNumber(p.disorderZone)}`,
        ],
      },
    ],
    disorderExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(p.anomalyBaseExpected)}`,
          `紊乱倍率区 ${formatFormulaNumber(p.disorderZone)}`,
          `紊乱增伤区 ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
          `合计 ${formatNumber(p.disorderExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${disorderFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.disorderExpected)}`,
        ],
      },
    ],
    turbulenceBaseMult: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceBaseMult'],
        externalPanel: external,
        sources,
        finalValues: { turbulenceBaseMult: panel.turbulenceBaseMult },
      }),
      `乱流基础倍率 ${formatFormulaNumber(panel.turbulenceBaseMult, 2)}% = ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
    ),
    turbulenceCompMult: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceCompMult'],
        externalPanel: external,
        sources,
        finalValues: { turbulenceCompMult: panel.turbulenceCompMult },
      }),
      `乱流补偿倍率 ${formatFormulaNumber(panel.turbulenceCompMult, 2)}% = ${formatFormulaNumber(p.turbulenceCompMultRatio)}`,
    ),
    turbulenceDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceDmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { turbulenceDmgBonus: panel.turbulenceDmgBonus },
      }),
      `乱流增伤区 1 + ${formatFormulaNumber(panel.turbulenceDmgBonus, 2)}% = ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
    ),
    turbulenceZone: [
      {
        label: '乘区组成',
        items: [
          `乱流基础倍率 ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
          `有效异常持续时间 ${formatFormulaNumber(p.effectiveAnomalyDuration)}`,
          `乱流补偿倍率 ${formatFormulaNumber(p.turbulenceCompMultRatio)}`,
          `乱流倍率区 = 基础 + 时间 × 补偿 = ${formatFormulaNumber(p.turbulenceZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `基础 ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
          `时间项 ${formatFormulaNumber(p.effectiveAnomalyDuration)} × ${formatFormulaNumber(p.turbulenceCompMultRatio)} = ${formatFormulaNumber(p.effectiveAnomalyDuration * p.turbulenceCompMultRatio)}`,
          `${formatFormulaNumber(p.turbulenceBaseMultRatio)} + ${formatFormulaNumber(p.effectiveAnomalyDuration * p.turbulenceCompMultRatio)} = ${formatFormulaNumber(p.turbulenceZone)}`,
        ],
      },
    ],
    turbulenceCombinedDmgBonusZone: [
      {
        label: '乘区组成',
        items: [
          `乱流增伤区 ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
          `异常增伤区 ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
          `乱流增伤区+异常增伤区 ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `1 + ${formatFormulaNumber(panel.turbulenceDmgBonus, 2)}% + ${formatFormulaNumber(panel.anomalyDmgBonus, 2)}%`,
          `= ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
        ],
      },
    ],
    turbulenceExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(p.anomalyBaseExpected)}`,
          `乱流倍率区 ${formatFormulaNumber(p.turbulenceZone)}`,
          `乱流增伤区+异常增伤区 ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
          ...(p.turbulenceUsesAnomalyCrit
            ? [`异常暴击区 ${formatFormulaNumber(p.anomalyCritZone)}`]
            : []),
          `合计 ${formatNumber(p.turbulenceExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${turbulenceFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.turbulenceExpected)}`,
        ],
      },
    ],
  }
})

const teamSummary = computed(() =>
  props.teamSlots
    .map((slot, index) => {
      const agent = props.agents.find((item) => item.id === slot.agentId)
      const wengine = props.wengines.find((item) => item.id === slot.wengineId)
      if (!agent) return null
      return `槽位${index + 1} ${agent.name} / ${wengine?.name ?? '未选音擎'} / ${slot.rank}影 / 精${slot.wengineRefine}`
    })
    .filter(Boolean)
    .join('；'),
)

const teamAgentNotes = computed(() =>
  props.teamSlots
    .map((slot, index) => {
      if (!slot.agentId) return null
      const agent = props.agents.find((item) => item.id === slot.agentId)
      if (!agent) return null
      const roleLabel = slot.isMainC ? '主C' : `槽位${index + 1}`
      const note = agent.note?.trim() ?? ''
      const mindscapeNotes = getMindscapeNotesUpToRank(agent, slot.rank)
      return {
        key: `${index}-${agent.id}`,
        label: `${roleLabel} · ${agent.name}（${slot.rank}影）`,
        note,
        mindscapeNotes,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null),
)

const teamWengineNotes = computed(() =>
  props.teamSlots
    .map((slot, index) => {
      if (!slot.agentId || !slot.wengineId || slot.wengineId === 'none') return null
      const agent = props.agents.find((item) => item.id === slot.agentId)
      const wengine = props.wengines.find((item) => item.id === slot.wengineId)
      if (!agent || !wengine) return null
      const note = wengine.note?.trim() ?? ''
      if (!note) return null
      const roleLabel = slot.isMainC ? '主C' : `槽位${index + 1}`
      return {
        key: `${index}-${wengine.id}`,
        label: `${roleLabel} · ${agent.name} · ${wengine.name}（精${slot.wengineRefine}）`,
        note,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null),
)

function getSnapshot(): DamageCalcPanelSnapshot {
  return {
    baseDamageSource: baseDamageSource.value,
    externalPanel: { ...externalPanel },
    affixCounts: { ...affixCounts },
    affixDriveDiscMainStats: { ...affixDriveDiscMainStats },
    extraMods: { ...extraMods },
    enemyInput: { ...enemyInput },
  }
}

function loadSnapshot(snapshot: DamageCalcPanelSnapshot) {
  baseDamageSource.value = snapshot.baseDamageSource
  Object.assign(externalPanel, createDefaultExternalPanel(), snapshot.externalPanel)
  Object.assign(affixCounts, snapshot.affixCounts)
  Object.assign(affixDriveDiscMainStats, snapshot.affixDriveDiscMainStats)
  Object.assign(extraMods, createEmptyBuffStatModifiers(), snapshot.extraMods)
  Object.assign(enemyInput, snapshot.enemyInput)
  if (!Number.isFinite(enemyInput.level) || enemyInput.level < 1) {
    enemyInput.level = 60
  }
}

defineExpose({ getSnapshot, loadSnapshot })
</script>

<template>
  <section id="damage-panel" class="section-card panel-section damage-anchor">
    <header class="section-header">
      <div>
        <h2>面板录入与伤害计算</h2>
        <p class="section-desc">
          {{
            isAffixMode
              ? '录入副词条条数，由角色/音擎基础属性推导局外面板；局内面板与伤害乘区逻辑与面板计算一致。'
              : '录入主C局外面板（初始面板），局内面板由队伍增益、音擎、邦布与额外 Buff 自动汇总。'
          }}
        </p>
      </div>
    </header>

    <p v-if="teamSummary" class="team-summary">{{ teamSummary }}</p>
    <p v-if="isMbMainAgent" class="mb-hint">
      当前主C为命破：基础伤害来源固定为贯穿力，防御区固定为 1。
    </p>

    <details v-if="teamAgentNotes.length" class="team-notes">
      <summary class="team-notes-title">查看队伍角色注释</summary>
      <article v-for="item in teamAgentNotes" :key="item.key" class="team-note-item">
        <p class="team-note-label">{{ item.label }}</p>
        <p v-if="item.note" class="team-note-text">
          <span class="team-note-type">角色注释</span>
          {{ item.note }}
        </p>
        <p
          v-for="mindscapeNote in item.mindscapeNotes"
          :key="`${item.key}-${mindscapeNote.rank}`"
          class="team-note-text"
        >
          <span class="team-note-type">{{ mindscapeNote.rank }}影注释</span>
          {{ mindscapeNote.text }}
        </p>
        <p v-if="!item.note && !item.mindscapeNotes.length" class="team-note-empty">暂无注释</p>
      </article>
    </details>

    <details v-if="teamWengineNotes.length" class="team-notes team-wengine-notes">
      <summary class="team-notes-title">查看队伍音擎注释</summary>
      <article v-for="item in teamWengineNotes" :key="item.key" class="team-note-item">
        <p class="team-note-label">{{ item.label }}</p>
        <p class="team-note-text">
          <span class="team-note-type">音擎注释</span>
          {{ item.note }}
        </p>
      </article>
    </details>

    <div v-if="!isAffixMode" class="upload-box">
      <p class="upload-label">上传角色面板截图</p>
      <AdminImagePicker button-text="选择截图" @change="onUploadPanelImage" />
      <div class="upload-preview">
        <img v-if="panelImageUrl" :src="panelImageUrl" :alt="panelImageName || '面板预览'" />
        <p v-else>选择截图后可在此对照录入局外面板数据。</p>
      </div>
    </div>

    <div class="grid four meta-grid">
      <label class="field">
        <span>基础伤害来源</span>
        <select v-model="baseDamageSource" :disabled="isMbMainAgent">
          <option value="atk">攻击力</option>
          <option value="pierce">贯穿力</option>
        </select>
      </label>
      <label class="field">
        <span>主C槽位</span>
        <input :value="mainSlot.isMainC ? '已标记主C' : '未标记'" type="text" readonly />
      </label>
      <label class="field">
        <span>已选邦布</span>
        <input :value="selectedBangboo.name" type="text" readonly />
      </label>
      <label class="field">
        <span>邦布精炼</span>
        <input :value="`精${bangbooRefine}`" type="text" readonly />
      </label>
    </div>

    <section v-if="isAffixMode" class="panel-block affix-input-block">
      <header class="panel-block-header">
        <h3>驱动盘主属性</h3>
        <p>
          2/4 件套沿用上方主C驱动盘选择（{{ mainDriveDiscSummary }}）；默认 6 盘均为 15 级，1 号
          +{{ AFFIX_DRIVE_DISC_SLOT_1_HP }} 生命、2 号 +{{ AFFIX_DRIVE_DISC_SLOT_2_ATK }} 攻击。请选择
          4/5/6 号盘主属性。
        </p>
      </header>
      <div class="grid four">
        <label class="field">
          <span>4 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot4MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_4_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>5 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot5MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_5_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>6 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot6MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_6_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
    </section>

    <section v-if="isAffixMode" class="panel-block affix-input-block">
      <header class="panel-block-header">
        <h3>词条数</h3>
        <p>
          基于主C角色基础面板、音擎与驱动盘属性计算局外面板；每条副词条按固定数值折算（如生命 +112、攻击 +19、穿透 +9、双暴 +2.4%/+4.8%、精通 +9 等）。
        </p>
      </header>
      <p v-if="!mainAgent" class="affix-hint">请先选择主C角色，以加载其基础面板。</p>
      <div class="grid four">
        <label v-for="field in AFFIX_COUNT_FIELDS" :key="field.key" class="field">
          <span>{{ field.label }}（{{ field.unitLabel }}）</span>
          <input v-model.number="affixCounts[field.key]" type="number" min="0" step="1" />
          <span class="field-hint">每条 +{{ field.perCount }}</span>
        </label>
      </div>
      <div v-if="mainAgent" class="affix-base-summary">
        <p>
          基础来源：{{ mainAgent.name }}（生命 {{ mainAgent.basePanel.hp }} / 攻击
          {{ mainAgent.basePanel.atk }}）
          <template v-if="mainWengine">
            · {{ mainWengine.name }}（音擎攻击 {{ mainWengine.baseAtk }}）
          </template>
        </p>
      </div>
    </section>

    <div class="panel-layout">
      <div class="panel-layout-left">
        <section class="panel-block">
          <header class="panel-block-header">
            <h3>局外面板（初始）</h3>
            <p>
              {{
                isAffixMode
                  ? '由词条数、驱动盘与角色/音擎基础属性自动计算，不含战斗增益。'
                  : '仅展示录入或上传的角色面板数据，不含任何战斗增益。'
              }}
            </p>
          </header>
          <div class="grid four">
            <label v-for="field in EXTERNAL_PANEL_FIELDS" :key="`external-${field.key}`" class="field">
              <span>{{ field.label }}</span>
              <input
                v-if="!isAffixMode"
                v-model.number="externalPanel[field.key]"
                type="number"
                step="any"
              />
              <input
                v-else
                :value="formatPanelValue(field.key, effectiveExternalPanel[field.key])"
                type="text"
                readonly
              />
            </label>
            <label class="field">
              <span>贯穿力</span>
              <input :value="formatPanelValue('pierce', externalPiercePower)" type="text" readonly />
            </label>
          </div>
        </section>

        <section class="panel-block extra-mods-block">
          <header class="panel-block-header">
            <h3>额外 Buff</h3>
            <p>未录入角色/音擎/邦布数据时的补充增益，参与局内面板与乘区汇总。</p>
          </header>
          <AdminBuffStatFieldGrid v-model="extraMods" hint="" />
        </section>
      </div>

      <section class="panel-block panel-block--final panel-layout-right">
        <header class="panel-block-header">
          <h3>局内面板（最终）</h3>
          <p>叠加自身/队友/音擎/邦布/驱动盘/额外 Buff 后的战斗面板，仅展示。</p>
        </header>
        <div class="grid four panel-grid-fill">
          <label v-for="field in PANEL_FIELDS" :key="`final-${field.key}`" class="field">
            <span>{{ field.label }}</span>
            <input
              :value="formatPanelValue(field.key, finalPanel[field.key])"
              type="text"
              readonly
            />
          </label>
          <label class="field">
            <span>贯穿力</span>
            <input :value="formatPanelValue('pierce', piercePower)" type="text" readonly />
          </label>
        </div>
      </section>
    </div>

    <details class="buff-breakdown">
      <summary>查看局内增益汇总数值</summary>
      <ul class="mods-summary">
        <li v-for="field in BUFF_STAT_FIELDS" :key="field.key">
          <span>{{ buffStatFieldLabel(field) }}</span>
          <strong>{{ panelBreakdown.totalMods[field.key] }}</strong>
        </li>
      </ul>
      <BuffModSourcesDisplay :sources="panelBreakdown.sources" />
    </details>

    <h3 class="enemy-title">敌方与环境</h3>
    <div class="grid four">
      <label class="field"><span>敌方防御</span><input v-model.number="enemyInput.defense" type="number" /></label>
      <label class="field">
        <span>敌方抗性</span>
        <select v-model="enemyInput.resistanceType">
          <option value="weak">有弱点（-0.2）</option>
          <option value="normal">无弱点无抗性（0）</option>
          <option value="res20">有抗性（0.2）</option>
          <option value="res40">高抗性（0.4）</option>
        </select>
      </label>
      <label class="field"><span>易伤区（基础）</span><input v-model.number="enemyInput.vulnerableMultiplier" type="number" step="0.01" /></label>
      <label class="field"><span>失衡易伤区（基础）</span><input v-model.number="enemyInput.staggerMultiplier" type="number" step="0.01" /></label>
      <label class="field"><span>特殊乘区（基础）</span><input v-model.number="enemyInput.specialMultiplier" type="number" step="0.01" /></label>
      <label class="field"><span>代理人等级</span><input v-model.number="enemyInput.level" type="number" min="1" max="60" step="1" /></label>
    </div>

    <div class="result-mode-bar">
      <h3 class="enemy-title result-mode-title">伤害结果</h3>
      <label class="detail-mode-toggle">
        <input v-model="showDetailedResults" type="checkbox" />
        <span>显示详细数据</span>
      </label>
    </div>

    <template v-if="!showDetailedResults">
      <div class="result-grid result-grid-summary">
        <p class="result-total">
          直伤期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.directDamageExpected)"
            :groups="valueTips.directDamageExpected"
          />
        </p>
        <p class="result-total">
          异常期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.anomalyExpected)"
            :groups="valueTips.anomalyExpected"
          />
        </p>
        <p class="result-total">
          紊乱期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.disorderExpected)"
            :groups="valueTips.disorderExpected"
          />
        </p>
        <p class="result-total">
          乱流期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.turbulenceExpected)"
            :groups="valueTips.turbulenceExpected"
          />
        </p>
      </div>
    </template>

    <template v-else>
    <h3 class="result-section-title">通用乘区</h3>
    <div class="formula-block formula-block--aligned">
      <div class="formula-aligned-group">
        <span class="formula-label formula-aligned-title">{{ alignedGeneralFormula.title }}</span>
        <div class="formula-aligned-body">
          <template
            v-for="(term, index) in alignedGeneralFormula.terms"
            :key="`general-${term.label}`"
          >
            <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
            <div class="formula-aligned-term">
              <span class="formula-aligned-term-label">{{ term.label }}</span>
              <span class="formula-aligned-term-value">
                <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey]" />
              </span>
            </div>
          </template>
          <span class="formula-aligned-op" aria-hidden="true">=</span>
          <div class="formula-aligned-result">
            <StatValueWithSources
              :value="alignedGeneralFormula.result"
              :groups="valueTips[alignedGeneralFormula.key]"
            />
          </div>
        </div>
      </div>
    </div>
    <div class="result-grid">
      <p>基础伤害（局内）：<StatValueWithSources :value="calcParts.baseDamage" :groups="valueTips.baseDamage" /></p>
      <p>增伤区：<StatValueWithSources :value="calcParts.dmgMultiplier" :groups="valueTips.dmgMultiplier" /></p>
      <p>防御区：<StatValueWithSources :value="calcParts.defenseMultiplier" :groups="valueTips.defenseMultiplier" /></p>
      <p>抗性区：<StatValueWithSources :value="calcParts.resistanceMultiplier" :groups="valueTips.resistanceMultiplier" /></p>
      <p>易伤区（含增益）：<StatValueWithSources :value="calcParts.vulnerableMultiplier" :groups="valueTips.vulnerableMultiplier" /></p>
      <p>失衡易伤区（含增益）：<StatValueWithSources :value="calcParts.staggerMultiplier" :groups="valueTips.staggerMultiplier" /></p>
      <p class="result-subtotal">通用乘区：<StatValueWithSources :value="formatNumber(calcParts.generalMultiplier)" :groups="valueTips.generalMultiplier" /></p>
    </div>

    <h3 class="result-section-title">直伤期望伤害</h3>
    <div class="formula-block formula-block--aligned">
      <div class="formula-aligned-group">
        <span class="formula-label formula-aligned-title">{{ alignedDirectFormula.title }}</span>
        <div class="formula-aligned-body">
          <template
            v-for="(term, index) in alignedDirectFormula.terms"
            :key="`direct-${term.label}`"
          >
            <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
            <div class="formula-aligned-term">
              <span class="formula-aligned-term-label">{{ term.label }}</span>
              <span class="formula-aligned-term-value">
                <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey]" />
              </span>
            </div>
          </template>
          <span class="formula-aligned-op" aria-hidden="true">=</span>
          <div class="formula-aligned-result">
            <StatValueWithSources
              :value="alignedDirectFormula.result"
              :groups="valueTips[alignedDirectFormula.key]"
            />
          </div>
        </div>
      </div>
    </div>
    <div class="result-grid">
      <p>暴击率（计入上限 1）：<StatValueWithSources :value="calcParts.critRateRatio" :groups="valueTips.critRateRatio" /></p>
      <p>暴击区：<StatValueWithSources :value="calcParts.critMultiplier" :groups="valueTips.critMultiplier" /></p>
      <p>特殊乘区（含增益）：<StatValueWithSources :value="calcParts.specialMultiplier" :groups="valueTips.specialMultiplier" /></p>
      <p>直伤倍率区：<StatValueWithSources :value="calcParts.directDmgMultZone" :groups="valueTips.directDmgMultZone" /></p>
      <p>穿透率（计入）：<StatValueWithSources :value="calcParts.penRateRatio" :groups="valueTips.penRateRatio" /></p>
      <p>有效防御项：<StatValueWithSources :value="calcParts.effectiveDefense" :groups="valueTips.effectiveDefense" /></p>
      <p>贯穿力（局内）：<StatValueWithSources :value="formatNumber(piercePower)" :groups="valueTips.piercePower" /></p>
      <p class="result-total">直伤期望伤害：<StatValueWithSources :value="formatNumber(calcParts.directDamageExpected)" :groups="valueTips.directDamageExpected" /></p>
    </div>

    <h3 class="result-section-title">异常 / 紊乱 / 乱流期望伤害</h3>
    <div class="formula-block formula-block--aligned">
      <div
        v-for="group in alignedAnomalyFormulas"
        :key="group.key"
        class="formula-aligned-group"
      >
        <span class="formula-label formula-aligned-title">
          {{ group.title }}
          <span v-if="group.hint" class="formula-aligned-hint">{{ group.hint }}</span>
        </span>
        <div class="formula-aligned-body">
          <template v-for="(term, index) in group.terms" :key="`${group.key}-${term.label}`">
            <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
            <div class="formula-aligned-term">
              <span class="formula-aligned-term-label">{{ term.label }}</span>
              <span class="formula-aligned-term-value">
                <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey]" />
              </span>
            </div>
          </template>
          <span class="formula-aligned-op" aria-hidden="true">=</span>
          <div class="formula-aligned-result">
            <StatValueWithSources :value="group.result" :groups="valueTips[group.key]" />
          </div>
        </div>
      </div>
    </div>
    <div class="result-grid">
      <h4 class="result-subsection-title">异常基础期望</h4>
      <p>精通区：<StatValueWithSources :value="calcParts.masteryZone" :groups="valueTips.masteryZone" /></p>
      <p>等级区：<StatValueWithSources :value="calcParts.levelZone" :groups="valueTips.levelZone" /></p>
      <p class="result-total">异常基础期望：<StatValueWithSources :value="formatNumber(calcParts.anomalyBaseExpected)" :groups="valueTips.anomalyBaseExpected" /></p>

      <h4 class="result-subsection-title">异常期望伤害</h4>
      <p>异常增伤区：<StatValueWithSources :value="calcParts.anomalyDmgBonusZone" :groups="valueTips.anomalyDmgBonusZone" /></p>
      <p>异常倍率区：<StatValueWithSources :value="calcParts.anomalyMultZone" :groups="valueTips.anomalyMultZone" /></p>
      <p>异常暴击区：<StatValueWithSources :value="calcParts.anomalyCritZone" :groups="valueTips.anomalyCritZone" /></p>
      <p class="result-total">异常期望伤害：<StatValueWithSources :value="formatNumber(calcParts.anomalyExpected)" :groups="valueTips.anomalyExpected" /></p>

      <h4 class="result-subsection-title">紊乱期望伤害</h4>
      <p>紊乱基础倍率：<StatValueWithSources :value="calcParts.disorderBaseMultRatio" :groups="valueTips.disorderBaseMult" /></p>
      <p>异常持续时间(有效)：<StatValueWithSources :value="calcParts.effectiveAnomalyDuration" :groups="valueTips.anomalyDuration" /></p>
      <p>紊乱补偿倍率：<StatValueWithSources :value="calcParts.disorderCompMultRatio" :groups="valueTips.disorderCompMult" /></p>
      <p>紊乱倍率区：<StatValueWithSources :value="calcParts.disorderZone" :groups="valueTips.disorderZone" /></p>
      <p>紊乱增伤区：<StatValueWithSources :value="calcParts.disorderDmgBonusZone" :groups="valueTips.disorderDmgBonusZone" /></p>
      <p class="result-total">紊乱期望伤害：<StatValueWithSources :value="formatNumber(calcParts.disorderExpected)" :groups="valueTips.disorderExpected" /></p>

      <h4 class="result-subsection-title">乱流期望伤害</h4>
      <p>乱流基础倍率：<StatValueWithSources :value="calcParts.turbulenceBaseMultRatio" :groups="valueTips.turbulenceBaseMult" /></p>
      <p>异常持续时间(有效)：<StatValueWithSources :value="calcParts.effectiveAnomalyDuration" :groups="valueTips.anomalyDuration" /></p>
      <p>乱流补偿倍率：<StatValueWithSources :value="calcParts.turbulenceCompMultRatio" :groups="valueTips.turbulenceCompMult" /></p>
      <p>乱流倍率区：<StatValueWithSources :value="calcParts.turbulenceZone" :groups="valueTips.turbulenceZone" /></p>
      <p>
        乱流增伤区+异常增伤区：<StatValueWithSources
          :value="calcParts.turbulenceCombinedDmgBonusZone"
          :groups="valueTips.turbulenceCombinedDmgBonusZone"
        />
      </p>
      <p v-if="calcParts.turbulenceUsesAnomalyCrit">
        异常暴击区：<StatValueWithSources :value="calcParts.anomalyCritZone" :groups="valueTips.anomalyCritZone" />
      </p>
      <p class="result-total">乱流期望伤害：<StatValueWithSources :value="formatNumber(calcParts.turbulenceExpected)" :groups="valueTips.turbulenceExpected" /></p>
    </div>
    </template>
  </section>
</template>

<style scoped>
.section-card {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.section-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.team-summary,
.mb-hint {
  margin: 0 0 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: #0f1217;
  border: 1px solid #2d323a;
  font-size: 0.8rem;
  color: #b7c0cd;
}

.mb-hint {
  border-color: #5a4a31;
  color: #d8c39a;
}

.team-notes {
  margin: 0 0 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid #34302a;
  background: #14120f;
}

.team-notes-title {
  cursor: pointer;
  font-size: 0.84rem;
  color: #e8d4a8;
}

.team-notes[open] .team-notes-title {
  margin-bottom: 0.55rem;
}

.team-note-item + .team-note-item {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid #2d2820;
}

.team-note-label {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  color: #d8c39a;
  font-weight: 600;
}

.team-note-text {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: #c5cdd8;
  white-space: pre-wrap;
}

.team-note-type {
  display: block;
  margin-bottom: 0.15rem;
  font-size: 0.72rem;
  color: #8f8678;
}

.team-note-empty {
  margin: 0.15rem 0 0;
  font-size: 0.76rem;
  color: #7a828f;
}

.upload-box {
  margin-bottom: 0.8rem;
}

.upload-label {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  color: #aab2bf;
}

.upload-box :deep(.image-picker) {
  border-color: #2d323a;
  background: #0f1217;
}

.upload-box :deep(.image-picker-btn) {
  border-color: #3a4033;
  background: #1c1915;
  color: #d8c8aa;
}

.upload-box :deep(.image-picker-btn:hover) {
  border-color: #c9a55c;
  background: #252018;
}

.upload-box :deep(.image-picker-name) {
  color: #8f8678;
}

.upload-preview {
  margin-top: 0.35rem;
  border: 1px dashed #2b2f35;
  border-radius: 10px;
  padding: 0.6rem;
  min-height: 110px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  color: #97a0ad;
  background: #111319;
}

.upload-preview img {
  margin-top: 0.5rem;
  max-width: 100%;
  max-height: 240px;
  border-radius: 8px;
}

.grid {
  display: grid;
  gap: 0.55rem;
}

.grid.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.meta-grid {
  margin-bottom: 0.85rem;
}

.panel-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  align-items: stretch;
}

.panel-layout-left {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.panel-block.panel-layout-right {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
}

.panel-grid-fill {
  flex: 1;
  align-content: start;
}

.panel-block {
  border: 1px solid #2d323a;
  border-radius: 12px;
  padding: 0.75rem;
  background: #10141a;
}

.panel-block--final {
  border-color: #3a4a31;
  background: linear-gradient(180deg, #121712 0%, #0f1410 100%);
}

.panel-block-header h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8ebf0;
}

.panel-block-header p {
  margin: 0.25rem 0 0.65rem;
  font-size: 0.76rem;
  color: #8f96a3;
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
.field select,
.extra-buff-textarea {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.44rem 0.54rem;
}

.field input:read-only {
  opacity: 0.92;
  background: #0c1016;
}

.extra-mods-block {
  margin-bottom: 0;
  padding: 0.6rem 0.65rem;
}

.extra-mods-block .panel-block-header p {
  margin: 0.2rem 0 0.45rem;
  font-size: 0.72rem;
  line-height: 1.35;
}

.extra-mods-block :deep(.buff-stat-grid-wrap) {
  gap: 0;
}

.extra-mods-block :deep(.buff-stat-hint:empty) {
  display: none;
}

.extra-mods-block :deep(.buff-stat-grid) {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.32rem 0.4rem;
}

.extra-mods-block :deep(.field) {
  gap: 0.12rem;
}

.extra-mods-block :deep(.field-label) {
  font-size: 0.68rem;
  line-height: 1.2;
  opacity: 0.85;
}

.extra-mods-block :deep(.field-input) {
  padding: 0.28rem 0.4rem;
  font-size: 0.8rem;
  border-radius: 6px;
}

@media (max-width: 980px) {
  .extra-mods-block :deep(.buff-stat-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .extra-mods-block :deep(.buff-stat-grid) {
    grid-template-columns: 1fr;
  }
}

.affix-input-block {
  margin-bottom: 0.85rem;
}

.affix-hint {
  margin: 0 0 0.65rem;
  font-size: 0.78rem;
  color: #d8c39a;
}

.field-hint {
  font-size: 0.72rem;
  color: #7a828f;
}

.affix-base-summary {
  margin-top: 0.65rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #2d323a;
  background: #0f1217;
  font-size: 0.78rem;
  color: #9aa3b0;
}

.affix-base-summary p {
  margin: 0;
}

.mods-summary {
  margin: 0.55rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
}

.mods-summary li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.buff-breakdown {
  margin-bottom: 0.85rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  background: #0f1217;
  color: #b7c0cd;
  font-size: 0.8rem;
}

.buff-breakdown summary {
  cursor: pointer;
  color: #d5dae4;
}

.buff-breakdown ul {
  margin: 0.55rem 0 0;
  padding-left: 1.1rem;
}

.buff-breakdown li {
  margin: 0.2rem 0;
}

.enemy-title {
  margin: 0 0 0.55rem;
  font-size: 0.9rem;
  color: #d5dae4;
}

.result-mode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 1rem 0 0.55rem;
}

.result-mode-title {
  margin: 0;
}

.detail-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: #c5cdd8;
  cursor: pointer;
  user-select: none;
}

.detail-mode-toggle input {
  accent-color: #e8d4a8;
}

.result-grid-summary {
  grid-template-columns: 1fr;
  margin-top: 0.35rem;
}

.result-section-title {
  margin: 0.85rem 0 0.45rem;
  font-size: 0.88rem;
  color: #e8d4a8;
}

.result-subsection-title {
  grid-column: 1 / -1;
  margin: 0.65rem 0 0.15rem;
  font-size: 0.82rem;
  color: #c9a55c;
  font-weight: 600;
}

.result-subsection-title:first-child {
  margin-top: 0;
}

.formula-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.35rem 0 0.55rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.formula-line {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.55;
  color: #b7c0cd;
  word-break: break-word;
}

.formula-label {
  display: inline-block;
  min-width: 6.5em;
  margin-right: 0.45rem;
  color: #e8d4a8;
  font-weight: 600;
}

.formula-block--aligned {
  gap: 0;
}

.formula-aligned-group {
  display: grid;
  grid-template-columns: 6.95em minmax(0, 1fr);
  gap: 0.35rem 0.45rem;
  padding: 0.55rem 0;
  align-items: start;
}

.formula-aligned-group + .formula-aligned-group {
  border-top: 1px solid #252a32;
}

.formula-aligned-title {
  margin: 0;
  padding-top: 0.15rem;
  line-height: 1.45;
}

.formula-aligned-body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.35rem 0.45rem;
  min-width: 0;
}

.formula-aligned-term {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
}

.formula-aligned-term-label {
  font-size: 0.75rem;
  line-height: 1.35;
  color: #b7c0cd;
  text-align: center;
  white-space: nowrap;
}

.formula-aligned-hint {
  display: block;
  margin-top: 0.15rem;
  color: #8a93a0;
  font-size: 0.68rem;
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
}

.formula-aligned-term-value {
  font-size: 0.8rem;
  line-height: 1.4;
  color: #d4dbe6;
  text-align: center;
  white-space: nowrap;
}

.formula-aligned-term-value :deep(.stat-value > strong) {
  color: #d4dbe6;
  font-weight: 400;
}

.formula-aligned-op {
  flex: 0 0 auto;
  align-self: center;
  padding-bottom: 0.15rem;
  color: #8a93a0;
  font-size: 0.78rem;
}

.formula-aligned-result {
  flex: 0 0 auto;
  align-self: flex-end;
  padding-bottom: 0.05rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem 0.6rem;
  margin-top: 0.35rem;
}

.result-grid p {
  margin: 0;
}

.result-total {
  grid-column: 1 / -1;
  margin-top: 0.3rem !important;
  border-top: 1px solid #2a2f36;
  padding-top: 0.5rem;
}

.result-subtotal {
  grid-column: 1 / -1;
  margin-top: 0.15rem !important;
  border-top: 1px dashed #2a2f36;
  padding-top: 0.35rem;
}

@media (max-width: 980px) {
  .panel-layout {
    grid-template-columns: 1fr;
  }

  .grid.four,
  .result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-block.panel-layout-right {
    height: auto;
    min-height: 0;
  }
}

@media (max-width: 680px) {
  .panel-layout {
    grid-template-columns: 1fr;
  }

  .grid.four,
  .result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
