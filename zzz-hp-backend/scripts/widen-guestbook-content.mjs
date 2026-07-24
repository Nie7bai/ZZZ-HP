import 'dotenv/config'
import pool from '../src/config/db.js'

await pool.query(`ALTER TABLE guestbook MODIFY COLUMN content TEXT NOT NULL COMMENT '正文'`)
const [cols] = await pool.query(`SHOW COLUMNS FROM guestbook WHERE Field = 'content'`)
console.log(cols.map((c) => `${c.Field}:${c.Type}`).join(', '))
await pool.end()
