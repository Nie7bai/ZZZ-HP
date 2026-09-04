import { Router } from 'express'
import { getDeductionPhases } from '../services/deductionService.js'
import { success, failInternal } from '../utils/response.js'

const router = Router()

router.get('/phases', async (_req, res) => {
  try {
    const data = await getDeductionPhases()
    success(res, data)
  } catch (err) {
    failInternal(res, err, '获取临界推演数据失败')
  }
})

export default router
