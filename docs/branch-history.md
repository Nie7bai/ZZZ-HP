# 历史分支记录

本文于 2026-08-26 由原根目录分支记录整理，用于追溯旧版本线、专题分支和外部交接内容。记录中的分支关系来自迁移前文档，迁移时未逐项核对远程引用。

当前分支、PR 和 tag 状态以 Git 与 GitHub 为准。本文不定义分支规则，也不能用于选择当前开发或发布基线；现行规则见 [Git 协作与发布政策](./policies/git-workflow.md)。

## 版本分支

| 分支 | 原记录中的定位与内容 |
|------|----------------------|
| `3.0.9.1` | 3.0.9 计算器增益效果块体系，以及云部署 `pack-update` 打包脚本 |
| `3.1.1` | 流明、蕾米埃尔早期线，包括 Remiel 种子、upsert 工具及多产生者事件结算基础 |
| `3.1.2` | 蕾米埃尔本人耀变公式、敌方抗性配置，以及危局 roomType 和图表提示修正 |
| `3.1.3` | 自定义伤害模式按队伍缓存，以及管理端内容编辑 |
| `3.1.6` | 管理端鉴权和生产安全设置、伤害事件产生角色显示、模式侧栏搜索等改动，并汇入后续 `3.1.6.x` 内容 |
| `3.1.6.1` | 绝区零风格 UI 重设计和协议边界修复，后续合入 `3.1.6.2` 的安全改动 |
| `3.1.6.2` | 上传、路径、OTP 和密钥检查等安全加固 |
| `3.1.6.3` | 合入 `zzz-hp-handoff1`，并收口招式流程、危局转换器和计算器方案事件 |
| `3.1.6.4` | 招式流程和危局分数血量转换器专题线，原记录称其内容已并入 `3.1.6.3` |
| `3.1.7` | 原记录称其由 `3.1.6.3` 封板，包含招式流程、转换器和计算器续更 |
| `3.1.7.1` | 旧文档曾将其描述为 `3.1.7` 之后的迭代线；2026-08-26 迁移时未在 Git 引用中找到该分支，保留待核实 |

## 功能与实验分支

### `feature/crisis-hp-score-converter`

- 基线：原记录为提交 `fc8ee68`，对应当时的 `3.1.6.3` 和 `feature/skill-flow-redesign` 工作尖端。
- 目标：在危局强袭战的分数与血量对应表下增加双向转换器。
- 内容：复用 `crisisScoreHpTable.ts` 的累计拐点，分别维护正常和困难输入，展示插值区间与算式，并保留最多 10 条换算记录。
- 结果：原记录称该专题经 `3.1.6.4` 合入 `3.1.6.3`。

### `feature/skill-flow-redesign`

- 基线：从 `3.1.6.4` 拉出。
- 目标：将伤害计算事件重构为招式库、准备阶段和流程三层，后两层跟随方案。
- 内容：招式由伤害类型、招式类型和可选增益锚点组成，并补充异常类、双代理人和特殊触发者规则。
- 结果：原记录称主体已合入 `3.1.6.3`。方案见 [`skill-flow-redesign.md`](../skill-flow-redesign.md)，公式见 [`CALCULATOR_FORMULAS.md`](../CALCULATOR_FORMULAS.md)，后续规划见 [`future-roadmap.md`](../future-roadmap.md)。

### `cursor/*` 历史专题

| 分支 | 内容 |
|------|------|
| `cursor/add-defense-stat-c687` | 防御力作为基础伤害来源，补全防御增益字段 |
| `cursor/anomaly-producer-scope-c687` | 属性异常产生角色范围放宽为全队 |
| `cursor/convert-crit-attrs-c687` | 转模来源支持暴击和爆伤 |
| `cursor/convert-initial-base-c687` | 转模支持初始值，只折算超出部分 |
| `cursor/convert-panel-admin-visible-c687` | 转模队友局外面板，危局管理员可查看未公开期 |
| `cursor/convert-pierce-source-c687` | 转模来源支持贯穿力 |
| `cursor/fix-convert-buff-display-c687` | 局外面板变化后同步局内 Buff 展示 |
| `cursor/fix-direct-dmg-formula-display-c687` | 修正直伤公式展示和期望详情 |
| `cursor/fix-turbulence-release-events-b441` | release-mult 测试改用 vite-node |
| `cursor/hybrid-defense-pen-c687` | 异常基础防御区中，穿透取产生角色，减防取主 C |
| `cursor/same-day-public-c687` | 危局和防卫仅在开始日当天公开 |
| `cursor/settlement-dmg-mult-c687` | 决算倍率作为直伤独立分量 |

## 其他分支与交接

| 分支或交接目录 | 原记录中的内容 |
|----------------|----------------|
| `pr-12-preview` | PR 预览，组队导入弹窗与槽位卡片 UI 整合，后续进入主线 |
| `backup/local-wip-20260728` | 本地 WIP 备份 |
| `handoff/feature-zzz-ui-redesign` | 外部交接的 UI 重设计，内容已 cherry-pick 到 `3.1.6.1` |
| `handoff/fix-backend-normalize-bugs` | 外部交接的 logout、ownerAgentId、radiance 和 scope 修复 |
| `zzz-hp-handoff1` | 2026-08-11 的 batch1 和拼贴 v4 交接，原记录称其合入 `3.1.6.3`，未带入 `zzz_full_dump.sql` |
