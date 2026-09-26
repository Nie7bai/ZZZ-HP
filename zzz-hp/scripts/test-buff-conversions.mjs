// Run: npx vite-node scripts/test-buff-conversions.mjs
import assert from 'node:assert/strict'
import { BUFFS_JSON, readJson } from './_paths.mjs'
import {
  collectEffectsFromPack,
  resolveConvertValue,
  resolveEffectsToMods,
} from '../src/utils/buffEffect.ts'
import {
  normalizeSelfTeamBuffs,
  normalizeWengineRefinementBuffs,
} from '../src/utils/calculatorUi.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { applyBuffModsToPanel } from '../src/utils/panelBuffCalc.ts'

const data = readJson(BUFFS_JSON)
let passed = 0
let failed = 0

function check(name, actual, expected) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`)
  }
}

function manualInputs(effects, base) {
  return Object.fromEntries(
    effects
      .filter((effect) => effect.kind === 'convert' && effect.convert.panelSource === 'manual')
      .map((effect) => [effect.id, base]),
  )
}

// 两种存储表示都走实际标准化与求值入口，避免只修 blocks 后旧 effects 仍带错值。
for (const representation of ['effectBlocks', 'effects']) {
  const packInput = (pack) => ({ [representation]: pack[representation] })
  const agentEffects = (agentId, ranks) => {
    const agent = data.agents.find((entry) => entry.id === agentId)
    assert.ok(agent, `missing agent: ${agentId}`)
    return ranks.flatMap((rank) =>
      collectEffectsFromPack(normalizeSelfTeamBuffs(packInput(agent.mindscapeBuffs[rank]))),
    )
  }
  const label = (name) => `${representation}: ${name}`

  const sunnaMindscape = agentEffects('sunna', [6])
  for (const [atk, critDmg] of [[0, 0], [2000, 60], [3500, 105], [4000, 105]]) {
    const external = { ...createDefaultExternalPanel(), atk, critDmg: 50 }
    const mods = resolveEffectsToMods(sunnaMindscape, {
      applyTarget: 'self',
      panelSourceValues: { external, final: { atk: 6000 } },
    })
    check(label(`千夏6影 atk=${atk} 暴伤百分点`), mods.critDmg, critDmg)
    check(label(`千夏6影 atk=${atk} 面板暴伤`), applyBuffModsToPanel(external, mods).critDmg, 50 + critDmg)
  }

  const sunnaCore = agentEffects('sunna', [0])
  for (const [atk, coreBonus] of [[0, 0], [3000, 900], [3500, 1050], [4000, 1050], [5000, 1050]]) {
    const mods = resolveEffectsToMods(sunnaCore, {
      applyTarget: 'team', convertInputs: manualInputs(sunnaCore, atk),
    })
    // 同包另有帷幕固定攻击 +50，不属于核心 1050 上限。
    check(label(`千夏核心与帷幕 atk=${atk}`), mods.atk, coreBonus + 50)
  }
  check(label('千夏核心默认输入与帷幕'), resolveEffectsToMods(sunnaCore).atk, 1100)

  const qingyi = agentEffects('qingyi', [0])
  for (const [impact, atk] of [[100, 0], [120, 0], [200, 480], [220, 600], [250, 600]]) {
    const mods = resolveEffectsToMods(qingyi, {
      applyTarget: 'self', panelSourceValues: { external: { impact: 100 }, final: { impact } },
    })
    check(label(`青衣额外能力 impact=${impact}`), mods.atk, atk)
  }

  const lucia = agentEffects('lucia', [6])
  for (const [initialHp, finalHp, atk] of [[24000, 24000, 480], [24000, 30000, 480], [30000, 36000, 600], [0, 30000, 0]]) {
    const mods = resolveEffectsToMods(lucia, {
      applyTarget: 'self',
      panelSourceValues: { external: { hp: initialHp }, final: { hp: finalHp } },
    })
    check(label(`卢西娅6影 hp=${initialHp}/${finalHp}`), mods.atk, atk)
  }

  const astraYao = agentEffects('astrayao', [0, 2])
  for (const [atk, expected] of [[0, 0], [2000, 1080], [3000, 1600], [3428.56, 1600], [4000, 1600], [5000, 1600]]) {
    const mods = resolveEffectsToMods(astraYao, {
      applyTarget: 'team', convertInputs: manualInputs(astraYao, atk),
    })
    check(label(`耀嘉音核心与2影 atk=${atk}`), mods.atk, expected)
  }

  const cissia = agentEffects('cissia', [0, 1])
  for (const [energyRegen, expected] of [[100, 8.4], [260, 22.4], [368, 35], [400, 35], [600, 35]]) {
    const mods = resolveEffectsToMods(cissia, {
      applyTarget: 'team', beneficiaryElement: '电',
      convertInputs: manualInputs(cissia, energyRegen),
    })
    check(label(`希希芙核心与1影 energyRegen=${energyRegen / 100}`), mods.reduceDefense, expected)
  }
  check(label('希希芙无视防御不适用于火属性'), resolveEffectsToMods(cissia, {
    applyTarget: 'team', beneficiaryElement: '火', convertInputs: manualInputs(cissia, 400),
  }).reduceDefense, 0)

  const bloodCasket = data.wengines.find((engine) => engine.id === 'BloodCasket')
  assert.ok(bloodCasket, 'missing BloodCasket')
  const refinements = normalizeWengineRefinementBuffs(bloodCasket.refinementBuffs.map(packInput))
  for (const [index, cap] of [24, 28, 32, 36, 40].entries()) {
    const effects = collectEffectsFromPack(refinements[index])
    for (const [critRate, expected] of [[50, 0], [100, 0], [125, cap / 2], [150, cap], [200, cap]]) {
      const mods = resolveEffectsToMods(effects, {
        applyTarget: 'self',
        panelSourceValues: { external: { critRate: 50 }, final: { critRate } },
      })
      check(label(`血髓秘匣精炼${index + 1} critRate=${critRate}`), mods.dmgBonus, expected)
    }
  }
}

const conversion = {
  id: 'test-signed-cap', kind: 'convert', scope: 'general', applyTarget: 'self', stat: 'atk',
  convert: { from: 'atk', panelSource: 'manual', ratioPercent: 35, cap: 1200 },
}
for (const [ratioPercent, cap, base, expected] of [
  [35, 1200, 3000, 1050],
  [35, 1200, 4000, 1200],
  [-35, 1200, 3000, -1050],
  [-35, 1200, 4000, -1200],
  [-35, null, 4000, -1400],
  [35, null, 4000, 1400],
  [-35, 0, 4000, 0],
  [35, 0, 4000, 0],
  [-35, 1200, 0, 0],
]) {
  const effect = { ...conversion, convert: { ...conversion.convert, ratioPercent, cap } }
  check(`通用转模 ratio=${ratioPercent} cap=${cap} base=${base}`,
    resolveConvertValue(effect, {}, base), expected)
}

console.log(`buff conversions: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
