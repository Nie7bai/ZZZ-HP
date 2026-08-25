/**
 * 启动时集中触发各 service 的 schema 自愈（CREATE/ALTER）。
 * 完整建表仍以 init_schema.sql 为准；此处收敛「散落 ensure」的入口。
 */
import { ensureUserSecurityColumns } from '../services/userAuthService.js'
import { ensureGuestbookSchema } from '../services/guestbookService.js'
import { ensureGuestbookSocialSchema } from '../services/guestbookSocialService.js'
import { ensureSeasonContentTrashTable } from '../services/seasonContentTrashService.js'
import { ensureSameNameBuffEffectConsistency } from '../utils/sameNameBuffEffects.js'

export async function ensureRuntimeSchema() {
  await ensureUserSecurityColumns()
  await ensureGuestbookSchema()
  await ensureGuestbookSocialSchema()
  await ensureSeasonContentTrashTable()
  // 跨期同名环境 Buff 结构化增益补齐（进程内只跑一次）
  await ensureSameNameBuffEffectConsistency()
}
