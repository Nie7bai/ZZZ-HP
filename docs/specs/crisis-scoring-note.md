# 危局强袭战：得分机制（纯文本）

## 目标

危局强袭战往期详情目前只展示**场地 Buff**（有结构化增益）。得分机制是**纯文本规则**、没有增益，也需要在同一张怪物卡片里展示。

## 关键决定

- **绑定对象是怪物**，不是赛季/期数：得分机制随 Boss 固定、一般不随期更换；
- 因此存在怪物库 `boss_info.scoring_note`（`TEXT`，纯文本），而不是 `date`（赛季日期表）或 `boss`（期数行）；
- **展示位置：场地 Buff 之上**（同一张敌方卡片的属性区之后）。没有内容时不占位。

## 数据与链路

| 层 | 位置 | 说明 |
|---|---|---|
| 建表/补列 | `zzz-hp-backend/src/utils/bossSchema.js` → `ensureBossScoringNoteSchema()` | 首次读写自动 `ALTER TABLE boss_info ADD COLUMN scoring_note TEXT` |
| 怪物库读写 | `zzz-hp-backend/src/services/bossInfoService.js` | 列清单 / 新建 / 按 id 更新 / 按名称 upsert 全覆盖；未传值时保留库中原值（与 `resistance_high` 同策略） |
| 危局下发 | `zzz-hp-backend/src/services/crisisAssaultService.js` | `loadBossScoringNoteMap()` 按 `boss_name` 取值，`enrichBoss` 输出 `scoring_note`（缺省 null） |
| 前端接口 | `zzz-hp/src/api/crisisAssault.ts` | `ApiBoss.scoring_note` → `EnemySlot.scoringNote`（trim 后空串转 null） |
| 类型 | `zzz-hp/src/types/history.ts` | `EnemySlot.scoringNote?: string \| null` |
| 展示 | `zzz-hp/src/components/history/HistoryDetailPanel.vue` | `scoringNoteLines()` 按行拆分；`.enemy-scoring-note` 块渲染在 `.enemy-field-buff` **之前**（桌面与紧凑两套模板各一处） |
| 管理端 | `zzz-hp/src/components/admin/AdminBossInfoCatalogPanel.vue` | 怪物基础库编辑面板新增「得分机制（纯文本，无增益）」多行输入（跨整行），随基础信息一起保存 |

## 行为边界

- 纯展示：不进入任何增益 / 乘区 / 面板计算；
- 与场地 Buff 无耦合：场地 Buff 是「套」结构（可多套、按 `field_buff_set_id` 绑定），得分机制是单段文本；
- 导出截图：得分机制**不隐藏**（场地 Buff 的原文会按 `CAPTURE_HIDE_CLASS` 隐藏，两者策略不同）；
- 空值（null / 空白）→ 不渲染该块，老数据无变化。

## 验收

- 端到端手测：把 `boss_info.scoring_note` 写两条测试文本 → 危局强袭战往期详情中该怪物卡片出现「得分机制」标题 + 两行内容，且位于「场地 Buff」标题之前；清空后该块消失（本次已按此验证，测试值已还原）；
- 后端 `npm test` 155 pass / 0 fail；
- 前端 `vue-tsc --noEmit`、`eslint src` 通过。

## 非目标

- 不做富文本 / Markdown 渲染（`BuffRichText` 只处理既有强调语法）；
- 不把得分机制纳入赛季导入导出快照（`boss_info` 走自己的迁移脚本）；
- 不做按房间 / 期数的覆盖值（如以后需要，再在 `boss` 期数行加 `scoring_note` 覆盖列）。
