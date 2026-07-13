import dotenv from 'dotenv'
import pool from '../src/config/db.js'
import { decodeDefenseBossId, decodeDefenseBuffId } from '../src/utils/defenseId.js'

dotenv.config()

const [bosses] = await pool.execute(
  `SELECT id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image
   FROM boss WHERE version = '3.0' AND phase = '1' ORDER BY id LIMIT 8`,
)
console.log('bosses', bosses.map((b) => ({ ...b, decoded: decodeDefenseBossId(b.id) })))

const [buffs] = await pool.execute(
  `SELECT id, version, phase, buff_name, buff FROM buff WHERE version = '3.0' AND phase = '1' ORDER BY id LIMIT 8`,
)
console.log('buffs', buffs.map((b) => ({ ...b, decoded: decodeDefenseBuffId(b.id) })))
