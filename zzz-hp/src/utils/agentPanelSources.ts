import type {
  AgentPanelProvenance,
  AgentPanelSources,
  AgentPanelSourceKind,
} from '@/types/damageCalcHistory'
import type { PanelStats } from '@/types/calculatorPanel'
import { fillPanelStatsDefaults, isPlaceholderExternalPanel } from '@/types/calculatorPanel'

/**
 * 局外面板的**来源**：同一份面板有两个录入入口，各自存一份、互不覆盖。
 *
 * - `imported`：「面板导入」那一路 —— 游戏里看到 / 手填的数字（截图识别或手打）
 * - `affixDerived`：「词条导入」那一路 —— 工具按条数算出来的数字
 *
 * 两份**平级**（刻意不叫主 / 备），同一时间只有一份 `active`；下游只拿激活那份，
 * **不接收也不查询来源**（见 `dev-docs/panel-dual-source.md` §5）。
 */
export const AGENT_PANEL_SOURCE_LABELS: Record<AgentPanelSourceKind, string> = {
  imported: '面板导入',
  affixDerived: '词条导入',
}

/** 来源顺序：界面里固定按这个顺序列，避免顺序随操作跳动 */
export const AGENT_PANEL_SOURCE_ORDER: AgentPanelSourceKind[] = ['imported', 'affixDerived']

/** 记录里那一份面板（没有则 undefined） */
export function panelOfSource(
  sources: AgentPanelSources | undefined,
  kind: AgentPanelSourceKind,
): PanelStats | undefined {
  if (!sources) return undefined
  const panel = kind === 'imported' ? sources.importedPanel : sources.affixDerivedPanel
  return panel && !isPlaceholderExternalPanel(panel) ? fillPanelStatsDefaults(panel) : undefined
}

/** 该来源是否已有可用数据（占位面板不算） */
export function hasPanelSource(
  sources: AgentPanelSources | undefined,
  kind: AgentPanelSourceKind,
): boolean {
  return panelOfSource(sources, kind) !== undefined
}

/** 有数据的那几份，按固定顺序列出 */
export function panelSourceKindsWithData(
  sources: AgentPanelSources | undefined,
): AgentPanelSourceKind[] {
  return AGENT_PANEL_SOURCE_ORDER.filter((kind) => hasPanelSource(sources, kind))
}

/**
 * 当前生效的那份面板。
 *
 * 下游（伤害计算、扫掠柱图、最优分配、增益计算）全部走这里，**只关心拿到一份面板**。
 * `active` 指向的那份若还没数据（例如手动切过去又删了），回落到另一份有数据的；
 * 两份都没有则给 `undefined`，由调用方决定兜底。
 */
export function resolveActivePanel(sources: AgentPanelSources | undefined): PanelStats | undefined {
  if (!sources) return undefined
  const preferred = panelOfSource(sources, sources.active)
  if (preferred) return preferred
  for (const kind of panelSourceKindsWithData(sources)) return panelOfSource(sources, kind)
  return undefined
}

/** 激活那份（不带回落）：界面显示「当前使用哪一份」用这个，避免把回落说成用户选的 */
export function activePanelSourceKind(
  sources: AgentPanelSources | undefined,
): AgentPanelSourceKind | undefined {
  if (!sources) return undefined
  if (hasPanelSource(sources, sources.active)) return sources.active
  return undefined
}

/**
 * **实际在用**的那份来源 —— `resolveActivePanel` 的「来源」版本。
 *
 * 与 `activePanelSourceKind` 的分工：
 * - 那个答「用户选的是哪份」（选的那份没数据就说没有，用于回显用户的选择）；
 * - 这个答「最终喂进计算的是哪份」（选中那份没数据时**回落**到另一份，规则与 `resolveActivePanel` 一致）。
 *
 * 界面要标「这份数字来自哪里」必须用这个：否则回落时会把另一份的面板标成用户选的那份
 * （见 `dev-docs/panel-dual-source.md` §4.2）。
 */
export function resolveActivePanelSourceKind(
  sources: AgentPanelSources | undefined,
): AgentPanelSourceKind | undefined {
  if (!sources) return undefined
  if (hasPanelSource(sources, sources.active)) return sources.active
  for (const kind of panelSourceKindsWithData(sources)) return kind
  return undefined
}

