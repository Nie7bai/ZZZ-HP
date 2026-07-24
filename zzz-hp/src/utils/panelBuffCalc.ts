import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  BuffEffect,
  BuffStatModifiers,
  CharacterAttrKey,
  DamageCalcKind,
  DriveDiscBuffDoc,
  SkillCalcContext,
  SkillCategoryId,
  WengineBuffDoc,
} from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import {
  cloneEffectInstance,
  collectBlockEntriesFromPack,
  collectEffectsFromPack,
  flatModsToEffects,
  isEffectEnabled,
  resolveEffectsToMods,
} from '@/utils/buffEffect'
import {
  createEmptyBuffStatModifiers,
  createEmptySelfTeamBuffs,
  getMindscapeNote,
  hasNonZeroBuffMods,
  isWengineProfessionMatch,
  mergeBuffStatModifiers,
} from '@/utils/calculatorUi'

export interface DriveDiscSelection {
  twoPieceId: string
  fourPieceId: string
}

export interface BuffSelectionState {
  enabledIds: Record<string, boolean>
  stacksByEffectId: Record<string, number>
  /** 转模：用户手动输入的被转模基础数值 */
  convertInputs: Record<string, number>
}

export interface PanelCalcContext {
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboo: BangbooBuffDoc
  bangbooRefine: number
  mainSlotIndex: number
  driveDiscs: DriveDiscBuffDoc[]
  extraMods?: BuffStatModifiers
  skillContext?: SkillCalcContext | null
  buffSelection?: BuffSelectionState | null
  attrValues?: Partial<Record<CharacterAttrKey, number>>
}

export interface CombatBuffMods {
  vulnerable: number
  globalStaggerVulnerable: number
  staggerVulnerable: number
  staggerVulnerableOnly: number
  special: number
  pierceDmgBonus: number
}

export interface PanelBuffBreakdown {
  totalMods: BuffStatModifiers
  combatMods: CombatBuffMods
  finalPanel: PanelStats
  sources: BuffModSource[]
  collectedEffects: CollectedEffect[]
}

export interface BuffModSource {
  key: string
  label: string
  mods: BuffStatModifiers
  note?: string
  effects?: BuffEffect[]
  blockName?: string
}

export interface CollectedEffect {
  effect: BuffEffect
  sourceKey: string
  sourceLabel: string
  /** 卡片标题用：只要昵称，如「叶瞬光」 */
  providerName: string
  providerAvatar?: string | null
  group: string
  blockId: string
  blockName: string
  /** 块备注 / 影画注释等 */
  blockNote?: string
}

function clampRefine(value: number) {
  return Math.min(5, Math.max(1, Math.round(value)))
}

function defaultSkillContext(
  damageKind: DamageCalcKind = 'direct',
  element?: string,
): SkillCalcContext {
  return {
    damageKind,
    categoryId: 'basic',
    subcategoryId: null,
    element,
  }
}

function resolvePackMods(
  effects: BuffEffect[],
  isMain: boolean,
  ctx: PanelCalcContext,
): BuffStatModifiers {
  return resolveEffectsToMods(effects, {
    applyTargets: isMain ? ['self', 'team'] : ['team'],
    ctx: ctx.skillContext ?? defaultSkillContext('direct', ctx.skillContext?.element),
    element: ctx.skillContext?.element,
    stacksByEffectId: ctx.buffSelection?.stacksByEffectId,
    convertInputs: ctx.buffSelection?.convertInputs,
    attrValues: ctx.attrValues,
    selection: ctx.buffSelection,
  })
}

export function collectSlotDriveDiscEffects(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
  isMain: boolean,
  _options?: { includeTwoPiece?: boolean },
): BuffEffect[] {
  const effects: BuffEffect[] = []

  const fourDisc =
    selection.fourPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.fourPieceId)
      : undefined
  const twoDisc =
    selection.twoPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.twoPieceId)
      : undefined

  function pushTwoPiece(disc: DriveDiscBuffDoc) {
    effects.push(
      ...(disc.twoPieceEffects?.length
        ? disc.twoPieceEffects
        : flatModsToEffects(disc.twoPieceMods, 'self', 'general', `${disc.id}-2pc`)),
    )
  }

  if (isMain) {
    // 主 C：4 件套含其 2 件效果；另选的 2 件套也计入
    if (fourDisc) {
      pushTwoPiece(fourDisc)
      effects.push(...collectEffectsFromPack(fourDisc.fourPieceBuffs))
    }
    if (twoDisc && twoDisc.id !== fourDisc?.id) {
      pushTwoPiece(twoDisc)
    }
    return effects
  }

  if (fourDisc) {
    effects.push(
      ...collectEffectsFromPack(fourDisc.fourPieceBuffs).filter((e) => e.applyTarget === 'team'),
    )
  }
  return effects
}

