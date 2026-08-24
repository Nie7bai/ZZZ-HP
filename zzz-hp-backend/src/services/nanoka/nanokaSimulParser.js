/**
 * nanoka 临界推演（simul）数据解析器
 *
 * simul/<id>.json 结构（节点图）：
 *   node[].battle[]       每个 BATTLE 节点下的层（"1-1"、"1-2"…）
 *     .layer.monster_level 层怪物等级
 *     .layer.layer_room / .layer_room  房间：monster_list[]（怪物）+ monster_weakness + waves_num
 *     .selectable_buff     可选 Buff（title + desc，同一期内多个层共享同一批 id）
 *
 * 输出：拍平成 boss / buff 两套行，版块 mode 由调用方指定（默认 deduction），
 * 期数 key 使用 simul 自己的 id（version = 期数 id，phase = '1'）。
 */
const ELEMENT_ZH = {
  ice: '冰',
  fire: '火',
  electric: '电',
  ether: '以太',
  physical: '物理',
  wind: '风',
}

function stripColorTags(text) {
  return String(text ?? '')
    .replace(/<color=#[0-9a-fA-F]+>/gi, '')
    .replace(/<color=([^>]+)>/gi, '')
    .replace(/<\/color>/gi, '')
    .replace(/\u00c2/g, '')
    .trim()
}

function roundNum(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function uniqueJoin(values) {
  return [...new Set(values.filter(Boolean))].join('、') || null
}

/** 拍平 story_event 多级嵌套 → 可读剧情文本 */
function flattenStoryEvents(storyEvent) {
  const parts = []
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (typeof obj.name === 'string' || typeof obj.desc === 'string') {
      const name = stripColorTags(obj.name)
      const desc = stripColorTags(obj.desc)
      const text = [name, desc].filter(Boolean).join('\n')
      if (text) parts.push(text)
      return
    }
    for (const value of Object.values(obj)) walk(value)
  }
  walk(storyEvent)
  return parts.join('\n\n') || null
}

/**
 * 收集 story_event 中的「选项」（choice 数组，元素形如 { id, name, desc }）。
 * 同一节点多个剧情页共享选项，按 name 去重；desc 通常为解锁条件（如得分要求）。
 */
function collectStoryOptions(storyEvent) {
  const options = []
  const seen = new Set()
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === 'object' && typeof item.name === 'string') {
          const name = stripColorTags(item.name)
          if (name && !seen.has(name)) {
            seen.add(name)
            options.push({
              name,
              desc: stripColorTags(item.desc) || null,
            })
          }
        }
      }
      return
    }
    for (const value of Object.values(obj)) walk(value)
  }
  walk(storyEvent)
  return options
}

function collectMonsters(layerRoom, layerMonsterLevel) {
  const monsters = []
  for (const room of Object.values(layerRoom)) {
    const monsterList = room?.monster_list ?? {}
    for (const monster of Object.values(monsterList)) {
      if (!monster || !monster.name) continue
      const stats = monster.stats ?? {}
      const element = monster.element ?? {}
      const resistanceNames = Object.entries(element)
        .filter(([, value]) => Number(value) === -1)
        .map(([k]) => ELEMENT_ZH[k] ?? k)
      const weaknessNames = Object.values(room.monster_weakness ?? {}).map((value) =>
        String(value),
      )
      monsters.push({
        name: String(monster.name).trim(),
        hp: roundNum(stats.hp),
        defense: roundNum(stats.defence),
        // 房间级 monster_level 优先；源数据层级等级挂在 layer.monster_level
        level: Number(room.monster_level) || Number(layerMonsterLevel) || 0,
        weakness: uniqueJoin(weaknessNames),
        resistance: uniqueJoin(resistanceNames),
      })
    }
  }
  return monsters
}

function collectBuffs(selectable) {
  const buffs = []
  for (const buffDoc of Object.values(selectable ?? {})) {
    if (!buffDoc || !buffDoc.title) continue
    buffs.push({
      title: String(buffDoc.title).trim(),
      desc: stripColorTags(buffDoc.desc) || null,
    })
  }
  return buffs
}

