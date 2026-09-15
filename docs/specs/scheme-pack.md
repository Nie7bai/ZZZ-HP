# 方案包：自包含导出 + 覆盖 / 合并导入

> **范围**：计算页方案库 JSON（`DamageCalcHistorySection`）。不改结算、不改进度里的词条库/主题、不把预设组写入 MySQL。
> **代码**：`zzz-hp/src/utils/schemePack.ts`（指纹、收集引用、改写、并入），`zzz-hp/src/utils/damageCalcHistory.ts`（localStorage IO），页面按钮在 `DamageCalcHistorySection.vue`。
> **测试**：`zzz-hp/scripts/test-scheme-pack-merge.mjs`（挂在 `npm test`）。

## 要做什么

方案 JSON 必须能把用到的自建招式和技能组带走；覆盖导入要连自建组库一起换成文件里的；另提供合并导入，合并不丢任何一方多出来的东西。

## 怎么做

1. **导出**：`customSkills` = 本机自建招式库全文；`skillGroups` = 自建组库全文 ∪ 方案引用到的组文档（预设组抄一份）。官方招式不进包。扫不到的引用写入 `warnings`，方案仍导出。
2. **覆盖导入**：核弹。方案库、自建招式、自建组库、工作草稿整包替换。包内组若本机预设已有同 id，不写自建库。id 不换号。
3. **合并导入**：不删本机。同路径目录并成一个文件夹（本机 `order` 不动）。方案重名则进来的改成「原名-复制」。招式/组按内容指纹认人，隐藏 id 冲突则换号并改写引用。

## 预期收益

别人导出的方案打开后不再「技能组已删除」；覆盖不再留下旧组、漏写新组；两份方案库能加在一起且不丢任一方。

## 风险与验收

- 旧包没有 `skillGroups`：覆盖仍可用，自建组库不动，组对不上继续「技能组已删除」。
- 官方招式仍不进包（已知缺口）。
- 验收见同目录测试脚本：导出带被引用预设组、warnings、覆盖组库、合并改名/换号/再合不复制、目录 order。

## 明确不做

- 不把同路径两份方案做成字段级三路合并。
- 不改准备同名闸、不改招式中文名、不改结算。
- 不删覆盖导入。词条库、主题不进包。

## 实际结果

- `npx vue-tsc --noEmit -p tsconfig.app.json`：退出码 0
- `npx eslint src scripts`：退出码 0
- `npx vite-node scripts/test-scheme-pack-merge.mjs`：all passed（含导出预设组、warnings、覆盖组库、合并改名/换号/再合不复制、目录 order、旧包无 skillGroups）
- `npx vite-node scripts/test-damage-calc-history-stats.mjs`：全部通过
- 未启停 dev server；方案库「合并导入」按钮未在浏览器里点过，逻辑由脚本覆盖

已知缺口：官方招式仍不进包。
