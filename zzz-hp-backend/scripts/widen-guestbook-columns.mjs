import 'dotenv/config'
import pool from '../src/config/db.js'

await pool.query(
  `ALTER TABLE guestbook MODIFY COLUMN title VARCHAR(120) NOT NULL DEFAULT '' COMMENT '标题'`,
)
await pool.query(
  `ALTER TABLE guestbook MODIFY COLUMN content VARCHAR(2000) NOT NULL DEFAULT '' COMMENT '正文'`,
)
const [cols] = await pool.query(
  `SHOW COLUMNS FROM guestbook WHERE Field IN ('title', 'content')`,
)
console.log(cols.map((c) => `${c.Field}:${c.Type}`).join(', '))
await pool.end()
