/**
 * 导入弹窗草稿重置判定测试。
 *
 * 回归：2026-09-12 修复「刷新后第一次打开导入弹窗，配置是空的，关掉再打开才出现」。
 * 根因是打开弹窗时按槽位回填的角色变化被当成用户换人，回填好的草稿随即被清空。
 *
 * 运行：npx vite-node scripts/test-preset-picker-draft-reset.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { shouldResetDraftsOnAgentChange } from '../src/utils/presetPickerDraftReset.ts'

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

console.log('草稿重置判定：')

check(
  '打开弹窗按槽位回填（同一次变化）→ 不重置草稿',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: '',
    newAgentId: 'agentA',
    agentIdRestoredOnOpen: 'agentA',
  }) === false,
  '刷新后第一次打开就靠这条：回填的配置不能被清空',
)

check(
  '打开后用户点选另一个角色 → 重置草稿',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: 'agentA',
    newAgentId: 'agentB',
    agentIdRestoredOnOpen: null,
  }) === true,
  '既有的「换人不沿用上一个角色数据」行为必须保留',
)

check(
  '回填标记还没被消费时用户又换人 → 仍重置',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: 'agentA',
    newAgentId: 'agentC',
    agentIdRestoredOnOpen: 'agentA',
  }) === true,
  '标记只跳过回填那一角色，别的角色照常重置',
)

check(
  '第二次打开（角色没变）→ 不重置',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: 'agentA',
    newAgentId: 'agentA',
    agentIdRestoredOnOpen: 'agentA',
  }) === false,
)

check(
  '弹窗关闭时的角色变化 → 不重置',
  shouldResetDraftsOnAgentChange({
    isOpen: false,
    oldAgentId: 'agentA',
    newAgentId: 'agentB',
    agentIdRestoredOnOpen: null,
  }) === false,
  '下次打开会按槽位整体回填',
)

check(
  '变化后的角色为空 → 不重置',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: 'agentA',
    newAgentId: '',
    agentIdRestoredOnOpen: null,
  }) === false,
)

check(
  '截图识别出另一个角色 → 重置',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: 'agentA',
    newAgentId: 'agentB',
    agentIdRestoredOnOpen: 'agentA',
  }) === true,
  '识别出的角色与回填角色不同，按换人处理',
)

check(
  '截图识别出的正是当前角色 → 不重置',
  shouldResetDraftsOnAgentChange({
    isOpen: true,
    oldAgentId: 'agentA',
    newAgentId: 'agentA',
    agentIdRestoredOnOpen: null,
  }) === false,
)

// 源码契约：判定走同一处，避免再退回「只看 open/角色是否变化」
const pickerPath = path.resolve('src/components/calculator/UnifiedPresetPicker.vue')
const pickerSource = fs.readFileSync(pickerPath, 'utf8')
check(
  '组件接线：角色 watch 用 shouldResetDraftsOnAgentChange 判定',
  /shouldResetDraftsOnAgentChange\(\{/.test(pickerSource),
)
check(
  '组件接线：打开弹窗时记下回填的角色（agentIdRestoredOnOpen）',
  /agentIdRestoredOnOpen\s*=\s*selected\.value\.agentId/.test(pickerSource),
)

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
