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
import {
  parseBatchEntryCapInput,
  summarizeEntryCaps,
} from '../src/utils/affixBatchEntryCap.ts'

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

/**
 * 2026-09-17 真机事故（用户：填了数字点不动；管理侧先报、用户侧同款）：
 * `<input type="number">` + `v-model` 会给**number**，而实现里写的是 `.trim()`
 * → computed 抛 `trim is not a function` → 渲染崩 → 按钮永远禁用。
 * 下面这组是**逻辑级**回归（不是字符串守卫）：把数种真实输入都钉住。
 */
console.log('  解析输入（<input type=number> 给的是 number，也可能是空串）：')
check('number 6 → 6（事故就是这条：以前会抛 .trim is not a function）', parseBatchEntryCapInput(6) === 6)
check('字符串 "6" → 6', parseBatchEntryCapInput('6') === 6)
check('字符串 " 12 " 去空格 → 12', parseBatchEntryCapInput(' 12 ') === 12)
check('空串 → null（按钮置灰）', parseBatchEntryCapInput('') === null)
check('null / undefined → null', parseBatchEntryCapInput(null) === null && parseBatchEntryCapInput(undefined) === null)
check('非数字 "abc" → null', parseBatchEntryCapInput('abc') === null)
check('负数/小数钳到 ≥0 整数：-3.7 → 0，2.6 → 3', parseBatchEntryCapInput(-3.7) === 0 && parseBatchEntryCapInput(2.6) === 3)
check('0 → 0（= 不限，是合法值，不能当成"空"）', parseBatchEntryCapInput(0) === 0)
check('布尔/对象当非法 → null', parseBatchEntryCapInput(true) === null && parseBatchEntryCapInput({}) === null)

console.log('  汇总当前值：')
check('全部不限（3 条）', summarizeEntryCaps([0, 0, 0]) === '全部不限（3 条）')
check('全部 30（2 条）', summarizeEntryCaps([30, 30]) === '全部 30（2 条）')
check('只要一条不同 → 上限不一致', summarizeEntryCaps([0, 1]) === '上限不一致')
check('没有条目 → —', summarizeEntryCaps([]) === '—')

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
  /const batchEntryCapInput = ref<string \| number>\(''\)/.test(adminSource),
)
/**
 * 2026-09-17 用户真机反馈：管理侧「应用到本组 N 条」填了数字**点不动**；用户随即确认**用户侧同样**有这个问题
 *（用户的原话判断：「应该是把默认值去掉的缘故」—— 对：不预填 → 值初始为空 → 按钮禁用 → 死锁）。
 * 真因 = 输入框用了 `v-model.lazy`（失焦/回车才提交）+ 按钮以该值为禁用条件：
 * 值没提交 → 按钮禁用 → 禁用按钮不接收点击、也不会让输入框失焦 → 死锁。
 * 这条守卫钉住「两侧都别再写回 .lazy」——它是**唯一**能防住这个死锁的静态约束。
 */
const lazyBind = /v-model\.lazy="batchEntryCapInput"/
check(
  '管理侧：输入框是实时绑定（用 .lazy 会让按钮在未失焦时永远禁用 → 点不动）',
  !lazyBind.test(adminSource),
  'lazy + 「值为空则禁用」= 死锁：禁用按钮不接收点击、也不会让输入框失焦',
)
check(
  '用户侧：输入框同样是实时绑定（同款死锁，2026-09-17 用户要求两侧一起修）',
  !lazyBind.test(modalSource),
  '两侧是各写一份，必须各查一遍',
)
check(
  '两侧都走同一个解析函数（不是各写一份 .trim()）',
  /parseBatchEntryCapInput\(batchEntryCapInput\.value\)/.test(adminSource) &&
    /parseBatchEntryCapInput\(batchEntryCapInput\.value\)/.test(modalSource),
)
/**
 * 事故的形状守卫：只要谁把 `.trim()` 直接写在那个 ref 上，就说明又回到了「假设它是字符串」的老路
 *（`<input type="number">` 给的是 number → 一调用就抛 → 渲染崩 → 按钮永远禁用）。
 */
check(
  '两侧都没有对输入 ref 直接调 .trim()（type=number 给的是 number，调用即崩）',
  !/batchEntryCapInput\.value\.trim\(\)/.test(adminSource) &&
    !/batchEntryCapInput\.value\.trim\(\)/.test(modalSource),
)
check(
  '两侧都声明成 string | number（不写死 string，免得下次又假设错）',
  /const batchEntryCapInput = ref<string \| number>\(''\)/.test(adminSource) &&
    /const batchEntryCapInput = ref<string \| number>\(''\)/.test(modalSource),
)
check(
  '两侧一致：都没有把「不预填」改回预填（用户口径：当前状态由「本组当前」说）',
  /const batchEntryCapInput = ref<string \| number>\(''\)/.test(adminSource) &&
    /const batchEntryCapInput = ref<string \| number>\(''\)/.test(modalSource),
)
check(
  '管理侧：按钮仍按「有没有填有效值」置灰（口径没被改掉）',
  /:disabled="busy \|\| !visibleEntries\.length \|\| batchEntryCapValue == null"/.test(adminSource),
)
check(
  '两侧一致：汇总都调同一个 summarizeEntryCaps（不是各写一份拼接）',
  /summarizeEntryCaps\(visibleEntries\.value\.map\(\(entry\) => entry\.cap\)\)/.test(adminSource) &&
    /summarizeEntryCaps\(visibleEntries\.value\.map\(\(entry\) => entry\.cap\)\)/.test(modalSource),
)
const derivedSummary = /first === 0 \? `全部不限（\$\{list\.length\} 条）` : `全部 \$\{first\}（\$\{list\.length\} 条）`/
check(
  '汇总实现只有一处（utils/affixBatchEntryCap.ts）：按本组 caps 现算，不是写死条数',
  derivedSummary.test(fs.readFileSync(path.join(root, 'src/utils/affixBatchEntryCap.ts'), 'utf8')),
)

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
