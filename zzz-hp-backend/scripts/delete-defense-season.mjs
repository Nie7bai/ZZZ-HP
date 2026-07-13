import dotenv from 'dotenv'
import { deleteDefenseSeasonData } from '../src/services/dataService.js'

dotenv.config()

const version = process.argv[2] ?? '2.9'
const phase = process.argv[3] ?? '3'

const result = await deleteDefenseSeasonData(version, phase)
console.log(JSON.stringify(result, null, 2))
