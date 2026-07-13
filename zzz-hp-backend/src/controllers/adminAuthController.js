import { verifyAdminPassword } from '../services/adminAuthService.js'
import { success, fail } from '../utils/response.js'

export async function loginAdmin(req, res) {
  const password = req.body?.password

  if (typeof password !== 'string' || !password.trim()) {
    return fail(res, '请输入密码', 400)
  }

  try {
    const ok = await verifyAdminPassword(password.trim())
    if (!ok) {
      return fail(res, '密码错误', 401)
    }
    return success(res, { authenticated: true }, '登录成功')
  } catch (err) {
    return fail(res, '登录失败', 500, { error: err.message })
  }
}
