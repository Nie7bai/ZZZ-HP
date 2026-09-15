/**
 * 游戏专用分配规则：写死口袋 / 付费占用 / 组额度。不跑完整 8 路伤害求解。
 * 运行：npx vite-node scripts/test-game-affix-rules.mjs
 */
import {
  GAME_POCKET_COMBOS,
  buildGameAffixBranch,
  createGameAffixLibraryEntries,
  defaultGameAffixEnabledIds,
  gameAffixGroupCaps,
  gamePaidMainId,
  isGamePaidMainId,
} from '../src/utils/gameAffixRules.ts'

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

const entries = createGameAffixLibraryEntries()
const enabledIds = defaultGameAffixEnabledIds(entries)

console.log('\n[游戏专用方案]')
check('8 个口袋组合', GAME_POCKET_COMBOS.length === 8)
check(
  '攻击% 副词条 cap 占位为 6',
  entries.find((entry) => entry.id === 'substat:atkPercent')?.cap === 6,
)

{
  const paid = buildGameAffixBranch({
    entries,
    enabledIds,
    combo: { slot4: 'paid', slot5: 'free', slot6: 'free' },
    extraCost: 1,
  })
  const slot5Paid = paid.entries.some((entry) => entry.id === gamePaidMainId(5, 'externalAtkPercent'))
  const slot5Dmg = paid.entries.some((entry) => entry.id === 'main:slot5:dmgBonus')
  const slot4Atk = paid.entries.find((entry) => entry.id === gamePaidMainId(4, 'externalAtkPercent'))
  check('5 号位付费口袋不含付费主属性（本路 5 不付费）', slot5Paid === false)
  check('5 号位不付费口袋含增伤', slot5Dmg === true)
  check('4 号位付费攻击 rollCost = 2', slot4Atk?.rollCost === 2)
  check(
    '4 号位攻击会税副词条攻击%',
    paid.entryCapTaxes.some(
      (tax) =>
        tax.whenEntryId === gamePaidMainId(4, 'externalAtkPercent') &&
        tax.targetEntryId === 'substat:atkPercent' &&
        tax.amount === 1,
    ),
  )
}

{
  const caps = gameAffixGroupCaps(30)
  check('4 号位额度锁 1', caps['4号位'] === 1)
  check('2 件套额度锁 1', caps['2件套'] === 1)
  check('副词条额度 = 总分配 − 4', caps['副词条'] === 26)
}

check('付费 id 识别', isGamePaidMainId('main:slot5:externalAtkPercent'))
check('增伤不是付费', isGamePaidMainId('main:slot5:dmgBonus') === false)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
