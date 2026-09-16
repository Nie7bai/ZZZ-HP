import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import {
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyMindscapeBuffs,
} from '../src/utils/calculatorUi.ts'
import { createEmptyExternalPanel } from '../src/types/calculatorPanel.ts'
import { invalidateBuffCatalogCache } from '../src/utils/panelBuffCalc.ts'

export function dummyBangboo() {
  return {
    id: 'none',
    name: 'x',
    avatar_image: null,
    effects: [],
    refinementEffects: [],
    fixedMods: createEmptyBuffStatModifiers(),
    refinementMods: [],
  }
}

export function blankMindscape() {
  return createEmptyMindscapeBuffs()
}

export function mindscapeWithEffects(effects) {
  const ranks = createEmptyMindscapeBuffs()
  ranks[0] = {
    effectBlocks: [{ id: 'blk', name: '测', effects }],
    effects,
    selfMods: createEmptyBuffStatModifiers(),
    teamMods: createEmptyBuffStatModifiers(),
  }
  return ranks
}

export function testAgent(id, overrides = {}) {
  return {
    id,
    name: id,
    profession: '强攻',
    element: '电',
    supportNeeds: [],
    avatar_image: null,
    note: '',
    basePanel: {
      ...createEmptyAgentBasePanel(),
      hp: 10000,
      atk: 2000,
      def: 800,
      critRate: 5,
      critDmg: 50,
      mastery: 100,
      anomalyControl: 94,
      energyRegen: 1.2,
      directDmgMult: 100,
    },
    mindscapeNotes: ['', '', '', '', '', '', ''],
    mindscapeBuffs: blankMindscape(),
    ...overrides,
  }
}

export function testSlot(agentId, rank = 0) {
  return {
    agentId,
    rank,
    wengineId: 'none',
    wengineRefine: 1,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  }
}

export function makePanelCtx(overrides = {}) {
  // 目录缓存键不含影画效果正文。合成夹具反复用同一槽位 id 换效果，
  // 不失效就会串台（失衡/转模测曾因此全读到上一份 dmgBonus）。
  invalidateBuffCatalogCache()
  const agent = testAgent('a')
  return {
    teamSlots: [testSlot('a')],
    agents: [agent],
    wengines: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    mainSlotIndex: 0,
    driveDiscs: [],
    skillContext: {
      damageKind: 'direct',
      categoryId: 'basic',
      subcategoryId: null,
      coords: [{ category: 'basic', subcategoryId: null }],
      element: '电',
      staggerPhase: 'stagger',
      isFollowUp: false,
    },
    ...overrides,
  }
}

export function makePanel(overrides = {}) {
  return {
    ...createEmptyExternalPanel(),
    hp: 10000,
    atk: 2000,
    def: 800,
    critRate: 5,
    critDmg: 50,
    mastery: 100,
    anomalyControl: 94,
    energyRegen: 1.2,
    directDmgMult: 100,
    ...overrides,
  }
}

export function fixedEffect(id, stat, value, extra = {}) {
  return createEmptyBuffEffect({
    id,
    scope: extra.scope ?? 'general',
    applyTarget: extra.applyTarget ?? 'self',
    applySituation: extra.applySituation ?? 'global',
    kind: 'fixed',
    stat,
    value,
    skillTargets: extra.skillTargets,
    enabledDefault: true,
  })
}

export function convertEffect(id, stat, convert) {
  return createEmptyBuffEffect({
    id,
    scope: 'general',
    applyTarget: 'self',
    kind: 'convert',
    stat,
    value: 0,
    convert,
    enabledDefault: true,
  })
}

export function affixEntry(id, target, perRoll) {
  return {
    id,
    label: id,
    target,
    perRoll,
    cap: 0,
    // 正式条目：给个组名。空组 = 临时条目，既不进最优计算、也不出收益表（2026-09-16 口径）
    group: '副词条',
    rollCost: 1,
    enabledByDefault: true,
  }
}
