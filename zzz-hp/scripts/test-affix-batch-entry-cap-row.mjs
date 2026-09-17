/**
 * 「本组单词条上限统一改成」批量入口：用户侧 / 管理侧**两边都要在**的守卫。
 *
 * 背景（2026-09-17 用户要求）：
 * - 用户侧 `AffixLibraryModal.vue` 先有这一行（标签 + 输入 + 「应用到本组 N 条」+「本组当前：…」）；
 * - 用户随后要求**管理端也增加同样的** —— 官方预设词条库在管理侧维护，逐条改上限太慢。
 *
 * 为什么是源码级守卫：两侧是**各写一份**（手册 §10.4 明确「用户侧不许动、管理侧照另写一份」，
 * 一次「抽公共组件共用」的尝试被用户当场叫停），没有共享模块可以在运行时断言，
 * 只能钉住「两边都还留着这三段文案 + 管理侧接到草稿上、用户侧没被改坏」。
 *
 * 运行：npx vite-node scripts/test-affix-batch-entry-cap-row.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

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

const root = path.resolve(import.meta.dirname, '..')
const adminPath = path.join(root, 'src/components/admin/calculator/AdminAffixPresetPanel.vue')
const modalPath = path.join(root, 'src/components/calculator/AffixLibraryModal.vue')
const adminSource = fs.readFileSync(adminPath, 'utf8')
const modalSource = fs.readFileSync(modalPath, 'utf8')

console.log('本组单词条上限批量入口：')

/** 三段文案 + 一个动态条数，两侧都必须一字不差（用户口径） */
const COPY = {
  label: '本组单词条上限统一改成',
  apply: '应用到本组 ',
  now: '本组当前：',
  summaryUnlimited: '全部不限（',
  summaryMismatch: '上限不一致',
}

check('用户侧：标签文案在', modalSource.includes(COPY.label))
check('用户侧：按钮文案在', modalSource.includes(COPY.apply))
check('用户侧：当前值文案在', modalSource.includes(COPY.now))
check('用户侧：两种汇总口径都在', modalSource.includes(COPY.summaryUnlimited) && modalSource.includes(COPY.summaryMismatch))

check('管理侧：标签文案在（与用户侧同一句）', adminSource.includes(COPY.label))
check('管理侧：按钮文案在（与用户侧同一句）', adminSource.includes(COPY.apply))
check('管理侧：当前值文案在（与用户侧同一句）', adminSource.includes(COPY.now))
check(
  '管理侧：两种汇总口径都在',
  adminSource.includes(COPY.summaryUnlimited) && adminSource.includes(COPY.summaryMismatch),
)

check(
  '管理侧：条数用当前组条目数（不是写死的数字）',
  /应用到本组 \{\{ visibleEntries\.length \}\} 条/.test(adminSource),
)
check(
  '管理侧：只在组页出现（manage 页不出现）',
  /v-if="activeTab !== 'manage'"[\s\S]{0,200}group-cap-row/.test(adminSource),
)
check(
  '管理侧：点应用只改内存草稿里的 cap（不发请求）',
  /for \(const entry of visibleEntries\.value\) entry\.cap = cap/.test(adminSource),
)
check(
  '管理侧：输入框不预填（留空等用户填）',
  /const batchEntryCapInput = ref\(''\)/.test(adminSource),
)
const derivedSummary = /first === 0 \? `全部不限（\$\{caps\.length\} 条）` : `全部 \$\{first\}（\$\{caps\.length\} 条）`/
check(
  '两侧一致：汇总都是按本组 caps 现算（不是写死的条数）',
  derivedSummary.test(adminSource) && derivedSummary.test(modalSource),
)

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
