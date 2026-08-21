/** 槽位展示名：有角色名用名字，否则「角色1 / 角色2 / 角色3」 */
export function teamSlotDisplayLabel(
  slot: { agentId?: string | null },
  index: number,
  agents: Array<{ id: string; name: string }>,
): string {
  const id = String(slot.agentId ?? '').trim()
  if (id) {
    const name = agents.find((agent) => agent.id === id)?.name?.trim()
    if (name) return name
  }
  return `角色${index + 1}`
}
