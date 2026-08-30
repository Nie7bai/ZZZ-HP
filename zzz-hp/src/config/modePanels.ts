import type { ModeKey } from '@/types/history'
import type { RouteLocationGeneric, RouteLocationRaw } from 'vue-router'

const allModes: readonly ModeKey[] = ['crisis-assault', 'defense', 'deduction']

const modePanelDefinitions = [
  { id: 'history', label: '往期详细', modes: allModes },
  { id: 'hp-chart', label: '血量折线图', modes: allModes },
  {
    id: 'phase-compare',
    label: '期数对比折线图',
    labelOverrides: { deduction: '节点对比折线图' },
    modes: allModes,
  },
  { id: 'monster-compare', label: '单独怪物对比', modes: allModes },
  { id: 'buff-overview', label: 'Buff 总览', modes: allModes },
  { id: 'buff-compare', label: 'Buff 对比', modes: allModes },
  {
    id: 'score-hp-table',
    label: '分数与血量对应表',
    modes: ['crisis-assault'],
  },
  {
    id: 'hp-score-converter',
    label: '血量分数转换器',
    modes: ['crisis-assault', 'deduction'],
  },
] as const satisfies readonly {
  id: string
  label: string
  labelOverrides?: Partial<Record<ModeKey, string>>
  modes: readonly ModeKey[]
}[]

export type ModePanelId = (typeof modePanelDefinitions)[number]['id']

export interface ModePanelDefinition {
  id: ModePanelId
  label: string
  labelOverrides?: Partial<Record<ModeKey, string>>
  modes: readonly ModeKey[]
}

export const MODE_PANEL_DEFINITIONS: readonly ModePanelDefinition[] = modePanelDefinitions

export const MODE_PANEL_IDS: readonly ModePanelId[] = MODE_PANEL_DEFINITIONS.map(
  (panel) => panel.id,
)

export function getModePanelDefinitions(mode: ModeKey): readonly ModePanelDefinition[] {
  return MODE_PANEL_DEFINITIONS.filter((panel) => panel.modes.includes(mode))
}

export function getFirstModePanelId(mode: ModeKey): ModePanelId {
  const firstPanel = getModePanelDefinitions(mode)[0]
  if (!firstPanel) {
    throw new Error(`Mode "${mode}" must expose at least one panel`)
  }
  return firstPanel.id
}

export function isModePanelAvailable(mode: ModeKey, value: unknown): value is ModePanelId {
  return (
    typeof value === 'string' && getModePanelDefinitions(mode).some((panel) => panel.id === value)
  )
}

export function getModePanelLabel(mode: ModeKey, panelId: ModePanelId): string {
  const panel = MODE_PANEL_DEFINITIONS.find((definition) => definition.id === panelId)
  if (!panel) {
    throw new Error(`Unknown mode panel "${panelId}"`)
  }
  return panel.labelOverrides?.[mode] ?? panel.label
}

export function getModePanelPath(basePath: string, panelId: ModePanelId): string {
  return `${basePath.replace(/\/+$/, '')}/${panelId}`
}

export function getModePanelLocation(
  basePath: string,
  panelId: ModePanelId,
  routeState: Pick<RouteLocationGeneric, 'query' | 'hash'>,
): RouteLocationRaw {
  return {
    path: getModePanelPath(basePath, panelId),
    query: { ...routeState.query },
    hash: routeState.hash,
  }
}
