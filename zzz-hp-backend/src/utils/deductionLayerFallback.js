/**
 * 临界推演：当 deduction_node.layers_json 损坏或为空时，从 boss 表（mode=deduction）按 room 分组回退重建层。
 * boss.room 与 nanoka 导入一致：STAGE 01 / 1-1 / 结局N · Boss名 等。
 */

function parseStageNumberFromNodeName(nodeName) {
  const m = String(nodeName ?? '').trim().match(/STAGE\s*(\d+)/i)
  return m ? Number(m[1]) : null
}

function isLastStageNodeName(nodeName) {
  return /LAST\s*STAGE/i.test(String(nodeName ?? ''))
}

function isDeductionBattleNodeType(type) {
  const t = Number(type) || 0
  return t === 2 || t === 3
}

function layerNameIsBoss(layerName) {
  const s = String(layerName ?? '').trim()
  if (!s) return false
  // 结局N · 4-1 / 结局N · 3-2 → 前战；结局N · Boss名 → 终局
  const endingWave = s.match(/^结局\d+\s*·\s*(.+)$/)
  if (endingWave) {
    return !/^\d+-\d+$/.test(endingWave[1].trim())
  }
  return /STAGE|LAST/i.test(s)
}

/** 写入 layers_json 时统一 isBoss：优先解析结果，否则按层名推断 */
export function resolveLayerIsBoss(layer) {
  if (layer?.isBoss === true) return true
  if (layer?.isBoss === false) return false
  return layerNameIsBoss(layer?.name)
}

function sortRoomNames(rooms, primaryHint) {
  const primary = String(primaryHint ?? '').trim()
  return [...rooms].sort((a, b) => {
    if (a === primary) return -1
    if (b === primary) return 1
    if (a === 'LAST STAGE') return -1
    if (b === 'LAST STAGE') return 1
    const ma = a.match(/^(\d+)-(\d+)$/)
    const mb = b.match(/^(\d+)-(\d+)$/)
    if (ma && mb) {
      const diff = Number(ma[1]) - Number(mb[1])
      if (diff !== 0) return diff
      return Number(ma[2]) - Number(mb[2])
    }
    return a.localeCompare(b, 'zh')
  })
}

function bossRowToMonster(row) {
  return {
    name: String(row.boss_name ?? '').trim(),
    hp: Number(row.hp) || 0,
    defense: Number(row.defense) || 0,
    level: Number(row.level) || 0,
    weakness: row.weakness ?? null,
    resistance: row.resistance ?? null,
    boss_image: row.boss_image ?? null,
  }
}

function groupBossRowsByRoom(bossRows) {
  const byRoom = new Map()
  for (const row of bossRows) {
    const room = String(row.room ?? '').trim()
    const name = String(row.boss_name ?? '').trim()
    if (!room || !name) continue
    if (!byRoom.has(room)) byRoom.set(room, [])
    byRoom.get(room).push(bossRowToMonster(row))
  }
  return byRoom
}

function roomsForStageNode(nodeName, stageNum, roomSet, assigned) {
  const primary = String(nodeName).trim()
  const picked = new Set()
  if (roomSet.has(primary) && !assigned.has(primary)) picked.add(primary)
  for (const room of roomSet) {
    if (assigned.has(room)) continue
    const m = room.match(/^(\d+)-/)
    if (m && Number(m[1]) === stageNum) picked.add(room)
  }
  return sortRoomNames(picked, primary)
}

function roomsForLastStageNode(roomSet, assigned) {
  const picked = [...roomSet].filter((room) => !assigned.has(room))
  return sortRoomNames(picked, 'LAST STAGE')
}

function buildLayersFromRooms(roomNames, byRoom) {
  return roomNames
    .map((name) => ({
      name,
      isBoss: layerNameIsBoss(name),
      monsters: byRoom.get(name) ?? [],
    }))
    .filter((layer) => layer.monsters.length > 0 || layerNameIsBoss(layer.name))
}

/**
 * 按期数 battle 节点顺序，将 boss 行分配到各节点并生成 layers。
 */
export function rebuildVersionLayersFromBossRows(battleNodes, bossRows) {
  const byRoom = groupBossRowsByRoom(bossRows)
  const roomSet = new Set(byRoom.keys())
  const assigned = new Set()
  const layersByNodeId = new Map()

  for (const node of battleNodes) {
    const nodeId = String(node.nodeId ?? '')
    const nodeName = String(node.name ?? '').trim()
    if (!nodeId || !nodeName) continue

    let roomNames = []
    if (isLastStageNodeName(nodeName)) {
      roomNames = roomsForLastStageNode(roomSet, assigned)
    } else {
      const stageNum = parseStageNumberFromNodeName(nodeName)
      if (stageNum != null) {
        roomNames = roomsForStageNode(nodeName, stageNum, roomSet, assigned)
      } else {
        const primary = nodeName
        if (roomSet.has(primary) && !assigned.has(primary)) roomNames = [primary]
      }
    }

    for (const room of roomNames) assigned.add(room)
    const layers = buildLayersFromRooms(roomNames, byRoom)
    if (layers.length) layersByNodeId.set(nodeId, layers)
  }

  return layersByNodeId
}

/**
 * 单节点回退：layers_json 无效或为空时，从同期 boss 行重建。
 */
export function fallbackLayersForNode(node, bossRowsForVersion) {
  if (!isDeductionBattleNodeType(node.type)) return []
  const existing = node.layers
  if (Array.isArray(existing) && existing.length > 0) return existing

  const battleNodes = [{ nodeId: node.nodeId, name: node.name, type: node.type }]
  const map = rebuildVersionLayersFromBossRows(battleNodes, bossRowsForVersion)
  return map.get(String(node.nodeId)) ?? []
}

/**
 * 整期 battle 节点批量回退（getDeductionPhases 用）。
 */
export function applyBossFallbackToPeriodNodes(nodes, bossRowsForVersion) {
  const battleNodes = nodes.filter((n) => isDeductionBattleNodeType(n.type))
  const map = rebuildVersionLayersFromBossRows(battleNodes, bossRowsForVersion)
  for (const node of nodes) {
    if (!isDeductionBattleNodeType(node.type)) continue
    if (Array.isArray(node.layers) && node.layers.length > 0) continue
    const rebuilt = map.get(String(node.nodeId))
    if (rebuilt?.length) node.layers = rebuilt
  }
}
