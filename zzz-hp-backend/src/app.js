import express from 'express'
import cors from 'cors'
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
import { fail } from './utils/response.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT) || 3000

app.use(
  cors({
    origin: true,
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
app.use('/boss_image', express.static(path.join(__dirname, '../boss_image')))
app.use('/buff_image', express.static(path.join(__dirname, '../buff_image')))
app.use('/calculator_image', express.static(path.join(__dirname, '../calculator_image')))
app.use('/guestbook_image', express.static(path.join(__dirname, '../guestbook_image')))

app.get('/health', (_req, res) => {
  res.json({ code: 200, message: 'ok', data: null })
})

app.use('/api/admin', adminAuthRoutes)
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

app.use((_req, res) => {
  fail(res, '接口不存在', 404)
})

app.use((err, _req, res, _next) => {
  fail(res, '服务器内部错误', 500, { error: err.message })
})

app.listen(port, () => {
  console.log(`后端 API 服务已启动: http://localhost:${port}`)
})
