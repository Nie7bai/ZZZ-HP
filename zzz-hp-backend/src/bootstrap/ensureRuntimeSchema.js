/**
 * 启动时集中触发各 service 的 schema 自愈（CREATE/ALTER）。
 * 完整建表仍以 init_schema.sql 为准；此处收敛「散落 ensure」的入口。
 */
import { ensureSeasonContentTrashTable } from '../services/seasonContentTrashService.js'
import { ensureZoneSchema } from '../services/calculatorZoneService.js'
import { ensureChainSchema } from '../services/calculatorChainService.js'
import { ensureSameNameBuffEffectConsistency } from '../utils/sameNameBuffEffects.js'

export async function ensureRuntimeSchema() {
  await ensureSeasonContentTrashTable()
  // 乘区定义/方案与计算链路：与服务内惰性建表同一份 DDL，启动时提前跑一次
  await ensureZoneSchema()
  await ensureChainSchema()
  // 跨期同名环境 Buff 结构化增益补齐（进程内只跑一次）
  await ensureSameNameBuffEffectConsistency()
}
