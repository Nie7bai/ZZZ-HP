/**
 * 面板导入草稿「空就是空」契约测试。
 *
 * 回归（2026-09-12）：面板草稿曾初始化为占位毕业面板（攻击 4008 / 生命 9873），于是
 * **没导入过的角色**打开弹窗看到一组像配置的假数字；用户只改一两项再确定导入，
 * 剩下的假数字就被当成他填的写进记录。所有者口径：没填就是没填，工具不得替他补。
 *
 * 运行：npx vite-node scripts/test-external-panel-draft.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  createEmptyExternalPanelDraft,
  EXTERNAL_PANEL_INPUT_FIELDS,
  missingExternalPanelInputs,
  resolveExternalPanelDraft,
} from '../src/types/calculatorPanel.ts'

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

console.log('面板导入草稿：')

const empty = createEmptyExternalPanelDraft()

check(
  '空白草稿：录入项全是 null（不是 0，更不是占位面板）',
  missingExternalPanelInputs(empty).length === EXTERNAL_PANEL_INPUT_FIELDS.length,
  `录入项 ${EXTERNAL_PANEL_INPUT_FIELDS.length} 项`,
)
check(
  '空白草稿 → 不能进计算（resolve 返回 null）',
  resolveExternalPanelDraft(empty) === null,
)

const oneMissing = { ...empty, atk: 2000 }
const missingAfterAtk = missingExternalPanelInputs(oneMissing)
check(
  '缺项 → 也不能进计算，且点名缺的是哪一项',
  resolveExternalPanelDraft(oneMissing) === null &&
    missingAfterAtk.some((item) => item.label === '生命值') &&
    !missingAfterAtk.some((item) => item.label === '攻击力'),
)

const full = { ...empty }
for (const field of EXTERNAL_PANEL_INPUT_FIELDS) full[field.key] = 0
check(
  '填 0 也算填了（「没填」和「填了 0」是两回事）',
  resolveExternalPanelDraft(full) !== null &&
    missingExternalPanelInputs(full).length === 0,
)

full.hp = 8000
full.atk = 3000
full.critRate = 60
const resolved = resolveExternalPanelDraft(full)
check(
  '填齐 → 原样进计算，不被默认值改写',
  resolved !== null &&
    resolved.hp === 8000 &&
    resolved.atk === 3000 &&
    resolved.critRate === 60,
)

// 源码契约：弹窗草稿不得再用占位毕业面板初始化（注释里提到不算调用）
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const pickerPath = path.resolve('src/components/calculator/UnifiedPresetPicker.vue')
const pickerSource = fs.readFileSync(pickerPath, 'utf8')
const pickerCode = stripComments(pickerSource)
check(
  '弹窗草稿用 createEmptyExternalPanelDraft 初始化',
  /reactive<ExternalPanelDraft>\(createEmptyExternalPanelDraft\(\)\)/.test(pickerCode),
)
check(
  '弹窗里不再拿占位毕业面板当草稿起点',
  !/createDefaultExternalPanel/.test(pickerCode),
)
check(
  '写盘前挡一层：没填齐就提示、不落盘',
  /missingExternalPanelInputs\(draftExternalPanel\)/.test(pickerCode) &&
    /面板还缺/.test(pickerCode),
)

// 源码契约：录入项清单单一事实来源（表单渲染与「填没填完」判定共用一份）
const formSource = fs.readFileSync(
  path.resolve('src/components/calculator/SlotPanelEntryForm.vue'),
  'utf8',
)
check(
  '录入表单的字段清单来自 EXTERNAL_PANEL_INPUT_FIELDS',
  /const EXTERNAL_FIELDS = EXTERNAL_PANEL_INPUT_FIELDS/.test(formSource),
)
check(
  '清空输入框 = null（不是 0）',
  /raw === '' \? null : Number\(raw\)/.test(formSource),
)

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
