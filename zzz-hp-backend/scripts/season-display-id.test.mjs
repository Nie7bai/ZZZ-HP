/**
 * 防卫 / 危局期数显示 ID 自动续推
 * 运行：node --test scripts/season-display-id.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  versionPhaseToDisplayId,
  buildDefenseDisplayIdMap,
  resolveDefenseSeasonOrder,
} from '../src/utils/defenseSeasonId.js'
import { crisisPhaseNumericId } from '../src/services/crisisTidService.js'

test('防卫：表内 3.1-3 仍为 62057', () => {
  assert.equal(versionPhaseToDisplayId('3.1', 3), 62057)
})

test('防卫：单期新开 3.1-4 → 62058', () => {
  assert.equal(versionPhaseToDisplayId('3.1', 4), 62058)
})

test('防卫：多期一并排序时连续 +1', () => {
  const extras = [
    { version: '3.1', phase: 4 },
    { version: '3.2', phase: 1 },
    { version: '3.2', phase: 2 },
  ]
  const map = buildDefenseDisplayIdMap(extras)
  assert.equal(map.get('3.1-4'), '62058')
  assert.equal(map.get('3.2-1'), '62059')
  assert.equal(map.get('3.2-2'), '62060')
  assert.equal(map.get('3.1-3'), '62057')
})

test('防卫：resolve 顺序把新期接在表末', () => {
  const order = resolveDefenseSeasonOrder([{ version: '3.2', phase: 1 }])
  const last = order[order.length - 1]
  assert.equal(last.version, '3.2')
  assert.equal(last.phase, 1)
})

test('危局 phaseId：3.1 第1期 → 311', () => {
  assert.equal(crisisPhaseNumericId('3.1', 1), 311)
  assert.equal(crisisPhaseNumericId('3.2', 1), 321)
})
