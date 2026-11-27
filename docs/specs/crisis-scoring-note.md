# 危局强袭战：得分机制（纯文本）

## 目标

危局强袭战往期详情目前只展示**场地 Buff**（有结构化增益）。得分机制是**纯文本规则**、没有增益，也需要在同一张怪物卡片里展示。

## 关键决定

- **多套存储（与场地 Buff 同构）**：怪物库 `boss_info.scoring_note_sets`（JSON 数组，每套 `{id,label,name,text}`），
  第一套为默认并镜像回旧单列 `scoring_note`；
- **按期绑定一套**：期数行 `boss.scoring_note_set_id` 指向其中一套，空 = 第一套；
  某期改了规则就在怪物库新增一套、在期数编辑里绑定它；
- 旧的一次性文本覆盖 `boss.scoring_note` 仅作兜底：怪物库**没有套**时才读它，新流程不再写入；
- **展示位置：场地 Buff 之上**（同一张敌方卡片的属性区之后）。没有内容时不占位。

## 数据与链路

| 层 | 位置 | 说明 |
|---|---|---|
| 建表/补列 | `zzz-hp-backend/src/utils/bossSchema.js` → `ensureBossScoringNoteSchema()` | 自动补 `boss_info.scoring_note_sets`、`boss_info.scoring_note`、`boss.scoring_note_set_id`（以及兼容列 `boss.scoring_note`） |
| 多套工具 | `zzz-hp-backend/src/utils/bossScoringNoteSets.js` | 解析 / 归一化 / 序列化、旧单列 ↔ 第一套镜像、按绑定 id 取套（空回落第一套） |
| 怪物库读写 | `zzz-hp-backend/src/services/bossInfoService.js` | 列清单 / 新建 / 按 id 更新 / 按名称 upsert 全覆盖；未传值时保留库中原值（与 `resistance_high` 同策略） |
| 生效优先级 | `zzz-hp-backend/src/services/crisisAssaultService.js` | **绑定套优先**；只有怪物库完全没有套时才用旧一次性文本 `boss.scoring_note` 兜底（避免旧覆盖盖住绑定结果） |
| 危局下发 | 同上 | `enrichBoss` 输出：`scoring_note`（生效文本）、`scoring_note_set_id`（本期绑定）、`scoring_note_sets`（怪物库全部套） |
| 期数行写入 | `zzz-hp-backend/src/services/dataService.js` | `createBoss` 接受 `scoring_note_set_id`；未传（同步/导入）时保留库中原值，传 `null` 表示用第一套；带绑定时同时清掉旧的 `boss.scoring_note` 覆盖 |
| 前端接口 | `zzz-hp/src/api/crisisAssault.ts` | `ApiBoss.scoring_note` → `EnemySlot.scoringNote`（trim 后空串转 null） |
| 类型 | `zzz-hp/src/types/history.ts` | `EnemySlot.scoringNote?: string \| null` |
| 展示（往期详情） | `zzz-hp/src/components/history/HistoryDetailPanel.vue` | `scoringNoteLines()` 按行拆分；得分机制与场地 Buff 包在 `.enemy-side` 容器里、得分机制在前（桌面与紧凑两套模板各一处）。绝境双列布局下两者同处右列，避免得分机制被挤到图片旁边 |
| 展示（详情窗口） | `zzz-hp/src/components/history/MonsterDetailModal.vue` | `.monster-detail-scoring` 块，位于属性表之后、弱点/抗性转变之前 |
| 管理端（怪物库） | `zzz-hp/src/components/admin/AdminBossInfoCatalogPanel.vue` | 「得分机制（多套）」：标记 + 名称 + 正文，可增删；第一套为默认 |
| 管理端（期数） | `zzz-hp/src/components/admin/AdminMonsterPanel.vue` | 「得分机制套（本期绑定）」下拉：自动（第一套）/ 指定某一套 |
| 详情变化对比 | `zzz-hp/src/components/history/MonsterDetailModal.vue` + `historyMonsterDetail.findPreviousScoringNote` | 同 Boss + 房间取上一期，与本期不同则显示「得分机制变化」——**左右两栏**（原 / 现），外框与标题用「得分机制」同款蓝色 |
| 行首项目符号 | 同上 + `HistoryDetailPanel` | 展示时去掉行首的 `· • ● ▪ ◦`（录入文本常自带），列表也不再显示原生圆点；正文用 `BuffRichText` 渲染，操作分数字按既有规则高亮（绿色） |
| 互斥展示 | 同上 | 有「得分机制变化」时**不再重复显示当期得分机制**，与场地 Buff 的规则一致（变化 → 只显示原/现；未变化 → 平铺当期） |
| 详情场地 Buff | 同上 | 场地 Buff **有变化**时显示「原 / 现」转变；**没变化**时用同一个橙色框平铺展示当期正文/效果块注释（与卡片同口径） |
| 期数编辑器加载 | `zzz-hp/src/components/admin/AdminMonsterPanel.vue` | 打开编辑弹窗时即从上下文带上怪物库套列表（`ctx.scoringNoteSets`），否则下拉为空、选不了套 |
| 展示（怪物数据库） | `zzz-hp/src/components/history/MonsterComparePanel.vue` | `monster-compare` 详情在属性表之后、折线图之前加「得分机制」「场地 Buff」两块，交互照抄「弱点 / 抗性套」：多套时出现下拉（默认第一套，切怪重置），单套只显示标记；正文用 `BuffRichText`（操作分数字绿色）、去行首项目符号；场地 Buff 额外渲染效果块注释 |
| 图表标记 | 同上 + `zzz-hp/src/components/history/DualLineChartView.vue` | **弱点 / 抗性套沿用原来的整块蓝色底纹**；得分机制 / 场地 Buff 用**描边框**（紫 / 橙），且同一组内**连续期数合并成一个框**（不是一期一个）。框不填充、不拦截指针；两组框重叠时按层序向内缩进 2px。区块内给「紫色框 / 橙色框 = 该套对应期数：…」提示。图表新增 `markedGroups`，旧的 `markedLabels` 仍等价于单组默认蓝 |
| 期数命中判据 | `zzz-hp-backend/src/services/crisisAssaultService.js` | boss-chart 每期下发 `scoring_note_set_id` / `field_buff_set_id`（空绑定已解析成实际生效的第一套），前端据此标记；解析口径见 `resolveScoringNoteSet` 与 `resolveFieldBuffSetIdFromSets` |
| 行首符号 / 注释去重 | `zzz-hp/src/utils/historyNoteText.ts` | `stripNoteBullet` / `splitNoteLines` / `noteBlocksForDisplay` 单一来源：往期详情、怪物详情弹窗、怪物数据库三处共用（含字面量 `\n` 兼容） |