export function collectSlotDriveDiscMods(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
  isMain: boolean,
  options?: { includeTwoPiece?: boolean },
  ctx?: PanelCalcContext,
): BuffStatModifiers {
  const effects = collectSlotDriveDiscEffects(driveDiscs, selection, isMain, options)
  if (!ctx) {
    return resolveEffectsToMods(effects, {
      applyTargets: isMain ? ['self', 'team'] : ['team'],
      ctx: defaultSkillContext('direct'),
    })
  }
  return resolvePackMods(effects, isMain, ctx)
}

export function collectTeamDriveDiscMods(
  driveDiscs: DriveDiscBuffDoc[],
  teamSlots: TeamSlot[],
  mainIndex: number,
  ctx?: PanelCalcContext,
): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()

  teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    total = mergeBuffStatModifiers(
      total,
      collectSlotDriveDiscMods(
        driveDiscs,
        {
          twoPieceId: slot.twoPieceDriveDiscId,
          fourPieceId: slot.fourPieceDriveDiscId,
        },
        index === mainIndex,
        undefined,
        ctx,
      ),
    )
  })

  return total
}

function driveDiscSourceLabel(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
): string {
  const fourDisc =
    selection.fourPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.fourPieceId)
      : undefined
  const twoDisc =
    selection.twoPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.twoPieceId)
      : undefined
  const parts: string[] = []
  if (fourDisc) parts.push(`4件：${fourDisc.name}`)
  if (twoDisc && twoDisc.id !== fourDisc?.id) parts.push(`2件：${twoDisc.name}`)
  return parts.join(' · ')
}

