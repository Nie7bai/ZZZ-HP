/**
 * 官方预设词条库：排序值唯一性（保存路径）。
 *
 * 用户口径（2026-09-13）：「这个排序值0-49不允许重复保存」——
 * 同号会让「谁先谁后」没有唯一答案。拦住它有两道：
 * 1. 控制器：逐条校验时挑出同号，回 **400**（友好消息，指明第几条撞第几条）；
 * 2. service：写库前的最终闸门（脚本等不经控制器的调用方也挡），
 *    且在 `ensureTables()` **之前**触发。
 *
 * 本文件里的用例**全部在触库之前返回**（400 或抛错），所以不需要数据库、
 * 也不会往真库里写东西 —— 谁把闸门挪到写库之后，这里会红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { replaceAffixPresetHandler } from '../src/controllers/affixPresetController.js'
import { findDuplicateSortValue, replaceAffixPreset } from '../src/services/affixPresetService.js'

/** 假 res：只用得上 status().json() 链（与 utils/response.js 的用法一致） */
function createRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

function entry(id, sortOrder, overrides = {}) {
  return {
    id,
    label: id,
    target: 'panel:dmgBonus',
    perRoll: 1,
    cap: 0,
    group: '',
    rollCost: 1,
    enabledByDefault: false,
    sortOrder,
    ...overrides,
  }
}

test('findDuplicateSortValue：无重复回 null，有重复回第一对', () => {
  assert.equal(findDuplicateSortValue([]), null)
  assert.equal(findDuplicateSortValue([0, 1, 2, 40, 49]), null)
  assert.deepEqual(findDuplicateSortValue([0, 40, 40, 49]), {
    value: 40,
    firstIndex: 1,
    secondIndex: 2,
  })
  // 第一处重复优先（后面的重复不再找）
  assert.deepEqual(findDuplicateSortValue([3, 3, 5, 5]), { value: 3, firstIndex: 0, secondIndex: 1 })
})

test('控制器：条目排序值重复 → 400，且消息指明是第几条撞第几条', async () => {
  const res = createRes()
  await replaceAffixPresetHandler(
    {
      body: {
        scheme: '测试方案',
        entries: [entry('a', 10), entry('b', 11), entry('c', 11)],
        groups: [],
      },
    },
    res,
  )
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /^第 3 条：/)
  assert.match(res.body.message, /与第 2 条重复/)
})

test('控制器：分组排序值重复 → 400', async () => {
  const res = createRes()
  await replaceAffixPresetHandler(
    {
      body: {
        scheme: '测试方案',
        entries: [],
        groups: [
          { name: 'g1', cap: 0, sortOrder: 0 },
          { name: 'g2', cap: 0, sortOrder: 0 },
        ],
      },
    },
    res,
  )
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /^第 2 个分组：/)
  assert.match(res.body.message, /与第 1 个分组重复/)
})

test('控制器：字符串数字与数字按同一个值算（"40" 与 40 重复）', async () => {
  const res = createRes()
  await replaceAffixPresetHandler(
    {
      body: {
        scheme: '测试方案',
        entries: [entry('a', '40'), entry('b', 40)],
        groups: [],
      },
    },
    res,
  )
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /与第 1 条重复/)
})

test('service：排序值重复在触库之前抛错，不写库', async () => {
  await assert.rejects(
    () =>
      replaceAffixPreset({
        scheme: '测试方案',
        entries: [entry('a', 7), entry('b', 7)],
        groups: [],
      }),
    /条目排序值重复：第 1 条与第 2 条同为 7/,
  )
  await assert.rejects(
    () =>
      replaceAffixPreset({
        scheme: '测试方案',
        entries: [],
        groups: [
          { name: 'g1', cap: 0, sortOrder: 2 },
          { name: 'g2', cap: 0, sortOrder: 2 },
        ],
      }),
    /分组排序值重复/,
  )
})

/**
 * 第三族落点 `gain:`（增益字段，2026-09-13 步骤 58）。
 *
 * 判读方式：故意让排序值重复 —— 若 `gain:` 被前缀闸门拦下，报错会是「目标须以…开头」；
 * 若它通过校验，报错才是「与第 N 条重复」。**错误文案就是闸门位置的证据**，
 * 且两条用例都在触库之前返回，不碰数据库。
 */
test('控制器：gain: 目标通过前缀校验（不被「目标须以…开头」拦住）', async () => {
  const res = createRes()
  await replaceAffixPresetHandler(
    {
      body: {
        scheme: '测试方案',
        entries: [entry('a', 5, { target: 'gain:inCombatAtkPercent' }), entry('b', 5)],
        groups: [],
      },
    },
    res,
  )
  assert.equal(res.statusCode, 400)
  assert.doesNotMatch(res.body.message, /目标须以/)
  assert.match(res.body.message, /与第 1 条重复/)
})

test('控制器：不属于三族命名空间的目标仍被拦下', async () => {
  const res = createRes()
  await replaceAffixPresetHandler(
    {
      body: {
        scheme: '测试方案',
        entries: [entry('a', 5, { target: 'bogus:whatever' })],
        groups: [],
      },
    },
    res,
  )
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /目标须以/)
})
