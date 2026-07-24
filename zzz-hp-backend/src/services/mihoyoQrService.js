import { issueSessionForMihoyoUser, newDeviceId } from './userAuthService.js'

const APP_ID = 'bll8iq97cem8'
const CREATE_URL =
  'https://passport-api.miyoushe.com/account/ma-cn-passport/web/createQRLogin'
const QUERY_URL =
  'https://passport-api.miyoushe.com/account/ma-cn-passport/web/queryQRLoginStatus'

/** ticket -> { deviceId, createdAt } */
const ticketDevices = new Map()
const TICKET_TTL_MS = 5 * 60 * 1000

function purgeTickets() {
  const now = Date.now()
  for (const [ticket, meta] of ticketDevices.entries()) {
    if (now - Number(meta.createdAt) > TICKET_TTL_MS) ticketDevices.delete(ticket)
  }
}

function buildHeaders(deviceId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'x-rpc-app_id': APP_ID,
    'x-rpc-client_type': '4',
    'x-rpc-device_id': deviceId,
    'x-rpc-device_fp': deviceId.replace(/-/g, '').slice(0, 13).toLowerCase(),
  }
}

async function postJson(url, body, deviceId) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(deviceId),
    body: JSON.stringify(body ?? {}),
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`米游社接口返回异常: HTTP ${response.status}`)
  }
  return { response, json }
}

function mapStatus(raw) {
  const s = String(raw || '')
  if (s === 'Created') return 'waiting'
  if (s === 'Scanned') return 'scanned'
  if (s === 'Confirmed') return 'confirmed'
  return 'waiting'
}

/**
 * 创建米游社登录二维码
 * @returns {{ qrUrl: string, ticket: string, expiresIn: number, mode: 'login' }}
 */
export async function createMihoyoQr() {
  purgeTickets()
  const deviceId = newDeviceId()
  const { json } = await postJson(CREATE_URL, {}, deviceId)

  if (Number(json?.retcode) !== 0 || !json?.data?.url || !json?.data?.ticket) {
    const msg = json?.message || `retcode=${json?.retcode}`
    throw new Error(`创建二维码失败：${msg}`)
  }

  const ticket = String(json.data.ticket)
  const qrUrl = String(json.data.url).replace(/\\u0026/g, '&')
  ticketDevices.set(ticket, { deviceId, createdAt: Date.now() })

  return {
    qrUrl,
    ticket,
    expiresIn: 180,
    mode: 'login',
  }
}

/**
 * 轮询二维码状态；确认后签发本站会话
 */
export async function pollMihoyoQr(ticketRaw) {
  purgeTickets()
  const ticket = String(ticketRaw || '').trim()
  if (!ticket) return { status: 'error', message: '缺少 ticket' }

  const meta = ticketDevices.get(ticket)
  if (!meta) {
    return { status: 'expired', message: '二维码已失效，请刷新后重新扫描' }
  }

  const { json } = await postJson(QUERY_URL, { ticket }, meta.deviceId)
  const retcode = Number(json?.retcode)

  if (retcode === -3501) {
    ticketDevices.delete(ticket)
    return { status: 'expired', message: json?.message || '二维码已失效' }
  }
  if (retcode === -3505) {
    ticketDevices.delete(ticket)
    return { status: 'cancelled', message: json?.message || '扫码已取消' }
  }
  if (retcode !== 0) {
    return {
      status: 'error',
      message: json?.message || `查询失败 retcode=${retcode}`,
    }
  }

  const status = mapStatus(json?.data?.status)
  if (status !== 'confirmed') {
    return { status, mode: 'login' }
  }

  const userInfo = json?.data?.user_info || {}
  ticketDevices.delete(ticket)

  const { token, expiresAt, user, isNewUser } = await issueSessionForMihoyoUser(userInfo)
  return {
    status: 'confirmed',
    mode: 'login',
    isNewUser,
    auth: {
      token,
      expiresAt,
      user,
    },
  }
}
