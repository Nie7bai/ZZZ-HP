import dotenv from 'dotenv'
import { importNanokaDefenseSeason } from '../src/services/nanokaDefenseImportService.js'

dotenv.config()

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const seasonId = readArg('--season') ?? process.argv[2] ?? null
const version = readArg('--version')
const phase = readArg('--phase')
const locale = readArg('--locale') ?? 'zh'
const dryRun = process.argv.includes('--dry-run')

const result = await importNanokaDefenseSeason({
  seasonId,
  version,
  phase,
  locale,
  dryRun,
})

console.log(JSON.stringify(result, null, 2))
