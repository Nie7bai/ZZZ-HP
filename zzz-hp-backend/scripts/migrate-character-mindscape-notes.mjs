import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const [columns] = await conn.query(
  "SHOW COLUMNS FROM `character` LIKE 'mindscape_notes'",
)
if (!columns.length) {
  await conn.query(
    "ALTER TABLE `character` ADD COLUMN `mindscape_notes` JSON NOT NULL COMMENT '0-6影画注释数组' AFTER `note`",
  )
  await conn.query(
    "UPDATE `character` SET mindscape_notes = JSON_ARRAY('', '', '', '', '', '', '')",
  )
  console.log('Added mindscape_notes column')
} else {
  console.log('mindscape_notes column already exists')
}

await conn.end()