export function collectAllBuffEffects(ctx: PanelCalcContext): CollectedEffect[] {
  const collected: CollectedEffect[] = []
  const mainIndex = ctx.mainSlotIndex

  function pushPack(
    pack: Parameters<typeof collectBlockEntriesFromPack>[0],
    sourceKey: string,
    sourceLabel: string,
    providerName: string,
    providerAvatar: string | null | undefined,
    groupFor: (effect: BuffEffect) => string,
    matchesTarget: (e: BuffEffect) => boolean,
    extraNote = '',
  ) {
    for (const entry of collectBlockEntriesFromPack(pack)) {
      const effects = entry.effects.filter(matchesTarget)
      for (const effect of effects) {
        const instanced = cloneEffectInstance(effect, sourceKey, entry.blockId)
        collected.push({
          effect: instanced,
          sourceKey,
          sourceLabel,
          providerName,
          providerAvatar: providerAvatar ?? null,
          group: groupFor(effect),
          blockId: entry.blockId,
          blockName: entry.blockName,
          blockNote: [extraNote, entry.blockNote].filter((part) => part.trim()).join('\n'),
        })
      }
    }
  }

  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const isMain = index === mainIndex
    const roleLabel = isMain ? '主C' : '辅助'
    const matchesTarget = (e: BuffEffect) =>
      isMain ? e.applyTarget === 'self' || e.applyTarget === 'team' : e.applyTarget === 'team'
    const clampedRank = Math.min(6, Math.max(0, Math.round(slot.rank)))

    for (let rank = 0; rank <= clampedRank; rank++) {
      const rankBuffs = agent.mindscapeBuffs[rank] ?? createEmptySelfTeamBuffs()
      const mindscapeNote = getMindscapeNote(agent, rank)
      pushPack(
        rankBuffs,
        `agent-${index}-${rank}`,
        `${roleLabel} · ${agent.name} · ${rank}影`,
        agent.name,
        agent.avatar_image,
        (effect) =>
          isMain
            ? effect.applyTarget === 'team'
              ? '全队（含自身）'
              : '自身'
            : '队友',
        matchesTarget,
        mindscapeNote,
      )
    }

    if (slot.wengineId !== 'none') {
      const wengine = ctx.wengines.find((item) => item.id === slot.wengineId)
      // 异职音擎：仅基础属性（baseAtk / advancedStats）生效，不收集增益
      if (wengine && isWengineProfessionMatch(agent.profession, wengine.profession)) {
        const refineIndex = clampRefine(slot.wengineRefine) - 1
        const refineBuffs = wengine.refinementBuffs[refineIndex] ?? createEmptySelfTeamBuffs()
        const sourceLabel = `${roleLabel} · ${agent.name} · 音擎 · ${wengine.name}（精${slot.wengineRefine}）`
        const groupFor = (effect: BuffEffect) =>
          isMain
            ? effect.applyTarget === 'team'
              ? '全队音擎'
              : '自身音擎'
            : '队友音擎'
        pushPack(
          wengine.fixedBuffs,
          `wengine-${index}-fixed`,
          sourceLabel,
          wengine.name,
          wengine.avatar_image,
          groupFor,
          matchesTarget,
        )
        pushPack(
          refineBuffs,
          `wengine-${index}-refine`,
          sourceLabel,
          wengine.name,
          wengine.avatar_image,
          groupFor,
          matchesTarget,
        )
      }
    }

    const selection = {
      twoPieceId: slot.twoPieceDriveDiscId,
      fourPieceId: slot.fourPieceDriveDiscId,
    }
    const fourDisc =
      selection.fourPieceId !== 'none'
        ? ctx.driveDiscs.find((item) => item.id === selection.fourPieceId)
        : undefined
    const twoDisc =
      selection.twoPieceId !== 'none'
        ? ctx.driveDiscs.find((item) => item.id === selection.twoPieceId)
        : undefined
    const group = isMain ? '自身驱动盘' : '队友驱动盘'
    const sourceKey = `drive-disc-${index}`

    if (isMain && fourDisc) {
      const twoKey = `${sourceKey}-4set-2pc`
      const twoBlockId = `${fourDisc.id}-2pc`
      const twoEffects = (
        fourDisc.twoPieceEffects?.length
          ? fourDisc.twoPieceEffects
          : flatModsToEffects(fourDisc.twoPieceMods, 'self', 'general', `${fourDisc.id}-2pc`)
      ).filter(matchesTarget)
      for (const effect of twoEffects) {
        collected.push({
          effect: cloneEffectInstance(effect, twoKey, twoBlockId),
          sourceKey: twoKey,
          sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（2件）`,
          providerName: fourDisc.name,
          providerAvatar: fourDisc.avatar_image,
          group,
          blockId: twoBlockId,
          blockName: `${fourDisc.name} · 2件套`,
          blockNote: fourDisc.twoPieceNote?.trim() || '',
        })
      }
      const fourKey = `${sourceKey}-4set`
      for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
        for (const effect of entry.effects.filter(matchesTarget)) {
          collected.push({
            effect: cloneEffectInstance(effect, fourKey, entry.blockId),
            sourceKey: fourKey,
            sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            providerName: fourDisc.name,
            providerAvatar: fourDisc.avatar_image,
            group,
            blockId: entry.blockId,
            blockName: entry.blockName,
            blockNote: [fourDisc.fourPieceNote?.trim() || '', entry.blockNote]
              .filter(Boolean)
              .join('\n'),
          })
        }
      }
    }
    if (isMain && twoDisc && twoDisc.id !== fourDisc?.id) {
      const twoKey = `${sourceKey}-2set`
      const twoBlockId = `${twoDisc.id}-2pc`
      const twoEffects = (
        twoDisc.twoPieceEffects?.length
          ? twoDisc.twoPieceEffects
          : flatModsToEffects(twoDisc.twoPieceMods, 'self', 'general', `${twoDisc.id}-2pc`)
      ).filter(matchesTarget)
      for (const effect of twoEffects) {
        collected.push({
          effect: cloneEffectInstance(effect, twoKey, twoBlockId),
          sourceKey: twoKey,
          sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${twoDisc.name}（2件）`,
          providerName: twoDisc.name,
          providerAvatar: twoDisc.avatar_image,
          group,
          blockId: twoBlockId,
          blockName: `${twoDisc.name} · 2件套`,
          blockNote: twoDisc.twoPieceNote?.trim() || '',
        })
      }
    }
    if (!isMain && fourDisc) {
      const fourKey = `${sourceKey}-4set`
      for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
        for (const effect of entry.effects.filter(matchesTarget)) {
          collected.push({
            effect: cloneEffectInstance(effect, fourKey, entry.blockId),
            sourceKey: fourKey,
            sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            providerName: fourDisc.name,
            providerAvatar: fourDisc.avatar_image,
            group,
            blockId: entry.blockId,
            blockName: entry.blockName,
            blockNote: [fourDisc.fourPieceNote?.trim() || '', entry.blockNote]
              .filter(Boolean)
              .join('\n'),
          })
        }
      }
    }
  })

  if (ctx.bangboo?.id && ctx.bangboo.id !== 'none') {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    const effects = [
      ...(ctx.bangboo.effects ?? []),
      ...(ctx.bangboo.refinementEffects?.[refineIndex] ?? []),
    ]
    for (const effect of effects) {
      collected.push({
        effect: cloneEffectInstance(effect, 'bangboo', 'bangboo'),
        sourceKey: 'bangboo',
        sourceLabel: `邦布 · ${ctx.bangboo.name}（精${ctx.bangbooRefine}）`,
        providerName: ctx.bangboo.name,
        providerAvatar: ctx.bangboo.avatar_image,
        group: '邦布',
        blockId: 'bangboo',
        blockName: ctx.bangboo.name,
      })
    }
  }

  return collected
}

