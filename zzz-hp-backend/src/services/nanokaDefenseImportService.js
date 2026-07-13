import {
  fetchSeasonDetail,
  fetchShiyuIndex,
  listSeasonIdsFromPage,
  resolveNanokaBuildTag,
  seasonIndexEntries,
} from './nanoka/nanokaClient.js'
import { parseNanokaDefenseSeason } from './nanoka/nanokaDefenseParser.js'
import { resolveSeasonVersionPhase } from './nanoka/seasonMeta.js'
import { upsertBoss, upsertBuff } from './dataService.js'

async function pickSeasonId({
  seasonId,
  buildTag,
  shiyuIndex,
}) {
  if (seasonId) return String(seasonId)

  const pageSeasons = await listSeasonIdsFromPage()
  if (pageSeasons.length) {
    return pageSeasons[0]
  }

  const indexed = seasonIndexEntries(shiyuIndex)
    .filter((item) => item.begin)
    .sort((a, b) => String(b.begin).localeCompare(String(a.begin)))

  if (!indexed.length) {
    throw new Error('无法确定要导入的赛季 ID')
  }

  return indexed[0].seasonId
}

export async function importNanokaDefenseSeason(options = {}) {
  const {
    seasonId: requestedSeasonId = null,
    version = null,
    phase = null,
    locale = 'zh',
    dryRun = false,
    buildTag: providedBuildTag = null,
  } = options

  const buildTag = providedBuildTag ?? await resolveNanokaBuildTag()
  const shiyuIndex = await fetchShiyuIndex(buildTag)
  const seasonId = await pickSeasonId({
    seasonId: requestedSeasonId,
    buildTag,
    shiyuIndex,
  })

  const season = await fetchSeasonDetail(buildTag, seasonId, locale)
  const versionPhase = await resolveSeasonVersionPhase({
    seasonId,
    beginTime: season.begin_time,
    endTime: season.end_time,
    version,
    phase,
  })

  const parsed = parseNanokaDefenseSeason(season, {
    version: versionPhase.version,
    phase: versionPhase.phase,
  })

  if (dryRun) {
    return {
      dryRun: true,
      buildTag,
      seasonId,
      versionPhase,
      summary: {
        bosses: parsed.bosses.length,
        buffs: parsed.buffs.length,
      },
      preview: {
        bosses: parsed.bosses.slice(0, 5),
        buffs: parsed.buffs.slice(0, 5),
      },
      parsed,
    }
  }

  const bossResults = []
  const buffResults = []
  const errors = []

  for (const boss of parsed.bosses) {
    try {
      const result = await upsertBoss(boss)
      bossResults.push(result)
    } catch (err) {
      errors.push({
        type: 'boss',
        id: boss.id,
        name: boss.boss_name,
        error: err.message,
      })
    }
  }

  for (const buff of parsed.buffs) {
    try {
      const result = await upsertBuff(buff)
      buffResults.push(result)
    } catch (err) {
      errors.push({
        type: 'buff',
        id: buff.id,
        name: buff.buff_name,
        error: err.message,
      })
    }
  }

  return {
    dryRun: false,
    buildTag,
    seasonId,
    seasonName: parsed.seasonName,
    beginTime: parsed.beginTime,
    endTime: parsed.endTime,
    versionPhase,
    summary: {
      bosses: {
        total: parsed.bosses.length,
        created: bossResults.filter((item) => item.action === 'created').length,
        updated: bossResults.filter((item) => item.action === 'updated').length,
        failed: errors.filter((item) => item.type === 'boss').length,
      },
      buffs: {
        total: parsed.buffs.length,
        created: buffResults.filter((item) => item.action === 'created').length,
        updated: buffResults.filter((item) => item.action === 'updated').length,
        failed: errors.filter((item) => item.type === 'buff').length,
      },
    },
    errors,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function importNanokaDefenseSeasonBatch(options = {}) {
  const {
    fromId = 62038,
    toId = 62053,
    locale = 'zh',
    dryRun = false,
    delayMs = 600,
    buildTag: providedBuildTag = null,
  } = options

  const from = Number(fromId)
  const to = Number(toId)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
    throw new Error('无效的赛季 ID 范围')
  }

  const buildTag = providedBuildTag ?? await resolveNanokaBuildTag()
  const seasons = []

  for (let seasonId = from; seasonId <= to; seasonId += 1) {
    const result = await importNanokaDefenseSeason({
      seasonId: String(seasonId),
      locale,
      dryRun,
      buildTag,
    })
    seasons.push(result)
    if (delayMs > 0 && seasonId < to) {
      await sleep(delayMs)
    }
  }

  const summary = seasons.reduce(
    (acc, item) => {
      acc.seasons += 1
      acc.bosses.total += item.summary?.bosses?.total ?? item.summary?.bosses ?? 0
      acc.bosses.created += item.summary?.bosses?.created ?? 0
      acc.bosses.updated += item.summary?.bosses?.updated ?? 0
      acc.bosses.failed += item.summary?.bosses?.failed ?? 0
      acc.buffs.total += item.summary?.buffs?.total ?? item.summary?.buffs ?? 0
      acc.buffs.created += item.summary?.buffs?.created ?? 0
      acc.buffs.updated += item.summary?.buffs?.updated ?? 0
      acc.buffs.failed += item.summary?.buffs?.failed ?? 0
      acc.errors.push(...(item.errors ?? []))
      return acc
    },
    {
      seasons: 0,
      bosses: { total: 0, created: 0, updated: 0, failed: 0 },
      buffs: { total: 0, created: 0, updated: 0, failed: 0 },
      errors: [],
    },
  )

  return {
    dryRun,
    buildTag,
    fromId: from,
    toId: to,
    seasons,
    summary,
  }
}
