/**
 * 「没点导入就没有面板」+「没有面板就没有伤害」两条必要条件的契约测试。
 *
 * 背景（2026-09-12 所有者口径）：
 * - 必要条件一：只有用户点「确定导入」（或手动切换来源 / 读盘恢复）才产生面板；
 * - 必要条件二：**没有面板 → 不出伤害**。
 *   改前计算链路会给一份**占位毕业面板**（生命 9873 / 攻击 4008 …）兜底，
 *   于是「没导入过面板的人」也能算出伤害 —— 这条测试就是钉住那个兜底已删。
 *
 * 运行：npx vite-node scripts/test-panel-required-for-damage.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  createDefaultExternalPanel,
  createEmptyExternalPanel,
  EXTERNAL_PANEL_INPUT_FIELDS,
} from '../src/types/calculatorPanel.ts'
import { resolveActivePanel } from '../src/utils/agentPanelSources.ts'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import { createEmptyRefinementMods, createEmptyBuffStatModifiers } from '../src/utils/calculatorUi.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('没有面板 → 没有伤害：')

// ---- 1. 「空面板」与「占位毕业面板」是两回事 ----
const empty = createEmptyExternalPanel()
const placeholder = createDefaultExternalPanel()
check(
  '空面板：用户录入的字段全为 0',
  EXTERNAL_PANEL_INPUT_FIELDS.every((field) => empty[field.key] === 0),
  `生命 ${empty.hp} / 攻击 ${empty.atk} / 暴击 ${empty.critRate} / 爆伤 ${empty.critDmg} / 穿透值 ${empty.pen}`,
)
check(
  '空面板：乘区入口保持中性（×1 而非 0，避免把公式乘成 0）',
  empty.directDmgMult === 100 && empty.specialMult === 100 && empty.directDmgMultFactor === 100,
)
check(
  '空面板 ≠ 占位毕业面板（9873 / 4008 那组数不许再当兜底）',
  placeholder.hp === 9873 && placeholder.atk === 4008 && empty.hp !== placeholder.hp,
)

// ---- 2. 来源解析：两份都没有数据时没有面板 ----
check('没有任何记录 → 没有面板（undefined，不是默认面板）', resolveActivePanel(undefined) === undefined)
check(
  '有记录但两份都空 → 仍然没有面板',
  resolveActivePanel({ active: 'affixDerived' }) === undefined,
)
check(
  '占位毕业面板不算数据（老兜底写进盘的那份不认）',
  resolveActivePanel({ active: 'imported', importedPanel: { ...placeholder } }) === undefined,
)

// ---- 3. 行为：空面板算出来的局内面板是 0（→ 伤害为 0）----
const emptyBangboo = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}
const panelCtx = {
  teamSlots: [
    {
      agentId: 'claret',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
  ],
  agents: [],
  wengines: [],
  driveDiscs: [],
  bangboo: emptyBangboo,
  bangbooRefine: 1,
  mainSlotIndex: 0,
}
const fromEmpty = computeFinalPanel(createEmptyExternalPanel(), panelCtx, { includeDetails: false })
check(
  '空面板 → 局内攻击/生命为 0（基础伤害随之 0）',
  fromEmpty.finalPanel.atk === 0 && fromEmpty.finalPanel.hp === 0,
  `局内攻击 ${fromEmpty.finalPanel.atk} / 生命 ${fromEmpty.finalPanel.hp}`,
)
const withPanel = computeFinalPanel(
  { ...createDefaultExternalPanel(), atk: 942, hp: 7851 },
  panelCtx,
  { includeDetails: false },
)
check(
  '对照组：有面板才算得出数（说明上一条不是因为整条链路不工作）',
  withPanel.finalPanel.atk > 0,
  `局内攻击 ${withPanel.finalPanel.atk}`,
)

// ---- 4. 源码契约：两个解析器都不许再拿「默认面板」当无数据兜底 ----
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (rel) => fs.readFileSync(path.resolve(rel), 'utf8')

const panelSection = stripComments(read('src/components/calculator/PanelCalcSection.vue'))
const slotResolver = panelSection.slice(
  panelSection.indexOf('function resolveExternalPanelForSlotIndex'),
  panelSection.indexOf('function resolveExternalPanelForSlotIndex') + 900,
)
check(
  '面板组件：槽位面板解析在无数据时给空面板（不给占位毕业面板）',
  /createEmptyExternalPanel\(\)/.test(slotResolver) &&
    !/createDefaultExternalPanel\(\)/.test(slotResolver),
)
check(
  '面板组件：不再拿 live 编辑器给主 C 面板兜底',
  !/fillPanelStatsDefaults\(externalPanel\)/.test(slotResolver),
)
check(
  '面板组件：主 C 没面板时有界面提示',
  /mainPanelMissing/.test(panelSection) && /还没有面板/.test(panelSection),
)

const panelBuff = stripComments(read('src/utils/panelBuffCalc.ts'))
const buffResolver = panelBuff.slice(
  panelBuff.indexOf('function resolveExternalPanelForSlot'),
  panelBuff.indexOf('function resolveExternalPanelForSlot') + 900,
)
check(
  '面板计算：槽位面板解析在无数据时给空面板（不给占位毕业面板）',
  /createEmptyExternalPanel\(\)/.test(buffResolver) &&
    !/return createDefaultExternalPanel\(\)/.test(buffResolver),
)

// ---- 5. 源码契约：4/5/6 主属性可空、空按 0 计 ----
const entryForm = stripComments(read('src/components/calculator/SlotPanelEntryForm.vue'))
check(
  '4/5/6 主属性下拉有「空」选项',
  /MAIN_STAT_EMPTY_LABEL/.test(entryForm) && /<option value="">/.test(entryForm),
)
const picker = stripComments(read('src/components/calculator/UnifiedPresetPicker.vue'))
check(
  '词条导入不再强制选满 4/5/6（空就按空算）',
  !/请先选择 4 \/ 5 \/ 6 号盘主属性/.test(picker),
)

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
