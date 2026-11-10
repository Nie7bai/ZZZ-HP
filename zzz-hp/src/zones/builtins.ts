import type { PanelStats } from '@/types/calculatorPanel'
import {
  normalizeDamageEnemyInput,
  resolveEnemyResistanceForElement,
  type DamageEnemyInput,
} from '@/utils/enemyResistance'

/**
 * 核心乘区原语（Phase 1b）。
 *
 * 只负责「基础 → 增伤 → 防御 → 抗性 → 失衡/帷幕」这条主链的因子与连乘；
 * 防御区的明细（穿透、减防、有效防御）仍由 `damageCalc.computeDefenseZone` 计算后传入，
 * 保证与旧链路逐位一致。后续阶段再把防御原语整体迁入。
 */
export interface CoreZoneContext {
  /** 已解析的基础伤害（攻击/防御/贯穿 + 锐化规则） */
  baseDamage: number
  panel: PanelStats
  /** 已由 computeDefenseZone 算出的防御区因子 */
  defenseMultiplier: number
  enemyInput: DamageEnemyInput
  resistanceElement?: string | null
  /** 抗性穿透来源面板；缺省回落到 panel */
  resPenSource?: PanelStats
  extraResPen?: number
  staggerPhase: 'normal' | 'stagger'
  curtainVulnerabilityCap?: number | null
  combatGlobalStaggerVulnerable: number
  combatStaggerVulnerable: number
  combatStaggerVulnerableOnly: number
  /** 自定义乘区因子连乘（缺省 1；方案未启用自定义乘区时恒为 1） */
  extraZoneFactor?: number
}

export interface CoreZoneResult {
  dmgMultiplier: number
  resistanceMultiplier: number
  /** 抗性区所参照属性的敌方抗性（供结果展示） */
  enemyRes: number
  staggerMultiplier: number
  generalMultiplier: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function evaluateCoreZones(context: CoreZoneContext): CoreZoneResult {
  const panel = context.panel
  const dmgMultiplier = 1 + clamp(panel.dmgBonus / 100, -0.95, 20)

  const enemyRes = resolveEnemyResistanceForElement(
    normalizeDamageEnemyInput(context.enemyInput),
    context.resistanceElement,
  )
  const resPenPanel = context.resPenSource ?? panel
  const resistanceMultiplier =
    1 - enemyRes + clamp((resPenPanel.resPen + (context.extraResPen ?? 0)) / 100, -2, 2)

  const globalStagger = context.combatGlobalStaggerVulnerable / 100
  const phaseStagger =
    (context.combatStaggerVulnerable + context.combatStaggerVulnerableOnly) / 100
  const curtainCap = context.curtainVulnerabilityCap
  const staggerMultiplier =
    curtainCap != null
      ? Math.min(context.enemyInput.staggerMultiplier + globalStagger + phaseStagger, curtainCap)
      : context.staggerPhase === 'stagger'
        ? context.enemyInput.staggerMultiplier + globalStagger + phaseStagger
        : 1 + globalStagger

  const generalMultiplier =
    context.baseDamage *
    dmgMultiplier *
    context.defenseMultiplier *
    resistanceMultiplier *
    Math.max(0, staggerMultiplier) *
    (context.extraZoneFactor ?? 1)

  return { dmgMultiplier, resistanceMultiplier, enemyRes, staggerMultiplier, generalMultiplier }
}
