/**
 * 导入弹窗（UnifiedPresetPicker）的草稿重置判定。
 *
 * 弹窗里有两处会改「选中角色」，但语义不同：
 *
 * - **打开弹窗时按槽位回填**：`selected` 被整体改写，`agentId` 从空变成槽位角色。
 *   此时 `resetDraftPanelFromSlot()` 已经把该槽位存的草稿（词条数、4/5/6 主属性、面板）
 *   填了进来，**必须保留**。
 * - **用户点选角色 / 截图识别出角色**：这是真的换人，草稿回落新角色的基础状态，
 *   不沿用上一个角色的数据。
 *
 * 两者都会让 `selected.agentId` 发生变化，只看「变了没有」会把回填也当成换人：
 * 表现为刷新后第一次打开弹窗时，刚回填的配置被随即清空，关掉再打开才正常。
 *
 * 判定单独抽出来是为了能脱离组件测（见 `scripts/test-preset-picker-draft-reset.mjs`）。
 */
export function shouldResetDraftsOnAgentChange(params: {
  /** 弹窗是否打开；关闭状态下的角色变化不重置（下次打开会按槽位整体回填） */
  isOpen: boolean
  oldAgentId: string
  newAgentId: string
  /** 打开弹窗时回填的角色 id；null 表示当前没有待跳过的回填 */
  agentIdRestoredOnOpen: string | null
}): boolean {
  if (!params.isOpen) return false
  if (!params.newAgentId) return false
  if (params.newAgentId === params.oldAgentId) return false
  // 这次变化正好落在打开时回填的角色上：是回填，不是换人
  if (params.newAgentId === params.agentIdRestoredOnOpen) return false
  return true
}
