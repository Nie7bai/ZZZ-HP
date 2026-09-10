// Run: npx vite-node scripts/test-buff-catalog-cache.mjs
import assert from 'node:assert/strict'
import { createEmptyBuffStatModifiers } from '../src/utils/calculatorUi.ts'
import {
  collectPanelBuffMods,
  invalidateBuffCatalogCache,
} from '../src/utils/panelBuffCalc.ts'

function makeBangboo(atkFlat) {
  return {
    id: 'test-bangboo',
    name: '测试邦布',
    avatar_image: null,
    effectBlocks: [
      {
        id: 'blk-1',
        name: '固定',
        note: '',
        effects: [
          {
            id: 'eff-atk',
            kind: 'fixed',
            stat: 'atk',
            value: atkFlat,
            scope: 'general',
            applyTarget: 'team',
            enabledDefault: true,
          },
        ],
      },
    ],
    effects: [],
    refinementEffects: [[], [], [], [], []],
    refinementEffectBlocks: [[], [], [], [], []],
  }
}

function makeCtx(bangboo) {
  return {
    teamSlots: [{ agentId: '', rank: 0, wengineId: '', wengineRefine: 1 }],
    agents: [],
    wengines: [],
    bangboo,
    bangbooRefine: 1,
    mainSlotIndex: 0,
    driveDiscs: [],
    skipConvert: true,
    extraMods: createEmptyBuffStatModifiers(),
  }
}

invalidateBuffCatalogCache()

const bangboo = makeBangboo(100)
const ctx = makeCtx(bangboo)
const first = collectPanelBuffMods(ctx)
assert.equal(first.atk, 100, '首次应计入邦布攻击 +100')

bangboo.effectBlocks[0].effects[0].value = 0
const stale = collectPanelBuffMods(ctx)
assert.equal(stale.atk, 100, '未失效时缓存应仍返回旧攻击 100')

invalidateBuffCatalogCache()
const fresh = collectPanelBuffMods(ctx)
assert.equal(fresh.atk, 0, '失效后应使用新效果攻击 0')

bangboo.effectBlocks[0].effects[0].value = 50
invalidateBuffCatalogCache()
const again = collectPanelBuffMods(ctx)
assert.equal(again.atk, 50, '再次失效后应读到攻击 +50')

// ---- 缓存键的部件记忆化：契约与已知边界 ----
//
// `buildBuffCatalogKey()` 会把 extraMods / buffSelection / skillContext 按**对象身份**
// 记住序列化结果（单次评估要构建约 800 次键，重复 stringify 是纯浪费）。
//
// 由此带来一个已知边界：**就地**修改这些对象时，键不再随内容变化。
// - 契约内的做法（改完调 invalidateBuffCatalogCache）不受影响 —— 见下面第一段；
// - 契约外的做法（就地改而不失效）在 skipConvert=true 下会返回旧值。修复前的实现
//   会因键变化而「意外重算」，所以这是记忆化带来的行为差异，已核对应用内不存在
//   就地修改这些对象的调用方（2026-09-10 全量检索 src/，无命中）。
{
  invalidateBuffCatalogCache()

  const typedCtx = makeCtx(makeBangboo(0))
  const extraMods = createEmptyBuffStatModifiers()
  extraMods.atk = 30
  typedCtx.extraMods = extraMods
  typedCtx.skipConvert = true

  assert.equal(collectPanelBuffMods(typedCtx).atk, 30, '首次应读到 extraMods 的攻击 +30')

  // 契约内：就地改 + 失效 → 必须读到新值
  extraMods.atk = 70
  invalidateBuffCatalogCache()
  assert.equal(
    collectPanelBuffMods(typedCtx).atk,
    70,
    '就地修改 extraMods 后调 invalidate，应读到新值 +70',
  )

  // 契约外：就地改而不失效 → skipConvert 下返回旧值（已记录的行为边界）
  extraMods.atk = 120
  assert.equal(
    collectPanelBuffMods(typedCtx).atk,
    70,
    '未失效时就地改：返回旧值（契约要求调用方负责失效）',
  )
}

console.log('test-buff-catalog-cache: ok')
