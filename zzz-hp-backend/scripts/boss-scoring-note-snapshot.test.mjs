/**
 * 得分机制（多套）在「怪物基础库快照」与「赛季内容快照」里的往返。
 *
 * 背景：得分机制是纯文本、不参与计算，早期快照字段清单没有带上 `scoring_note_sets` /
 * `scoring_note_set_id`，导入导出一圈后数据会静默丢失。这里按仓库既有口径：
 * 工具函数用行为用例断言，快照 SQL 用源码守卫断言（快照模块依赖 DB 连接，测试内不连库）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  mirrorScoringNoteLegacy,
  normalizeScoringNoteSet,
  parseScoringNoteSetsJson,
  resolveScoringNoteSet,
  scoringNoteSetsFromLegacy,
  serializeScoringNoteSets,
} from '../src/utils/bossScoringNoteSets.js'

const snapshotSource = readFileSync(
  new URL('../src/utils/bossInfoSnapshot.js', import.meta.url),
  'utf8',
)
const snapshot = snapshotSource.replace(/\s+/g, ' ')
const seasonSource = readFileSync(
  new URL('../src/services/seasonSnapshotService.js', import.meta.url),
  'utf8',
)

test('单套归一化：只留 id / label / name / text，全空视为无效', () => {
  assert.deepEqual(normalizeScoringNoteSet({ id: 'a', label: ' 1.5第一期 ', text: ' 文本 ' }), {
    id: 'a',
    label: '1.5第一期',
    name: '得分机制',
    text: '文本',
  })
  assert.equal(normalizeScoringNoteSet({ label: '', name: '', text: '' }), null)
  assert.equal(normalizeScoringNoteSet(null), null)
})

test('多套解析：字符串 JSON / 数组都接受，重复 id 自动加后缀', () => {
  const sets = parseScoringNoteSetsJson(
    JSON.stringify([
      { id: 'dup', text: '甲' },
      { id: 'dup', text: '乙' },
      { text: '' },
    ]),
  )
  assert.deepEqual(
    sets.map((set) => set.id),
    ['dup', 'dup_2'],
  )
  assert.deepEqual(parseScoringNoteSetsJson('不是 JSON'), [])
  assert.deepEqual(parseScoringNoteSetsJson(null), [])
})

test('旧单列 ↔ 第一套镜像（老快照只有一段文本时仍能读）', () => {
  const sets = scoringNoteSetsFromLegacy('  旧文本  ')
  assert.equal(sets.length, 1)
  assert.equal(sets[0].id, 'legacy')
  assert.equal(mirrorScoringNoteLegacy(sets), '旧文本')
  assert.equal(mirrorScoringNoteLegacy([]), null)
  assert.deepEqual(JSON.parse(serializeScoringNoteSets(sets))[0].text, '旧文本')
})

test('按绑定 id 取套：命中取该套，空 / 找不到回落第一套', () => {
  const sets = parseScoringNoteSetsJson([
    { id: 'a', label: 'A', text: '甲' },
    { id: 'b', label: 'B', text: '乙' },
  ])
  assert.equal(resolveScoringNoteSet(sets, 'b')?.text, '乙')
  assert.equal(resolveScoringNoteSet(sets, '')?.text, '甲')
  assert.equal(resolveScoringNoteSet(sets, 'missing')?.text, '甲')
  assert.equal(resolveScoringNoteSet([], 'b'), null)
})

test('怪物基础库快照：SELECT / 导出行 / INSERT / UPDATE 都带 scoring_note*', () => {
  const selectColumns = snapshot.match(/SELECT id, boss_name.*? FROM boss_info/)?.[0] ?? ''
  assert.ok(selectColumns.includes('scoring_note, scoring_note_sets'), selectColumns)

  assert.ok(
    snapshot.includes(
      'scoringNote: mirrorScoringNoteLegacy(scoringNoteSets) ?? row.scoring_note ?? null, scoringNoteSets,',
    ),
  )

  const insertStatements = [...snapshot.matchAll(/INSERT INTO boss_info \( ([^)]*?) \) VALUES \(([^`]*?)\)`/g)]
  assert.equal(insertStatements.length, 4)
  for (const [statement, columns, placeholders] of insertStatements) {
    const columnList = columns.split(',').map((column) => column.trim())
    assert.ok(columnList.includes('scoring_note'), statement)
    assert.ok(columnList.includes('scoring_note_sets'), statement)
    assert.equal(
      placeholders.split(',').length,
      columnList.length,
      `占位符与列数不一致：${statement}`,
    )
  }

  const updateColumns = snapshot.match(/UPDATE boss_info SET (.*?) WHERE id = \?`/)?.[1] ?? ''
  assert.ok(updateColumns.includes('scoring_note = ?'))
  assert.ok(updateColumns.includes('scoring_note_sets = ?'))

  const params = snapshot.match(/const params = \[(.*?)\]/)?.[1] ?? ''
  assert.ok(params.includes('item.scoringNote,'))
  assert.ok(params.includes('item.scoringNoteSets,'))

  const updateParams = snapshot.match(/UPDATE boss_info[\s\S]*?WHERE id = \?`, \[(.*?)\],/)?.[1] ?? ''
  assert.ok(updateParams.includes('item.scoringNote,'))
  assert.ok(updateParams.includes('item.scoringNoteSets,'))
})

test('怪物基础库快照：导入 / 导出都先补 scoring_note* 列', () => {
  assert.equal((snapshot.match(/await ensureBossScoringNoteSchema\(\)/g) ?? []).length, 2)
  const [beforeImport, importFunction = ''] = snapshot.split('export async function importBossInfoSnapshot')
  assert.ok(beforeImport.includes('await ensureBossScoringNoteSchema()'))
  assert.ok(importFunction.includes('await ensureBossScoringNoteSchema()'))
})

test('赛季内容快照：期数行的得分机制绑定随导出 / 导入往返', () => {
  assert.ok(
    seasonSource.includes('scoring_note_set_id: row.scoring_note_set_id ? String(row.scoring_note_set_id) : null'),
  )
  assert.ok(seasonSource.includes('scoring_note_set_id: row.scoring_note_set_id ?? null,'))
})
