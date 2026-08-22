import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import bossRoutes from './routes/bossRoutes.js'
import bossInfoRoutes from './routes/bossInfoRoutes.js'
import buffRoutes from './routes/buffRoutes.js'
import calculatorBuffRoutes from './routes/calculatorBuffRoutes.js'
import adminAuthRoutes from './routes/adminAuthRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import crisisAssaultRoutes from './routes/crisisAssaultRoutes.js'
import defenseRoutes from './routes/defenseRoutes.js'
import ocrRoutes from './routes/ocrRoutes.js'
import changelogRoutes from './routes/changelogRoutes.js'
import siteInfoRoutes from './routes/siteInfoRoutes.js'
import guestbookRoutes from './routes/guestbookRoutes.js'
import authRoutes from './routes/authRoutes.js'
import seasonDateRoutes from './routes/seasonDateRoutes.js'
import seasonContentRoutes from './routes/seasonContentRoutes.js'
import deductionRoutes from './routes/deductionRoutes.js'
import deductionAdminRoutes from './routes/deductionAdminRoutes.js'
import pool from './config/db.js'
import { ensureRuntimeSchema } from './bootstrap/ensureRuntimeSchema.js'
import { fail } from './utils/response.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT) || 3000

// 反代（IIS / Nginx）会注入 X-Forwarded-For；须 trust proxy，否则 express-rate-limit 抛 ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// TRUST_PROXY：未设或 true/1 → 信任 1 层；数字 → 跳数；false/0 → 关闭（本机直连调试）
{
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase()
  if (raw === 'false' || raw === '0') {
    // leave default false
  } else if (raw && /^\d+$/.test(raw)) {
    app.set('trust proxy', Number(raw))
  } else {
    app.set('trust proxy', 1)
  }
}

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS?.trim()
  if (!raw || raw === '*') return null
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const corsOrigins = parseCorsOrigins()

app.use(
  helmet({
    // 静态图与前端同源/反代场景下避免过度限制；CSP 由站点层另行配置
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)

app.use(
  cors({
    origin: corsOrigins
      ? (origin, callback) => {
          // 同机无 Origin（curl / 同源反代）放行
          if (!origin || corsOrigins.includes(origin)) {
            callback(null, true)
            return
          }
          callback(new Error(`CORS blocked for origin: ${origin}`))
        }
      : true,
    // 自定义客户端标识 / 管理员 token，避免反向代理或预检导致游客额度失效
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-OCR-Client-Id',
      'X-Admin-Token',
    ],
  }),
)

app.use(express.json({ limit: '1mb' }))

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试', data: null },
})

const authWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '登录尝试过于频繁，请稍后再试', data: null },
})

app.use('/api', generalApiLimiter)

app.use('/boss_image', express.static(path.join(__dirname, '../boss_image')))
app.use('/buff_image', express.static(path.join(__dirname, '../buff_image')))
app.use('/attribute_image', express.static(path.join(__dirname, '../attribute_image')))
app.use('/calculator_image', express.static(path.join(__dirname, '../calculator_image')))
app.use('/guestbook_image', express.static(path.join(__dirname, '../guestbook_image')))
// 计算器实体头像（管理端上传写入这些目录；IIS 需反代到 Node，与 boss_image 相同）
app.use('/character', express.static(path.join(__dirname, '../character')))
app.use('/wengine', express.static(path.join(__dirname, '../wengine')))
app.use('/drive_disc', express.static(path.join(__dirname, '../drive_disc')))
app.use('/bangboo', express.static(path.join(__dirname, '../bangboo')))

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ code: 200, message: 'ok', data: { db: 'up' } })
  } catch {
    res.status(503).json({ code: 503, message: 'db unavailable', data: { db: 'down' } })
  }
})

app.use('/api/admin/login', authWriteLimiter)
app.use('/api/auth/login', authWriteLimiter)
app.use('/api/auth/mihoyo', authWriteLimiter)
app.use('/api/auth/phone', authWriteLimiter)

const guestbookUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GUESTBOOK_UPLOAD_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '图片上传过于频繁，请稍后再试', data: null },
})
app.use('/api/upload/guestbook', guestbookUploadLimiter)
app.use('/api/auth/me/avatar', guestbookUploadLimiter)

app.use('/api/admin', adminAuthRoutes)
app.use('/api/admin/season-content', seasonContentRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/ocr', ocrRoutes)
app.use('/api/crisis-assault', crisisAssaultRoutes)
app.use('/api/defense', defenseRoutes)
app.use('/api/boss', bossRoutes)
app.use('/api/boss-info', bossInfoRoutes)
app.use('/api/buff', buffRoutes)
app.use('/api/calculator-buffs', calculatorBuffRoutes)
app.use('/api/changelog', changelogRoutes)
app.use('/api/site-info', siteInfoRoutes)
app.use('/api/guestbook', guestbookRoutes)
app.use('/api/season-dates', seasonDateRoutes)
app.use('/api/deduction', deductionRoutes)
app.use('/api/admin/deduction', deductionAdminRoutes)

app.use((_req, res) => {
  fail(res, '接口不存在', 404)
})

app.use((err, _req, res, _next) => {
  if (err?.message?.startsWith('CORS blocked')) {
    return fail(res, '跨域请求被拒绝', 403)
  }
  const expose =
    process.env.NODE_ENV !== 'production' || process.env.EXPOSE_ERROR_DETAIL === '1'
  if (expose && err?.message) {
    return fail(res, '服务器内部错误', 500, { error: err.message })
  }
  return fail(res, '服务器内部错误', 500)
})

app.listen(port, () => {
  console.log(`后端 API 服务已启动: http://localhost:${port}`)
  ensureRuntimeSchema().catch((err) => {
    console.warn('[schema] ensureRuntimeSchema failed:', err?.message || err)
  })
})
