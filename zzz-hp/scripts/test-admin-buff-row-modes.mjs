/**
 * 共享效果行的两种模式没有互相污染（Spec §7.2 第 9 项、§7.3 第 9 项）。
 *
 * 为什么要这条：额外 Buff 复用增益库的 `AdminBuffEffectRow`，只加了 `contextMode='extra'`。
 * 管理端（增益库）用的是**缺省模式**，所以只要缺省模式下的控件一个都没被 extra 分支吃掉、
 * extra 专属控件又全部被 `isExtraMode` 关住，增益库的行为就没有回归 —— 这一条可以直接对源码断言，
 * 不需要登录后台手点。
 *
 * 运行：npx vite-node scripts/test-admin-buff-row-modes.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUFF_APPLY_TARGET_LABELS } from '../src/types/calculator.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')
const rowPath = path.join(srcRoot, 'components/admin/calculator/AdminBuffEffectRow.vue')
const source = readFileSync(rowPath, 'utf8')

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 取某个标记所在的模板片段（用于断言"这个控件在什么条件下渲染"） */
function linesAround(needle, before = 14, after = 6) {
  const lines = source.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(needle))
  if (index < 0) return null
  return lines.slice(Math.max(0, index - before), index + after).join('\n')
}

/** 从标记所在行取到该 `<label>` 闭合为止（避免把紧随其后的另一分支也算进来） */
function labelBlockOf(needle, before = 2) {
  const lines = source.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(needle))
  if (index < 0) return null
  const end = lines.findIndex((line, i) => i > index && line.includes('</label>'))
  if (end < 0) return null
  return lines.slice(Math.max(0, index - before), end + 1).join('\n')
}

console.log('\n[1] 缺省模式（增益库）不受影响')
{
  check(
    'contextMode 是可选属性，缺省即 catalog',
    /contextMode\?: 'catalog' \| 'extra'/.test(source),
  )
  check(
    'isExtraMode 严格等于 contextMode === "extra"',
    /const isExtraMode = computed\(\(\) => props\.contextMode === 'extra'\)/.test(source),
  )
  check(
    '没有把 contextMode 的默认值写成 extra',
    !/contextMode[^\n]*default[^\n]*extra/.test(source) &&
      !/withDefaults[\s\S]{0,200}contextMode/.test(source),
  )

  const catalogOnly = [
    ['class="effect-actions"', 'v-if="!isExtraMode"'],
    ['class="row-warn"', '!isExtraMode'],
    ['class="member-line"', '!isExtraMode'],
    ['badge badge-group', '!isExtraMode'],
    ['v-if="!isExtraMode && showEnabledDefault"', '!isExtraMode'],
    ['@create="openCreateSubcat"', ':allow-create="!isExtraMode"'],
  ]
  for (const [needle, gate] of catalogOnly) {
    const block = linesAround(needle)
    check(
      `「${needle}」在缺省模式仍然渲染（条件含 ${gate}）`,
      !!block && block.includes(gate),
      block ? '' : '没找到该控件',
    )
  }

  // 正式目标来自共享目录，有角色提供者时可选择仅队友。
  const targetBlock = linesAround('v-model="applyTarget"', 10, 12)
  check('增益库「目标」下拉仍在（v-model=applyTarget）', !!targetBlock)
  check(
    '「目标」使用共享目录，包含自身 / 全队 / 仅队友',
    !!targetBlock && targetBlock.includes('in applyTargetOptions') &&
      Object.values(BUFF_APPLY_TARGET_LABELS).join('/') === '自身/全队/仅队友',
    targetBlock ? '' : '未取到片段',
  )
  check(
    '「目标」仍受 lockApplyTarget 控制',
    !!targetBlock && targetBlock.includes('v-else-if="!lockApplyTarget"'),
  )
}

console.log('\n[2] extra 专属控件只在 extra 模式出现')
{
  const applyBlock = labelBlockOf('<span>作用对象</span>', 3)
  check('「作用对象」被 isExtraMode 关住', !!applyBlock && applyBlock.includes('v-if="isExtraMode"'))
  check(
    '「作用对象」选项含全队与槽位（不是只有自身/全队两项）',
    !!applyBlock && applyBlock.includes('slotOptions'),
    applyBlock ? '' : '未取到片段',
  )
  const sourceSlotBlock = linesAround('<span>来源槽位</span>', 8, 4)
  check(
    '「来源槽位」被 isExtraMode 关住且要求非 manual 来源',
    !!sourceSlotBlock &&
      sourceSlotBlock.includes('v-if="isExtraMode') &&
      sourceSlotBlock.includes("!== 'manual'"),
    sourceSlotBlock ? '' : '未取到片段',
  )

  // 用户侧与管理侧的"生效目标"不是同一套：额外 Buff 只有 全队 / 槽位1–3，没有「自身」
  check(
    '额外 Buff 的「作用对象」里没有「自身」选项（与管理端刻意不同）',
    !!applyBlock && !applyBlock.includes('value="self"') && !applyBlock.includes('>自身<'),
    applyBlock ? '' : '未取到片段',
  )
  check(
    '「作用对象」第一个选项固定是全队',
    !!applyBlock && applyBlock.includes('>全队<'),
    applyBlock ? '' : '未取到片段',
  )
}

console.log('\n[3] 只有额外 Buff 编辑器用 extra 模式')
{
  const callers = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (/\.(vue|ts)$/.test(name)) {
        const text = readFileSync(full, 'utf8')
        if (/AdminBuffEffectRow/.test(text) && full !== rowPath) callers.push({ full, text })
      }
    }
  }
  walk(srcRoot)
  const extraCallers = callers.filter((item) => /context-mode="extra"/.test(item.text))
  check('存在调用方引用共享效果行', callers.length > 0, `${callers.length} 个`)
  check(
    '用 extra 模式的只有 ExtraBuffGainEditor',
    extraCallers.length === 1 && extraCallers[0].full.endsWith('ExtraBuffGainEditor.vue'),
    extraCallers.map((item) => path.basename(item.full)).join(',') || '（无）',
  )
  check(
    '其余调用方保持缺省（不传 contextMode）',
    callers
      .filter((item) => !extraCallers.includes(item))
      .every((item) => !/context-mode=/.test(item.text)),
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
