import pool from '../config/db.js'
import { isCrisisBossId, isCrisisBuffId } from '../utils/defenseId.js'

function comparePhase(a, b) {
  const versionDiff = Number(a.version) - Number(b.version)
  if (versionDiff !== 0) return versionDiff
  return Number(a.phase) - Number(b.phase)
}

function formatDateValue(value) {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = value.getMonth() + 1
    const day = value.getDate()
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

export async function getCrisisAssaultPhases() {
  const [bossRowsRaw] = await pool.execute(
    'SELECT * FROM boss ORDER BY version, phase, CAST(room AS UNSIGNED)',
  )
  const [buffRowsRaw] = await pool.execute('SELECT * FROM buff ORDER BY version, phase, id')
  const bossRows = bossRowsRaw.filter((boss) => isCrisisBossId(boss.id))
  const buffRows = buffRowsRaw.filter((buff) => isCrisisBuffId(buff.id))
  const [dateRows] = await pool.execute(
    'SELECT version, phase, start_date, end_date FROM `date`',
  )
  const [idRows] = await pool.execute('SELECT id, tid FROM id_table')

  const dateMap = new Map(
    dateRows.map((row) => [`${row.version}-${row.phase}`, row]),
  )
  const tidMap = new Map(idRows.map((row) => [Number(row.id), Number(row.tid)]))

  const phaseMap = new Map()

  for (const boss of bossRows) {
    const key = `${boss.version}-${boss.phase}`
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        version: boss.version,
        phase: String(boss.phase),
        bosses: [],
        buffs: [],
      })
    }
    phaseMap.get(key).bosses.push(boss)
  }

  for (const buff of buffRows) {
    const key = `${buff.version}-${buff.phase}`
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        version: buff.version,
        phase: String(buff.phase),
        bosses: [],
        buffs: [],
      })
    }
    phaseMap.get(key).buffs.push(buff)
  }

  const phases = [...phaseMap.values()]
    .filter((item) => item.bosses.length > 0)
    .sort(comparePhase)
    .map((item) => {
      const totalHp = item.bosses.reduce((sum, boss) => sum + Number(boss.hp), 0)
      const dateInfo = dateMap.get(`${item.version}-${item.phase}`)
      const phaseId = Number(`${String(item.version).replace('.', '')}${item.phase}`)
      const tid = tidMap.get(phaseId) ?? null

      return {
        id: `ca-${item.version}-${item.phase}`,
        version: item.version,
        phase: item.phase,
        phaseLabel: `第 ${item.phase} 期`,
        startDate: formatDateValue(dateInfo?.start_date),
        endDate: formatDateValue(dateInfo?.end_date),
        totalHp,
        tid,
        bosses: item.bosses.map((boss) => ({
          id: boss.id,
          boss_name: boss.boss_name,
          hp: Number(boss.hp),
          defense: Number(boss.defense),
          level: Number(boss.level),
          room: boss.room,
          weakness: boss.weakness,
          resistance: boss.resistance,
          boss_image: boss.boss_image,
        })),
        buffs: item.buffs.map((buff) => ({
          id: buff.id,
          buff_name: buff.buff_name,
          buff: buff.buff,
          buff_image: buff.buff_image,
        })),
      }
    })

  return phases
}

export async function getBossNames() {
  const [rows] = await pool.execute(
    'SELECT boss_name, boss_image, id FROM boss ORDER BY boss_name',
  )

  const seen = new Map()
  for (const row of rows) {
    if (!isCrisisBossId(row.id)) continue
    if (!seen.has(row.boss_name)) {
      seen.set(row.boss_name, row.boss_image)
    }
  }

  return [...seen.entries()].map(([boss_name, boss_image]) => ({
    boss_name,
    boss_image,
  }))
}

export async function getBossChartHistory(bossName) {
  const [bossRows] = await pool.execute(
    `SELECT *
     FROM boss
     WHERE boss_name = ?
     ORDER BY version, CAST(phase AS UNSIGNED)`,
    [bossName],
  )

  if (!bossRows.length) return []

  const [dateRows] = await pool.execute(
    'SELECT version, phase, start_date, end_date FROM `date`',
  )

  const dateMap = new Map(
    dateRows.map((row) => [`${row.version}-${row.phase}`, row]),
  )

  return bossRows
    .filter((boss) => isCrisisBossId(boss.id))
    .sort((a, b) => comparePhase(
      { version: a.version, phase: a.phase },
      { version: b.version, phase: b.phase },
    ))
    .map((boss) => {
      const dateInfo = dateMap.get(`${boss.version}-${boss.phase}`)
      return {
        label: `${boss.version}第${boss.phase}期`,
        dateRange: formatDateRangeValue(dateInfo?.start_date, dateInfo?.end_date),
        totalHp: Number(boss.hp),
        version: boss.version,
        phase: String(boss.phase),
        boss_image: boss.boss_image,
      }
    })
}

function formatDateRangeValue(startDate, endDate) {
  const start = formatDateValue(startDate)
  const end = formatDateValue(endDate)
  if (!start || !end) return '日期待更新'

  const formatDot = (value) => {
    const [year, month, day] = value.split('-')
    return `${year}.${Number(month)}.${Number(day)}`
  }

  return `${formatDot(start)} - ${formatDot(end)}`
}
