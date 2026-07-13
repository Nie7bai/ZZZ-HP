export const DRIVE_DISC_BUFF_EDIT_SECTIONS = [
  { id: 'admin-drive-disc-picker', label: '驱动盘选择' },
  { id: 'admin-drive-disc-basic', label: '基础信息' },
  { id: 'admin-drive-disc-avatar', label: '头像' },
  { id: 'admin-drive-disc-two-piece', label: '2件套增益' },
  { id: 'admin-drive-disc-four-piece', label: '4件套增益' },
] as const

export type DriveDiscBuffEditSectionId = (typeof DRIVE_DISC_BUFF_EDIT_SECTIONS)[number]['id']

export const DRIVE_DISC_BUFF_EDIT_ACTIONS = [
  { id: 'save', label: '保存' },
  { id: 'delete', label: '删除' },
] as const

export type DriveDiscBuffEditActionId = (typeof DRIVE_DISC_BUFF_EDIT_ACTIONS)[number]['id']
