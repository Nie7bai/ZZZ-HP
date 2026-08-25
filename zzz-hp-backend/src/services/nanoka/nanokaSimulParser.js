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

/** 可选 Buff 包指纹：同结局下终局/前战/选战共用同一套 title 集合 */
export function buffPackageKey(selectable) {
  return Object.values(selectable ?? {})
    .map((buff) => String(buff?.title ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .join('|')
}

function isLastStageNode(node) {
  const type = Number(node?.type) || 0
  if (type === 3) return true
  return /LAST\s*STAGE/i.test(String(node?.name ?? ''))
}

function isFinaleBattle(entry) {
  const tagType = Number(entry?.tag_type)
  if (tagType === 1) return true
  const tag = stripColorTags(entry?.tag)
  if (tag === '终局') return true
  return /LAST\s*STAGE/i.test(String(entry?.name ?? '').trim())
}

function primaryMonsterName(monsters) {
  const names = (monsters ?? []).map((m) => String(m?.name ?? '').trim()).filter(Boolean)
  return names[0] || ''
}

/**
 * 多结局：按 Buff 包把终局/前战/选战归到同一结局，并生成唯一层名。
 * - 终局层：结局N · Boss名
 * - 前战/选战：结局N · 原层名（如 4-1）
 */
function assignEndingLayerNames(battleDrafts) {
  const endingOrder = []
  const endingIndexByKey = new Map()

  for (const draft of battleDrafts) {
    if (!draft.isFinale || !draft.buffKey) continue
    if (endingIndexByKey.has(draft.buffKey)) continue
    endingIndexByKey.set(draft.buffKey, endingOrder.length + 1)
    endingOrder.push(draft.buffKey)
  }

  // 无「终局」标记时：每个 Buff 包仍算一条结局（兼容缺 tag 的数据）
  if (!endingOrder.length) {
    for (const draft of battleDrafts) {
      if (!draft.buffKey || endingIndexByKey.has(draft.buffKey)) continue
      endingIndexByKey.set(draft.buffKey, endingOrder.length + 1)
      endingOrder.push(draft.buffKey)
    }
  }

  const usedNames = new Set()
  for (const draft of battleDrafts) {
    const endingNo = draft.buffKey ? endingIndexByKey.get(draft.buffKey) : null
    const endingLabel = endingNo != null ? `结局${endingNo}` : null
    let baseName
    if (endingLabel && draft.isFinale) {
      const bossName = primaryMonsterName(draft.monsters) || draft.rawName || draft.battleId
      baseName = `${endingLabel} · ${bossName}`
    } else if (endingLabel) {
      baseName = `${endingLabel} · ${draft.rawName || draft.battleId}`
    } else {
      baseName = draft.rawName || draft.battleId
    }

    let unique = baseName
    let suffix = 2
    while (usedNames.has(unique)) {
      unique = `${baseName} (${suffix})`
      suffix += 1
    }
    usedNames.add(unique)
    draft.layerName = unique
    draft.endingLabel = endingLabel
    draft.isBoss = draft.isFinale
  }
}

function buildBattleDraft(entry) {
  const layer = entry.layer && typeof entry.layer === 'object' ? entry.layer : {}
  const layerRoom = {
    ...(layer.layer_room && typeof layer.layer_room === 'object' ? layer.layer_room : {}),
    ...(entry.layer_room && typeof entry.layer_room === 'object' ? entry.layer_room : {}),
  }
  const selectable = entry.selectable_buff ?? layer.selectable_buff ?? {}
  const monsters = collectMonsters(layerRoom, layer.monster_level)
  const rawName = String(entry.name ?? entry.id ?? '').trim()
  const battleId = String(entry.id ?? '').trim()
  return {
    entry,
    layer,
    layerRoom,
    selectable,
    monsters,
    rawName,
    battleId: battleId || rawName,
    buffKey: buffPackageKey(selectable),
    isFinale: isFinaleBattle(entry),
    layerName: rawName,
    endingLabel: null,
    isBoss: isFinaleBattle(entry) || /STAGE|LAST/i.test(rawName),
  }
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
      const battleDrafts = Object.values(node.battle)
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => buildBattleDraft(entry))

      if (isLastStageNode(node) && battleDrafts.length > 1) {
        assignEndingLayerNames(battleDrafts)
        battleDrafts.sort((a, b) => {
          const ea = Number(String(a.endingLabel ?? '').replace(/\D/g, '')) || 999
          const eb = Number(String(b.endingLabel ?? '').replace(/\D/g, '')) || 999
          if (ea !== eb) return ea - eb
          if (a.isBoss !== b.isBoss) return a.isBoss ? -1 : 1
          return String(a.layerName).localeCompare(String(b.layerName), 'zh')
        })
      } else {
        // 普通关：层名保持 nanoka 原名；STAGE 主层视为终局层
        for (const draft of battleDrafts) {
          draft.layerName = draft.rawName || draft.battleId
          draft.isBoss =
            draft.isFinale || /^(STAGE|LAST)\b/i.test(draft.layerName) || /LAST/i.test(draft.layerName)
        }
      }

      for (const draft of battleDrafts) {
        const roomName = draft.layerName
        const { layer, layerRoom, monsters, selectable } = draft

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
          isBoss: draft.isBoss === true,
          ending: draft.endingLabel || null,
          monsters,
        })

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
