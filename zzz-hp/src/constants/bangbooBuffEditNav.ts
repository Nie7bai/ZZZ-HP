export const BANGBOO_BUFF_EDIT_SECTIONS = [
  { id: 'admin-bangboo-picker', label: '邦布选择' },
  { id: 'admin-bangboo-basic', label: '基础信息' },
  { id: 'admin-bangboo-avatar', label: '头像' },
  { id: 'admin-bangboo-fixed', label: '固定增益' },
  { id: 'admin-bangboo-refinement', label: '精炼增益' },
] as const

export type BangbooBuffEditSectionId = (typeof BANGBOO_BUFF_EDIT_SECTIONS)[number]['id']

export const BANGBOO_BUFF_EDIT_ACTIONS = [
  { id: 'save', label: '保存' },
  { id: 'delete', label: '删除' },
] as const

export type BangbooBuffEditActionId = (typeof BANGBOO_BUFF_EDIT_ACTIONS)[number]['id']
