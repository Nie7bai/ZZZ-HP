import type { PanelStats } from '@/types/calculatorPanel'

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
  warnings: string[]
}