/** 某一来源的导入时间（仅展示与排查用；计算链路不读） */
export function sourceImportedAt(
  sources: AgentPanelSources | undefined,
  kind: AgentPanelSourceKind,
): number | undefined {
  if (!sources?.provenance) return undefined
  return kind === 'imported' ? sources.provenance.importedAt : sources.provenance.affixDerivedAt
}

export interface PanelSourceSummary {
  kind: AgentPanelSourceKind
  label: string
  hasData: boolean
  active: boolean
  importedAt?: number
}

/** 界面用：两份各自的名字、有没有数据、是不是当前激活、导入时间 */
export function describePanelSources(
  sources: AgentPanelSources | undefined,
): PanelSourceSummary[] {
  const activeKind = activePanelSourceKind(sources)
  return AGENT_PANEL_SOURCE_ORDER.map((kind) => ({
    kind,
    label: AGENT_PANEL_SOURCE_LABELS[kind],
    hasData: hasPanelSource(sources, kind),
    active: activeKind === kind,
    importedAt: sourceImportedAt(sources, kind),
  }))
}

/** 「09-11 14:20」这类短时间；没有时间返回空串 */
export function formatPanelImportedAt(at: number | undefined): string {
  if (!at || !Number.isFinite(at)) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function createAgentPanelSources(): AgentPanelSources {
  return { active: 'imported' }
}

/**
 * 写入某一来源并激活它 —— 「确定导入」用的入口（`dev-docs/panel-dual-source.md` §4.1）。
 *
 * 另一份原样保留：不重算、不反推、不清理。
 */
export function writePanelSource(
  sources: AgentPanelSources | undefined,
  kind: AgentPanelSourceKind,
  panel: PanelStats,
  meta?: { importedAt?: number; source?: AgentPanelProvenance['source'] },
): AgentPanelSources {
  const base = sources ?? createAgentPanelSources()
  const provenance = { ...(base.provenance ?? {}) }
  // 只有真的发生「导入」才记时间：按角色基础面板兜底生成的那份不盖时间戳
  if (meta?.importedAt) {
    if (kind === 'imported') provenance.importedAt = meta.importedAt
    else provenance.affixDerivedAt = meta.importedAt
  }
  if (meta?.source) provenance.source = meta.source
  return {
    ...base,
    [kind === 'imported' ? 'importedPanel' : 'affixDerivedPanel']: fillPanelStatsDefaults(panel),
    active: kind,
    provenance,
  }
}

/** 只切激活，不动两份面板本身（§4.3 手动切换） */
export function setActivePanelSource(
  sources: AgentPanelSources | undefined,
  kind: AgentPanelSourceKind,
): AgentPanelSources {
  const base = sources ?? createAgentPanelSources()
  if (base.active === kind) return base
  return { ...base, active: kind }
}

/** 词条数 / 4-5-6 主属性：只服务「词条导入」这一路，跟着那份来源存 */
export function writeAffixInputsIntoSource(
  sources: AgentPanelSources | undefined,
  inputs: { affixCounts?: AgentPanelSources['affixCounts']; affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats'] },
): AgentPanelSources {
  const base = sources ?? createAgentPanelSources()
  const next: AgentPanelSources = { ...base }
  if (inputs.affixCounts) next.affixCounts = inputs.affixCounts
  if (inputs.affixDriveDiscMainStats) next.affixDriveDiscMainStats = inputs.affixDriveDiscMainStats
  return next
}

/**
 * 老数据归位（`dev-docs/panel-dual-source.md` §6）：老方案只有一份面板、没有来源信息。
 * 只读方案记录的 `panelCalcMode`，不做扫描校验、不标注「旧数据」。
 */
export function migrateLegacyPanelIntoSource(
  sources: AgentPanelSources | undefined,
  panel: PanelStats,
  legacyMode: string | null | undefined,
  inputs?: { affixCounts?: AgentPanelSources['affixCounts']; affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats'] },
  meta?: { importedAt?: number },
): AgentPanelSources {
  const kind: AgentPanelSourceKind = legacyMode === 'affix' ? 'affixDerived' : 'imported'
  const written = writePanelSource(sources, kind, panel, {
    importedAt: meta?.importedAt,
    source: kind === 'imported' ? 'manual' : 'affix',
  })
  return inputs ? writeAffixInputsIntoSource(written, inputs) : written
}

/** 老结构整表归位：一份面板 + 槽位级词条数/主属性 → 双来源 */
export function migrateLegacyPanelsToSources(input: {
  legacyPanels?: Record<string, PanelStats> | null
  panelCalcMode?: string | null
  teamSlots?: Array<{
    agentId?: string
    affixCounts?: AgentPanelSources['affixCounts']
    affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats']
  }> | null
}): Record<string, AgentPanelSources> {
  const next: Record<string, AgentPanelSources> = {}
  for (const [agentId, panel] of Object.entries(input.legacyPanels ?? {})) {
    if (!panel) continue
    next[agentId] = migrateLegacyPanelIntoSource(undefined, panel, input.panelCalcMode)
  }
  for (const slot of input.teamSlots ?? []) {
    const agentId = slot?.agentId
    if (!agentId) continue
    if (!slot.affixCounts && !slot.affixDriveDiscMainStats) continue
    next[agentId] = writeAffixInputsIntoSource(next[agentId], {
      affixCounts: slot.affixCounts,
      affixDriveDiscMainStats: slot.affixDriveDiscMainStats,
    })
  }
  return next
}

/**
 * 脚本 / 兼容路径用：取某角色「词条导入」那一路的输入。
 * 新结构优先，老方案（槽位级字段）兜底 —— 老方案字段在 v4 迁移后会被清除。
 */
export function affixInputsForAgent(
  slotPanels: Record<string, AgentPanelSources> | undefined,
  agentId: string | undefined,
  legacySlot?: {
    affixCounts?: AgentPanelSources['affixCounts']
    affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats']
  } | null,
): {
  affixCounts?: AgentPanelSources['affixCounts']
  affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats']
} {
  const sources = agentId ? slotPanels?.[agentId] : undefined
  return {
    affixCounts: sources?.affixCounts ?? legacySlot?.affixCounts,
    affixDriveDiscMainStats: sources?.affixDriveDiscMainStats ?? legacySlot?.affixDriveDiscMainStats,
  }
}

/** 方案文件（新结构或老结构）能提供的最少字段 */
export interface SchemePanelShape {
  slotPanels?: Record<string, AgentPanelSources>
  anomalySlotPanels?: Record<string, PanelStats>
  panelCalcMode?: string | null
  teamSlots?: Array<{
    agentId?: string
    affixCounts?: AgentPanelSources['affixCounts']
    affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats']
  }> | null
}

/** 方案（新结构或老结构）→ 双来源记录。老结构按 `panelCalcMode` 归位。 */
export function schemeSlotPanels(scheme: SchemePanelShape | null | undefined): Record<string, AgentPanelSources> {
  if (!scheme) return {}
  if (scheme.slotPanels) return scheme.slotPanels
  return migrateLegacyPanelsToSources({
    legacyPanels: scheme.anomalySlotPanels,
    panelCalcMode: scheme.panelCalcMode,
    teamSlots: scheme.teamSlots,
  })
}

/** 方案 → 已解析的激活面板（每人一份），可直接喂给 `buildOptimalEvalContext` */
export function schemeActivePanels(
  scheme: SchemePanelShape | null | undefined,
): Record<string, PanelStats> {
  const map: Record<string, PanelStats> = {}
  for (const [agentId, sources] of Object.entries(schemeSlotPanels(scheme))) {
    const panel = resolveActivePanel(sources)
    if (panel) map[agentId] = panel
  }
  return map
}

/** 方案 + 角色 → 「词条导入」那一路的输入（词条数 / 4-5-6 主属性） */
export function schemeAffixInputs(
  scheme: SchemePanelShape | null | undefined,
  agentId: string | undefined,
): {
  affixCounts?: AgentPanelSources['affixCounts']
  affixDriveDiscMainStats?: AgentPanelSources['affixDriveDiscMainStats']
} {
  const legacySlot = scheme?.teamSlots?.find((slot) => slot?.agentId === agentId) ?? null
  return affixInputsForAgent(schemeSlotPanels(scheme), agentId, legacySlot)
}
