import dotenv from 'dotenv'
import { importNanokaDefenseSeasonBatch } from '../src/services/nanokaDefenseImportService.js'

dotenv.config()

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const fromId = Number(readArg('--from', '62038'))
const toId = Number(readArg('--to', '62053'))
const locale = readArg('--locale', 'zh')
const dryRun = process.argv.includes('--dry-run')
const delayMs = Number(readArg('--delay', '600'))

const result = await importNanokaDefenseSeasonBatch({
  fromId,
  toId,
  locale,
  dryRun,
  delayMs,
})

console.log(JSON.stringify({
  dryRun: result.dryRun,
  buildTag: result.buildTag,
  fromId: result.fromId,
  toId: result.toId,
  summary: result.summary,
  seasons: result.seasons.map((season) => ({
    seasonId: season.seasonId,
    seasonName: season.seasonName,
    versionPhase: season.versionPhase,
    beginTime: season.beginTime,
    endTime: season.endTime,
    summary: season.summary,
    errorCount: season.errors?.length ?? 0,
  })),
  errors: result.summary.errors,
}, null, 2))
