export const AGENT_BUFF_EDIT_SECTIONS = [
  { id: 'admin-agent-picker', label: '代理人选择' },
  { id: 'admin-agent-basic', label: '基础信息' },
  { id: 'admin-agent-support', label: '辅助需求' },
  { id: 'admin-agent-note', label: '角色注释' },
  { id: 'admin-agent-avatar', label: '头像' },
  { id: 'admin-agent-base-panel', label: '基础面板' },
  { id: 'admin-agent-mindscape', label: '影画增益' },
] as const

export type AgentBuffEditSectionId = (typeof AGENT_BUFF_EDIT_SECTIONS)[number]['id']

export const AGENT_BUFF_EDIT_ACTIONS = [
  { id: 'save', label: '保存' },
  { id: 'delete', label: '删除' },
] as const

export type AgentBuffEditActionId = (typeof AGENT_BUFF_EDIT_ACTIONS)[number]['id']
