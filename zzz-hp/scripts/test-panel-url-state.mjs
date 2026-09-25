/**
 * 模式面板 URL 状态 · 纯逻辑回归测试。
 *
 * 覆盖 src/utils/panelUrlState.ts：query 读写、期/赛季的稳定标识、按标识找下标。
 *
 * 为什么要钉住 query 键名：这些参数会出现在用户分享/收藏的 URL 里，
 * 改名等于让旧链接失效，所以用断言把当前约定固定下来。
 *
 * 运行：npx vite-node scripts/test-panel-url-state.mjs
 */
import {
  buildQueryWithValues,
  findIndexBySelectionKey,
  PANEL_MODE_HARD,
  PANEL_QUERY_KEYS,
  periodSelectionKey,
  readSingleQueryValue,
} from '../src/utils/panelUrlState.ts'

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

console.log('\n[query 键名约定：出现在分享链接里，改动即破坏旧链接]')
{
  check('mode', PANEL_QUERY_KEYS.mode === 'mode', PANEL_QUERY_KEYS.mode)
  check('phase', PANEL_QUERY_KEYS.phase === 'phase', PANEL_QUERY_KEYS.phase)
  check('period', PANEL_QUERY_KEYS.period === 'period', PANEL_QUERY_KEYS.period)
  check('node', PANEL_QUERY_KEYS.node === 'node', PANEL_QUERY_KEYS.node)
  check('绝境取值 = hard', PANEL_MODE_HARD === 'hard', PANEL_MODE_HARD)
}

console.log('\n[readSingleQueryValue：取值与容错]')
{
  check('普通字符串', readSingleQueryValue({ phase: '3.1-2' }, 'phase') === '3.1-2')
  check('数组取第一个', readSingleQueryValue({ phase: ['3.1-2', '3.1-3'] }, 'phase') === '3.1-2')
  check('空数组 → undefined', readSingleQueryValue({ phase: [] }, 'phase') === undefined)
  check('空串 → undefined', readSingleQueryValue({ phase: '' }, 'phase') === undefined)
  check('键不存在 → undefined', readSingleQueryValue({}, 'phase') === undefined)
  check('值为 null → undefined', readSingleQueryValue({ phase: null }, 'phase') === undefined)
  check('非字符串（数字）→ undefined', readSingleQueryValue({ phase: 3 }, 'phase') === undefined)
  check('query 为 undefined → undefined', readSingleQueryValue(undefined, 'phase') === undefined)
  check('query 为 null → undefined', readSingleQueryValue(null, 'phase') === undefined)
}

console.log('\n[buildQueryWithValues：写入 / 删除 / 保留其他键]')
{
  check(
    '写入新键',
    JSON.stringify(buildQueryWithValues({}, { phase: '3.1-2' })) === JSON.stringify({ phase: '3.1-2' }),
  )
  check(
    '其他键原样保留',
    JSON.stringify(buildQueryWithValues({ foo: 'bar' }, { phase: '3.1-2' })) ===
      JSON.stringify({ foo: 'bar', phase: '3.1-2' }),
  )
  check(
    'null → 删除该键',
    JSON.stringify(buildQueryWithValues({ phase: '3.1-2' }, { phase: null })) === JSON.stringify({}),
  )
  check(
    'undefined → 删除该键',
    JSON.stringify(buildQueryWithValues({ phase: '3.1-2' }, { phase: undefined })) ===
      JSON.stringify({}),
  )
  check(
    '空串 → 删除该键',
    JSON.stringify(buildQueryWithValues({ phase: '3.1-2' }, { phase: '' })) === JSON.stringify({}),
  )
  check(
    '一次写两个键（临界的 period + node）',
    JSON.stringify(buildQueryWithValues({}, { period: 'p1', node: 'n2' })) ===
      JSON.stringify({ period: 'p1', node: 'n2' }),
  )
  check(
    '删 node 时 period 保留（切节点回到首节点）',
    JSON.stringify(buildQueryWithValues({ period: 'p1', node: 'n2' }, { node: null })) ===
      JSON.stringify({ period: 'p1' }),
  )
  check('query 为 null 也能工作', JSON.stringify(buildQueryWithValues(null, { mode: 'hard' })) === JSON.stringify({ mode: 'hard' }))

  const original = { keep: '1', phase: 'old' }
  const next = buildQueryWithValues(original, { phase: 'new' })
  check(
    '不修改入参（纯函数）',
    original.phase === 'old' && next.phase === 'new',
    `original=${original.phase} next=${next.phase}`,
  )
}

console.log('\n[periodSelectionKey：与两个面板既有口径一致]')
{
  check('版本 + 期数数字', periodSelectionKey({ version: '3.1', phase: '第 2 期' }) === '3.1-2')
  check('多位数期数', periodSelectionKey({ version: '2.0', phase: '第 12 期' }) === '2.0-12')
  check('无数字时回落到原文案', periodSelectionKey({ version: '1.0', phase: '特别篇' }) === '1.0-特别篇')
  check(
    '中文与空格不影响取数',
    periodSelectionKey({ version: '1.4', phase: '第 1 期（上半）' }) === '1.4-1',
  )
}

console.log('\n[findIndexBySelectionKey：从 URL 还原选中项]')
{
  const list = [
    { version: '1.4', phase: '第 1 期' },
    { version: '1.5', phase: '第 2 期' },
    { version: '2.0', phase: '第 3 期' },
  ]
  check('命中第 2 项', findIndexBySelectionKey(list, '1.5-2') === 1)
  check('命中首项', findIndexBySelectionKey(list, '1.4-1') === 0)
  check('命中末项', findIndexBySelectionKey(list, '2.0-3') === 2)
  check('URL 键不存在 → -1（调用方退回默认）', findIndexBySelectionKey(list, undefined) === -1)
  check('URL 指向已删除的期 → -1', findIndexBySelectionKey(list, '9.9-9') === -1)
  check('空列表 → -1', findIndexBySelectionKey([], '1.4-1') === -1)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
