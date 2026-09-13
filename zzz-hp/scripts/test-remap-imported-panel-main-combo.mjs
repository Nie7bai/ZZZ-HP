/**
 * 面板导入局外上反推换主属性：同面板、同主属性应近似恒等；换爆伤主属性应抬高爆伤字段。
 * 运行：npx vite-node scripts/test-remap-imported-panel-main-combo.mjs
 */
import assert from 'node:assert/strict'
import { createEmptyExternalPanel } from '../src/types/calculatorPanel.ts'
import { remapImportedExternalPanelForMainCombo } from '../src/utils/affixPanelCalc.ts'

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

const fromMains = {
  slot4MainStat: 'critDmg',
  slot5MainStat: 'dmgBonus',
  slot6MainStat: '',
}
const same = remapImportedExternalPanelForMainCombo({
  panel,
  fromMains,
  toMains: fromMains,
  fromTwoPieceId: 'none',
  toTwoPieceId: 'none',
  fourPieceDriveDiscId: 'none',
  driveDiscs: [],
  ...bases,
})
assert.equal(same.critDmg, panel.critDmg)
assert.equal(same.atk, panel.atk)

const swapped = remapImportedExternalPanelForMainCombo({
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
})
assert.equal(swapped.critDmg, panel.critDmg - 48)
assert.equal(swapped.critRate, panel.critRate + 24)

const atkSwap = remapImportedExternalPanelForMainCombo({
  panel,
  fromMains: { slot4MainStat: '', slot5MainStat: '', slot6MainStat: '' },
  toMains: { slot4MainStat: '', slot5MainStat: 'externalAtkPercent', slot6MainStat: '' },
  fromTwoPieceId: 'none',
  toTwoPieceId: 'none',
  fourPieceDriveDiscId: 'none',
  driveDiscs: [],
  ...bases,
})
assert.equal(atkSwap.atk, panel.atk + bases.atkBase * 0.3)

console.log('test-remap-imported-panel-main-combo: ok')