## 行为边界

- 纯展示：不进入任何增益 / 乘区 / 面板计算；
- 与场地 Buff 无耦合：场地 Buff 是「套」结构（可多套、按 `field_buff_set_id` 绑定），得分机制是单段文本；
- 导出截图：得分机制**不隐藏**（场地 Buff 的原文会按 `CAPTURE_HIDE_CLASS` 隐藏，两者策略不同）；
- 空值（null / 空白）→ 不渲染该块，老数据无变化；
- 得分机制条目**不带列表圆点**（`list-style: none`）；如果文本自身以「· 」开头，也会原样显示，需要时在管理端删掉那个字符。

## 验收

- 端到端手测：把 `boss_info.scoring_note` 写两条测试文本 → 危局强袭战往期详情中该怪物卡片出现「得分机制」标题 + 两行内容，且位于「场地 Buff」标题之前；清空后该块消失（本次已按此验证，测试值已还原）；
- 怪物数据库（`/crisis-assault/monster-compare`）手测：亵渎者（单套）显示「得分机制」「场地 Buff」两块；提丰（4 套）得分机制块出现下拉，切到「3.3第二期」正文由 1 行变 4 行，切回「第 1 套」复原；
- 图表标记手测：恶名·死路屠夫（得分机制 3 套）选「第 1 套」提示 `1.4第3期、1.5第1期、1.7第2期、2.0第3期`、图上这几列紫色，选「2.1第二期」提示 `2.1第2期…2.6第1期`、紫底纹随之右移；魇缚者·叶释渊（场地 Buff 2 套）选「减防」提示 `2.4第1期…3.2第2期`、橙色底纹覆盖这几列，选「失衡易伤」提示 `2.8第2期、2.8第3期、3.0第1期、3.0第2期`；
- 后端 `npm test` 155 pass / 0 fail；
- 前端 `vue-tsc --noEmit`、`eslint src` 通过。

## 非目标

- 不做富文本 / Markdown 渲染（`BuffRichText` 只处理既有强调语法）；
- 不把得分机制纳入赛季导入导出快照（`boss_info` 走自己的迁移脚本）；
- 不做按房间 / 期数的覆盖值（如以后需要，再在 `boss` 期数行加 `scoring_note` 覆盖列）。
