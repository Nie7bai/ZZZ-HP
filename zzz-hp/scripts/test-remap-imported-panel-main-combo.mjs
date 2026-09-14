/**
 * 面板导入局外上反推换主属性：同面板、同主属性应近似恒等；换爆伤主属性应抬高爆伤字段。
 * 生产走 remapImportedPanelViaEffects；字段加减只作对照。
 * 运行：npx vite-node scripts/test-remap-imported-panel-main-combo.mjs
 */
import assert from 'node:assert/strict'
import { createEmptyExternalPanel } from '../src/types/calculatorPanel.ts'
import { remapImportedExternalPanelForMainCombo } from '../src/utils/affixPanelCalc.ts'
import { remapImportedPanelViaEffects } from '../src/utils/panelPipeline.ts'
import { createEmptyBuffStatModifiers } from '../src/utils/calculatorUi.ts'

const bases = {
  agentHp: 10000,
  atkBase: 2000,
  agentDef: 800,
  anomalyControlBase: 100,
  energyRegenBase: 1.2,
}

const panel = {
  ...createEmptyExternalPanel(),
  hp: 15000,
  atk: 3000,
  def: 1000,
  critRate: 50,
  critDmg: 100,
  dmgBonus: 30,
  penRate: 0,
  mastery: 0,
  impact: 0,
  anomalyControl: 130,
  energyRegen: 1.2,
}

function twoPieceDisc(id, mods) {
  return {
    id,
    name: id,
    avatar_image: null,
    twoPieceNote: '',
    fourPieceNote: '',
    twoPieceEffects: [],
    twoPieceMods: { ...createEmptyBuffStatModifiers(), ...mods },
    fourPieceBuffs: { effectBlocks: [], effects: [] },
  }
}

function assertSamePanel(actual, expected, label) {
  const keys = [
    'hp',
    'atk',
    'def',
    'critRate',
    'critDmg',
    'dmgBonus',
    'penRate',
    'mastery',
    'impact',
    'anomalyControl',
    'energyRegen',
    'reduceDefense',
    'resPen',
  ]
  for (const key of keys) {
    assert.equal(actual[key], expected[key], `${label} ${key}`)
  }
}

const fromMains = {
  slot4MainStat: 'critDmg',
  slot5MainStat: 'dmgBonus',
  slot6MainStat: '',
}
const sameInput = {
  panel,
  fromMains,
  toMains: fromMains,
  fromTwoPieceId: 'none',
  toTwoPieceId: 'none',
  fourPieceDriveDiscId: 'none',
  driveDiscs: [],
  ...bases,
}
const same = remapImportedPanelViaEffects(sameInput)
assert.equal(same.critDmg, panel.critDmg)
assert.equal(same.atk, panel.atk)
assertSamePanel(same, remapImportedExternalPanelForMainCombo(sameInput), '同组合对照')

const swappedInput = {
  panel,
  fromMains,
  toMains: {
    slot4MainStat: 'critRate',
    slot5MainStat: 'dmgBonus',
    slot6MainStat: '',
  },
  fromTwoPieceId: 'none',
  toTwoPieceId: 'none',
  fourPieceDriveDiscId: 'none',
  driveDiscs: [],
  ...bases,
}
const swapped = remapImportedPanelViaEffects(swappedInput)
assert.equal(swapped.critDmg, panel.critDmg - 48)
assert.equal(swapped.critRate, panel.critRate + 24)
assertSamePanel(swapped, remapImportedExternalPanelForMainCombo(swappedInput), '爆伤→暴击对照')

const atkSwapInput = {
  panel,
  fromMains: { slot4MainStat: '', slot5MainStat: '', slot6MainStat: '' },
  toMains: { slot4MainStat: '', slot5MainStat: 'externalAtkPercent', slot6MainStat: '' },
  fromTwoPieceId: 'none',
  toTwoPieceId: 'none',
  fourPieceDriveDiscId: 'none',
  driveDiscs: [],
  ...bases,
}
const atkSwap = remapImportedPanelViaEffects(atkSwapInput)
assert.equal(atkSwap.atk, panel.atk + bases.atkBase * 0.3)
assertSamePanel(atkSwap, remapImportedExternalPanelForMainCombo(atkSwapInput), '空→攻击%对照')

const discs = [
  twoPieceDisc('atk-2pc', {
    externalAtkPercent: 10,
    hp: 500,
    anomalyControl: 8,
    energyRegenFlat: 0.24,
    reduceDefense: 15,
  }),
]
const twoPieceInput = {
  panel,
  fromMains,
  toMains: fromMains,
  fromTwoPieceId: 'none',
  toTwoPieceId: 'atk-2pc',
  fourPieceDriveDiscId: 'none',
  driveDiscs: discs,
  ...bases,
}
const withTwoPiece = remapImportedPanelViaEffects(twoPieceInput)
assert.equal(withTwoPiece.atk, panel.atk + bases.atkBase * 0.1)
assert.equal(withTwoPiece.hp, panel.hp + 500)
assert.equal(withTwoPiece.anomalyControl, panel.anomalyControl + 8)
assert.equal(withTwoPiece.energyRegen, panel.energyRegen + 0.24)
assert.equal(withTwoPiece.reduceDefense, panel.reduceDefense + 15)
assertSamePanel(withTwoPiece, remapImportedExternalPanelForMainCombo(twoPieceInput), '2 件套对照')

console.log('test-remap-imported-panel-main-combo: ok')
