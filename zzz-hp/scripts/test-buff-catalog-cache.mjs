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

console.log('test-buff-catalog-cache: ok')
