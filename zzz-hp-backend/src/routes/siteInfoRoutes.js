import { Router } from 'express'
import {
  editSiteInfoSection,
  getSiteInfoSectionByKey,
  getSiteInfoSections,
} from '../controllers/siteInfoController.js'

const router = Router()

router.get('/', getSiteInfoSections)
router.get('/:panelKey', getSiteInfoSectionByKey)
router.put('/:panelKey', editSiteInfoSection)

export default router
