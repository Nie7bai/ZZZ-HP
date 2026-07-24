import type { AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'

export interface PanelScreenshotRecognition {
  agentId: string | null
  agentName: string | null
  rank: number
  wengineId: string | null
  wengineName: string | null
  wengineRefine: number
  twoPieceDriveDiscId: string | null
  twoPieceDriveDiscName: string | null
  fourPieceDriveDiscId: string | null
  fourPieceDriveDiscName: string | null
  externalPanel: Partial<PanelStats>
  /** 识别到的 4/5/6 号盘主属性（用于词条反推时扣除） */
  driveDiscMainStats?: Partial<AffixDriveDiscMainStats>
  warnings: string[]
}
