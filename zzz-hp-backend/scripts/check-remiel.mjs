import dotenv from 'dotenv'
import pool from '../src/config/db.js'

dotenv.config()

const [rows] = await pool.query(
  'SELECT id, name, note, base_panel, mindscape_buffs FROM `character` WHERE id = ?',
  ['remiel'],
)
console.log(JSON.stringify(rows[0] ?? null, null, 2))
await pool.end()
