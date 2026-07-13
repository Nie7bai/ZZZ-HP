import dotenv from 'dotenv'
import { deleteAllDefenseData } from '../src/services/dataService.js'

dotenv.config()

const result = await deleteAllDefenseData()
console.log(JSON.stringify(result, null, 2))
