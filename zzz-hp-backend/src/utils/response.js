export function success(res, data = null, message = 'success', code = 200) {
  return res.status(code).json({ code, message, data })
}

export function fail(res, message = 'error', code = 400, data = null) {
  return res.status(code).json({ code, message, data })
}

/**
 * 500 级内部错误的统一出口：message 使用稳定的中文文案，
 * 原始 err.message 仅在非生产环境（或显式 EXPOSE_ERROR_DETAIL=1）时作为 data.error 附带。
 * 开关口径与 app.js 全局错误处理器一致，控制器不得绕过本助手直传内部错误详情。
 */
export function failInternal(res, err, message = '服务器内部错误', code = 500) {
  const expose =
    process.env.NODE_ENV !== 'production' || process.env.EXPOSE_ERROR_DETAIL === '1'
  const detail = expose && err?.message ? { error: err.message } : null
  return fail(res, message, code, detail)
}
