import dotenv from 'dotenv'
import pool from '../src/config/db.js'

dotenv.config()

const [groups] = await pool.execute(
  `SELECT version, phase, COUNT(*) AS count
   FROM boss
   WHERE CHAR_LENGTH(CAST(id AS CHAR)) = 9
   GROUP BY version, phase
   ORDER BY version, phase`,
)
console.log('defense boss groups:', groups)

const [samples] = await pool.execute(
  `SELECT id, version, phase, boss_name
   FROM boss
   WHERE CHAR_LENGTH(CAST(id AS CHAR)) = 9
   ORDER BY id
   LIMIT 15`,
)
console.log('samples:', samples)