export function parseSimulPeriod(simulJson, { mode = 'deduction', phase = '1' } = {}) {
  const periodId = String(simulJson?.id ?? '')
  if (!periodId) throw new Error('simul 数据缺少 id')
  const version = periodId

  const bosses = []
  const buffs = []
  const seenBuffIds = new Set()
  const nodes = []

  const nodeEntries = Object.entries(simulJson.node ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))

  for (const [nodeId, node] of nodeEntries) {
    if (!node || typeof node !== 'object') continue

    const nodeType = Number(node.type) || 0
    const nodeRecord = {
      nodeId: String(nodeId),
      name: String(node.name ?? '').trim(),
      type: nodeType,
      prevNode: node.prev_node != null ? String(node.prev_node) : '',
      storyText: flattenStoryEvents(node.story_event),
      storyOptions: collectStoryOptions(node.story_event),
      layers: [],
      buffs: [],
    }

    if (node.battle && typeof node.battle === 'object') {
      for (const entry of Object.values(node.battle)) {
        if (!entry || typeof entry !== 'object') continue
        const roomName = String(entry.name ?? entry.id ?? '').trim()
        const layer = entry.layer && typeof entry.layer === 'object' ? entry.layer : {}

        // layer_room 可能挂在 layer 下或 entry 顶层（合并取并集）
        const layerRoom = {
          ...(layer.layer_room && typeof layer.layer_room === 'object' ? layer.layer_room : {}),
          ...(entry.layer_room && typeof entry.layer_room === 'object' ? entry.layer_room : {}),
        }

        const monsters = collectMonsters(layerRoom, layer.monster_level)

        // 怪物同时落入平铺 boss 行（每层一条，room=层名）
        for (const [key, monster] of Object.entries(monsterListOf(layerRoom))) {
          if (!monster || !monster.name) continue
          const stats = monster.stats ?? {}
          const element = monster.element ?? {}
          const resistanceNames = Object.entries(element)
            .filter(([, value]) => Number(value) === -1)
            .map(([k]) => ELEMENT_ZH[k] ?? k)
          const weaknessNames = Object.values(roomWeaknessOf(layerRoom, key) ?? {}).map((v) =>
            String(v),
          )
          bosses.push({
            version,
            phase,
            boss_name: String(monster.name).trim(),
            hp: roundNum(stats.hp),
            defense: roundNum(stats.defence),
            level: Number(layer.monster_level) || Number(monsterLevelOf(layerRoom)) || 1,
            room: roomName || String(key),
            weakness: uniqueJoin(weaknessNames),
            resistance: uniqueJoin(resistanceNames),
            boss_image: null,
          })
        }

        nodeRecord.layers.push({
          name: roomName,
          monsters,
        })

        // 可选 Buff：同节点各层共享同一批，节点级去重；同时去重进平铺 buff 行
        const selectable = entry.selectable_buff ?? layer.selectable_buff ?? {}
        for (const [buffId, buffDoc] of Object.entries(selectable)) {
          if (!buffDoc || !buffDoc.title) continue
          if (!nodeRecord.buffs.some((b) => b.title === buffDoc.title)) {
            nodeRecord.buffs.push({
              title: String(buffDoc.title).trim(),
              desc: stripColorTags(buffDoc.desc) || null,
            })
          }
          if (seenBuffIds.has(buffId)) continue
          seenBuffIds.add(buffId)
          buffs.push({
            version,
            phase,
            buff_name: String(buffDoc.title).trim(),
            buff: stripColorTags(buffDoc.desc) || null,
            buff_image: null,
          })
        }
      }
    }

    nodes.push(nodeRecord)
  }

  return { periodId, version, phase, mode, bosses, buffs, nodes }
}

function monsterListOf(layerRoom) {
  const out = {}
  for (const room of Object.values(layerRoom)) {
    Object.assign(out, room?.monster_list ?? {})
  }
  return out
}

function roomWeaknessOf(layerRoom, monsterKey) {
  for (const room of Object.values(layerRoom)) {
    if (room?.monster_list?.[monsterKey] !== undefined) return room.monster_weakness
  }
  return null
}

function monsterLevelOf(layerRoom) {
  for (const room of Object.values(layerRoom)) {
    if (room?.monster_level != null) return room.monster_level
  }
  return null
}