export function collectPanelBuffModSources(ctx: PanelCalcContext): BuffModSource[] {
  const sources: BuffModSource[] = []
  const mainIndex = ctx.mainSlotIndex
  const skillCtx = ctx.skillContext ?? defaultSkillContext('direct')

  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return

    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const isMain = index === mainIndex
    const roleLabel = isMain ? '主C' : '辅助'
    const matchesTarget = (e: BuffEffect) =>
      isMain ? e.applyTarget === 'self' || e.applyTarget === 'team' : e.applyTarget === 'team'
    const clampedRank = Math.min(6, Math.max(0, Math.round(slot.rank)))

    for (let rank = 0; rank <= clampedRank; rank++) {
      const rankBuffs = agent.mindscapeBuffs[rank] ?? createEmptySelfTeamBuffs()
      const note = getMindscapeNote(agent, rank)
      const blockEntries = collectBlockEntriesFromPack(rankBuffs)
      if (!blockEntries.length && note) {
        sources.push({
          key: `agent-${index}-${rank}`,
          label: `${roleLabel} · ${agent.name} · ${rank}影`,
          mods: createEmptyBuffStatModifiers(),
          note: note || undefined,
          effects: [],
        })
        continue
      }
      blockEntries.forEach((entry, blockIndex) => {
        const sourceKey = `agent-${index}-${rank}`
        const effects = entry.effects
          .filter(matchesTarget)
          .map((effect) => cloneEffectInstance(effect, sourceKey, entry.blockId))
        const mindscapeMods = resolvePackMods(effects, isMain, {
          ...ctx,
          skillContext: skillCtx,
        })
        if (!hasNonZeroBuffMods(mindscapeMods) && !note && !effects.length) return
        sources.push({
          key: `agent-${index}-${rank}-${entry.blockId}`,
          label: `${roleLabel} · ${agent.name} · ${rank}影`,
          mods: mindscapeMods,
          note: blockIndex === 0 ? note || undefined : undefined,
          effects,
          blockName: entry.blockName,
        })
      })
    }

    if (slot.wengineId !== 'none') {
      const wengine = ctx.wengines.find((item) => item.id === slot.wengineId)
      if (wengine && isWengineProfessionMatch(agent.profession, wengine.profession)) {
        const refineIndex = clampRefine(slot.wengineRefine) - 1
        const refineBuffs = wengine.refinementBuffs[refineIndex] ?? createEmptySelfTeamBuffs()
        const packs = [
          { key: 'fixed', pack: wengine.fixedBuffs },
          { key: 'refine', pack: refineBuffs },
        ]
        for (const item of packs) {
          const sourceKey = `wengine-${index}-${item.key}`
          for (const entry of collectBlockEntriesFromPack(item.pack)) {
            const effects = entry.effects
              .filter(matchesTarget)
              .map((effect) => cloneEffectInstance(effect, sourceKey, entry.blockId))
            const wengineMods = resolvePackMods(effects, isMain, {
              ...ctx,
              skillContext: skillCtx,
            })
            if (!hasNonZeroBuffMods(wengineMods) && !effects.length) continue
            sources.push({
              key: `wengine-${index}-${item.key}-${entry.blockId}`,
              label: `${roleLabel} · ${agent.name} · 音擎 · ${wengine.name}（精${slot.wengineRefine}）`,
              mods: wengineMods,
              effects,
              blockName: entry.blockName,
            })
          }
        }
      }
    }

    // 驱动盘：与 collectAllBuffEffects 相同拆分，避免与影画/其他来源串 id
    {
      const selection = {
        twoPieceId: slot.twoPieceDriveDiscId,
        fourPieceId: slot.fourPieceDriveDiscId,
      }
      const fourDisc =
        selection.fourPieceId !== 'none'
          ? ctx.driveDiscs.find((item) => item.id === selection.fourPieceId)
          : undefined
      const twoDisc =
        selection.twoPieceId !== 'none'
          ? ctx.driveDiscs.find((item) => item.id === selection.twoPieceId)
          : undefined
      const baseKey = `drive-disc-${index}`

      const pushDiscSource = (
        key: string,
        label: string,
        blockId: string,
        blockName: string,
        rawEffects: BuffEffect[],
      ) => {
        const effects = rawEffects
          .filter(matchesTarget)
          .map((effect) => cloneEffectInstance(effect, key, blockId))
        const mods = resolvePackMods(effects, isMain, {
          ...ctx,
          skillContext: skillCtx,
        })
        if (!hasNonZeroBuffMods(mods) && !effects.length) return
        sources.push({
          key: `${key}-${blockId}`,
          label,
          mods,
          effects,
          blockName,
        })
      }

      if (isMain && fourDisc) {
        const twoEffects = fourDisc.twoPieceEffects?.length
          ? fourDisc.twoPieceEffects
          : flatModsToEffects(fourDisc.twoPieceMods, 'self', 'general', `${fourDisc.id}-2pc`)
        pushDiscSource(
          `${baseKey}-4set-2pc`,
          `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（2件）`,
          `${fourDisc.id}-2pc`,
          `${fourDisc.name} · 2件套`,
          twoEffects,
        )
        for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
          pushDiscSource(
            `${baseKey}-4set`,
            `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            entry.blockId,
            entry.blockName,
            entry.effects,
          )
        }
      }
      if (isMain && twoDisc && twoDisc.id !== fourDisc?.id) {
        const twoEffects = twoDisc.twoPieceEffects?.length
          ? twoDisc.twoPieceEffects
          : flatModsToEffects(twoDisc.twoPieceMods, 'self', 'general', `${twoDisc.id}-2pc`)
        pushDiscSource(
          `${baseKey}-2set`,
          `${roleLabel} · ${agent.name} · 驱动盘 · ${twoDisc.name}（2件）`,
          `${twoDisc.id}-2pc`,
          `${twoDisc.name} · 2件套`,
          twoEffects,
        )
      }
      if (!isMain && fourDisc) {
        for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
          pushDiscSource(
            `${baseKey}-4set`,
            `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            entry.blockId,
            entry.blockName,
            entry.effects,
          )
        }
      }
    }
  })

  if (ctx.bangboo?.id && ctx.bangboo.id !== 'none') {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    const effects = [
      ...(ctx.bangboo.effects ?? []),
      ...(ctx.bangboo.refinementEffects?.[refineIndex] ?? []),
    ].map((effect) => cloneEffectInstance(effect, 'bangboo', 'bangboo'))
    const bangbooMods = resolveEffectsToMods(effects, {
      ctx: skillCtx,
      stacksByEffectId: ctx.buffSelection?.stacksByEffectId,
      convertInputs: ctx.buffSelection?.convertInputs,
      attrValues: ctx.attrValues,
      selection: ctx.buffSelection,
    })
    sources.push({
      key: 'bangboo',
      label: `邦布 · ${ctx.bangboo.name}（精${ctx.bangbooRefine}）`,
      mods: bangbooMods,
      effects,
      blockName: ctx.bangboo.name,
    })
  }

  if (ctx.extraMods) {
    sources.push({
      key: 'extra',
      label: '额外 Buff',
      mods: ctx.extraMods,
    })
  }

  return sources
}

