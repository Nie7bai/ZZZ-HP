import type {
  ExternalPanelAuthority,
  LegacyPanelCalcMode,
  PanelCalcMode,
} from '@/types/calculatorPanel'

/** 将历史 panel/affix/damage/optimal 归一为现行页面 Tab */
export function normalizePanelCalcMode(raw: unknown): PanelCalcMode {
  if (raw === 'optimal') return 'optimal'
  return 'damage'
}

/** 从旧 panelCalcMode 推断局外权威；新草稿应单独存 authority */
export function legacyModeToExternalAuthority(raw: unknown): ExternalPanelAuthority {
  if (raw === 'affix') return 'affix'
  return 'panel'
}

export function isLegacyPanelCalcMode(raw: unknown): raw is LegacyPanelCalcMode {
  return raw === 'panel' || raw === 'affix' || raw === 'damage' || raw === 'optimal'
}

export function resolveExternalAuthority(
  byAgent: Record<string, ExternalPanelAuthority> | undefined,
  agentId: string | null | undefined,
  fallback: ExternalPanelAuthority = 'panel',
): ExternalPanelAuthority {
  if (!agentId) return fallback
  return byAgent?.[agentId] ?? fallback
}
