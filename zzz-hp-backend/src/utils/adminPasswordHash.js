import bcrypt from 'bcryptjs'

/** bcrypt 成本因子；12 约 250ms/次，适合管理员低频登录 */
export const BCRYPT_ROUNDS = 12

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/

export function isBcryptHash(stored) {
  return typeof stored === 'string' && BCRYPT_HASH_RE.test(stored)
}

export async function hashAdminPassword(plain) {
  const input = typeof plain === 'string' ? plain.trim() : ''
  if (!input) throw new Error('密码不能为空')
  return bcrypt.hash(input, BCRYPT_ROUNDS)
}

export async function verifyAdminPasswordHash(plain, stored) {
  const input = typeof plain === 'string' ? plain : ''
  const hash = typeof stored === 'string' ? stored : ''
  if (!input || !hash) return false
  if (isBcryptHash(hash)) return bcrypt.compare(input, hash)
  return input === hash
}