export function collectPanelBuffMods(ctx: PanelCalcContext): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()
  const sources = collectPanelBuffModSources(ctx)
  for (const source of sources) {
    total = mergeBuffStatModifiers(total, source.mods)
  }
  return total
}

export function applyBuffModsToPanel(
  externalPanel: PanelStats,
  mods: BuffStatModifiers,
): PanelStats {
  return {
    hp: externalPanel.hp * (1 + mods.inCombatHpPercent / 100) + mods.hp,
    atk: externalPanel.atk * (1 + mods.inCombatAtkPercent / 100) + mods.atk,
    def: externalPanel.def,
    critRate: externalPanel.critRate + mods.critRate,
    critDmg: externalPanel.critDmg + mods.critDmg,
    dmgBonus: externalPanel.dmgBonus + mods.dmgBonus + mods.skillDmgBonus,
    ignoreDefense: externalPanel.ignoreDefense,
    reduceDefense: externalPanel.reduceDefense + mods.reduceDefense,
    penRate: externalPanel.penRate + mods.penRate,
    pen: externalPanel.pen,
    resPen: externalPanel.resPen + mods.resPen,
    mastery: externalPanel.mastery + mods.mastery,
    anomalyCritRate: externalPanel.anomalyCritRate + mods.anomalyCritRate,
    anomalyCritDmg: externalPanel.anomalyCritDmg + mods.anomalyCritDmg,
    anomalyDmgBonus: externalPanel.anomalyDmgBonus + mods.anomalyDmgBonus,
    anomalyReleaseCritRate:
      externalPanel.anomalyReleaseCritRate + mods.anomalyReleaseCritRate,
    anomalyReleaseCritDmg:
      externalPanel.anomalyReleaseCritDmg + mods.anomalyReleaseCritDmg,
    anomalyReleaseMult: externalPanel.anomalyReleaseMult + mods.anomalyReleaseMult,
    anomalyReleaseDmgBonus:
      externalPanel.anomalyReleaseDmgBonus + mods.anomalyReleaseDmgBonus,
    directDmgMult:
      externalPanel.directDmgMult + mods.directDmgMult + mods.skillMultiplierBonus,
    anomalyMult: externalPanel.anomalyMult + mods.anomalyMult,
    disorderBaseMult: externalPanel.disorderBaseMult + mods.disorderBaseMult,
    anomalyDuration: externalPanel.anomalyDuration + mods.anomalyDuration,
    disorderCompMult: externalPanel.disorderCompMult + mods.disorderCompMult,
    turbulenceBaseMult: externalPanel.turbulenceBaseMult + mods.turbulenceBaseMult,
    turbulenceCompMult: externalPanel.turbulenceCompMult + mods.turbulenceCompMult,
    disorderDmgBonus: externalPanel.disorderDmgBonus + mods.disorderDmgBonus,
    turbulenceDmgBonus: externalPanel.turbulenceDmgBonus + mods.turbulenceDmgBonus,
  }
}

