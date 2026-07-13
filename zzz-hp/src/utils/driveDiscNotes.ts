import type { DriveDiscBuffDoc } from '@/types/calculator'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'

export interface DriveDiscNoteLine {
  key: string
  roleLabel: string
  label: string
  note: string
}

export function collectSlotDriveDiscNoteLines(
  slot: TeamSlot,
  slotIndex: number,
  agentName: string,
  driveDiscs: DriveDiscBuffDoc[],
): DriveDiscNoteLine[] {
  const lines: DriveDiscNoteLine[] = []
  const roleLabel = slot.isMainC ? `主C · ${agentName}` : `辅助 · ${agentName}`

  const fourDisc =
    slot.fourPieceDriveDiscId !== 'none'
      ? driveDiscs.find((item) => item.id === slot.fourPieceDriveDiscId)
      : undefined
  const twoDisc =
    slot.twoPieceDriveDiscId !== 'none'
      ? driveDiscs.find((item) => item.id === slot.twoPieceDriveDiscId)
      : undefined

  if (twoDisc && twoDisc.id !== fourDisc?.id && twoDisc.twoPieceNote.trim()) {
    lines.push({
      key: `${slotIndex}-extra-two-${twoDisc.id}`,
      roleLabel,
      label: `2件套 · ${twoDisc.name}`,
      note: twoDisc.twoPieceNote.trim(),
    })
  }

  if (fourDisc) {
    if (fourDisc.twoPieceNote.trim()) {
      lines.push({
        key: `${slotIndex}-four-two-${fourDisc.id}`,
        roleLabel,
        label: `4件套 · ${fourDisc.name} · 2件套`,
        note: fourDisc.twoPieceNote.trim(),
      })
    }
    if (fourDisc.fourPieceNote.trim()) {
      lines.push({
        key: `${slotIndex}-four-${fourDisc.id}`,
        roleLabel,
        label: `4件套 · ${fourDisc.name} · 4件套`,
        note: fourDisc.fourPieceNote.trim(),
      })
    }
  }

  return lines
}

export function collectTeamDriveDiscNoteLines(
  teamSlots: TeamSlot[],
  agents: { id: string; name: string }[],
  driveDiscs: DriveDiscBuffDoc[],
): DriveDiscNoteLine[] {
  const lines: DriveDiscNoteLine[] = []

  teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    const agent = agents.find((item) => item.id === slot.agentId)
    lines.push(
      ...collectSlotDriveDiscNoteLines(slot, index, agent?.name ?? `槽位${index + 1}`, driveDiscs),
    )
  })

  return lines
}
