export function success(res, data = null, message = 'success', code = 200) {
  return res.status(code).json({ code, message, data })
}

export function fail(res, message = 'error', code = 400, data = null) {
  return res.status(code).json({ code, message, data })
}