export function extractCombatMods(mods: BuffStatModifiers): CombatBuffMods {
  return {
    vulnerable: mods.vulnerable,
    globalStaggerVulnerable: mods.globalStaggerVulnerable,
    staggerVulnerable: mods.staggerVulnerable,
    staggerVulnerableOnly: mods.staggerVulnerableOnly,
    special: mods.special,
    pierceDmgBonus: mods.pierceDmgBonus,
  }
}

export function computeFinalPanel(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
): PanelBuffBreakdown {
  const totalMods = collectPanelBuffMods(ctx)
  return {
    totalMods,
    combatMods: extractCombatMods(totalMods),
    finalPanel: applyBuffModsToPanel(externalPanel, totalMods),
    sources: collectPanelBuffModSources(ctx),
    collectedEffects: collectAllBuffEffects(ctx),
  }
}

export function buildDefaultBuffSelection(
  collected: CollectedEffect[],
  attrValues?: Partial<Record<CharacterAttrKey, number>>,
): BuffSelectionState {
  const enabledIds: Record<string, boolean> = {}
  const stacksByEffectId: Record<string, number> = {}
  const convertInputs: Record<string, number> = {}
  for (const item of collected) {
    enabledIds[item.effect.id] = isEffectEnabled(item.effect, { enabledIds: {} })
    if (item.effect.kind === 'stacked' || item.effect.stackable) {
      stacksByEffectId[item.effect.id] = item.effect.defaultStacks ?? 1
    }
    if (item.effect.kind === 'convert' && item.effect.convert) {
      const configured = item.effect.convert.defaultBase
      convertInputs[item.effect.id] =
        configured != null && Number.isFinite(configured)
          ? configured
          : (attrValues?.[item.effect.convert.from] ?? 0)
    }
  }
  return { enabledIds, stacksByEffectId, convertInputs }
}

export type { SkillCategoryId }
