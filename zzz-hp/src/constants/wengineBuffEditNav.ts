export const WENGINE_BUFF_EDIT_SECTIONS = [
  { id: 'admin-wengine-picker', label: '音擎选择' },
  { id: 'admin-wengine-basic', label: '基础信息' },
  { id: 'admin-wengine-note', label: '注释' },
  { id: 'admin-wengine-avatar', label: '头像' },
  { id: 'admin-wengine-base-stats', label: '基础属性' },
  { id: 'admin-wengine-fixed', label: '固定增益' },
  { id: 'admin-wengine-refinement', label: '精炼增益' },
] as const

export type WengineBuffEditSectionId = (typeof WENGINE_BUFF_EDIT_SECTIONS)[number]['id']

export const WENGINE_BUFF_EDIT_ACTIONS = [
  { id: 'save', label: '保存' },
  { id: 'delete', label: '删除' },
] as const

export type WengineBuffEditActionId = (typeof WENGINE_BUFF_EDIT_ACTIONS)[number]['id']
