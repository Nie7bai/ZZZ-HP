/**
 * Set or rotate the admin password hash from ADMIN_PASSWORD in .env,
 * then revoke all existing admin sessions.
 *
 * The backend must be stopped before this maintenance command runs so an
 * in-flight login cannot recreate a session after revocation.
 *
 * Usage:
 *   node scripts/set-admin-password.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { pathToFileURL } from 'node:url'
import { revokeAllAdminSessions } from '../src/services/adminSessionService.js'
import { hashAdminPassword } from '../src/utils/adminPasswordHash.js'

function getSafeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? `（${error.code}）`
    : ''
}

export async function runAdminPasswordRotation({
  plainPassword,
  environment = process.env,
  createConnection = mysql.createConnection,
  hashPassword = hashAdminPassword,
  revokeSessions = revokeAllAdminSessions,
  logger = console,
} = {}) {
  const normalizedPassword = plainPassword?.trim()
  if (!normalizedPassword) {
    logger.error('请先在 .env 中设置 ADMIN_PASSWORD，再运行本脚本。')
    return 1
  }

  let conn
  let passwordWritten = false
  let exitCode = 0

  try {
    conn = await createConnection({
      host: environment.DB_HOST || 'localhost',
      port: Number(environment.DB_PORT) || 3306,
      user: environment.DB_USER || 'root',
      password: environment.DB_PASSWORD || '123456',
      database: environment.DB_NAME || 'zzz',
    })

    const hash = await hashPassword(normalizedPassword)
    const [rows] = await conn.query('SELECT id FROM `admin` ORDER BY id ASC LIMIT 1')

    if (!rows.length) {
      await conn.execute('INSERT INTO `admin` (`password`) VALUES (?)', [hash])
    } else {
      await conn.execute('UPDATE `admin` SET `password` = ? WHERE `id` = ?', [
        hash,
        rows[0].id,
      ])
    }

    passwordWritten = true
    revokeSessions()
    logger.log('管理员密码已更新，全部现有管理员会话已撤销。')
  } catch (error) {
    const errorCode = getSafeErrorCode(error)
    if (passwordWritten) {
      logger.error(
        `管理员密码已写入数据库，但撤销现有管理员会话失败${errorCode}。请保持后端停服并检查 data 目录写权限。`,
      )
    } else {
      logger.error(`设置管理员密码失败${errorCode}。`)
    }
    exitCode = 1
  } finally {
    if (conn) {
      try {
        await conn.end()
      } catch (error) {
        logger.error(`关闭数据库连接失败${getSafeErrorCode(error)}。`)
        exitCode = 1
      }
    }
  }

  return exitCode
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsScript) {
  dotenv.config()
  process.exitCode = await runAdminPasswordRotation({
    plainPassword: process.env.ADMIN_PASSWORD,
  })
}
