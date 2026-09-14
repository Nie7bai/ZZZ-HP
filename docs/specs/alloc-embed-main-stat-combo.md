# 最优分配页内嵌主属性组合排行

## 要做什么

在「词条配比分析 · 词条分析」页，于「全词条收益」与「最优分配」之间增加同级独立模块「主属性组合试算」。

## 怎么做

- 不改 `solveOptimalAffixAllocationAsync`、收益表求解、扫掠柱图模板与求解逻辑。
- 扫掠柱图内原有组合试算模块保持原位（清基准重推）。
- **有导入面板时（词条分析页）**：以页级局外为底，撤掉当前 4/5/6 + 2 件套效果再加试算组合（`remapImportedPanelViaEffects`）；当前主属性须与面板一致。字段加减 `remapImportedExternalPanelForMainCombo` 只作测试对照。
- **无导入面板时**：回退配置推导（`mainBaseExternalPanel: null`）。

## 预期收益

组合试算接到面板导入数字，换主属性/2 件套时保留面板里其余副词条等已含部分。

## 风险与验收

- 当前 4/5/6 填错会少扣/多扣。
- 验收：有面板时提示「已接导入面板」；换 4 号爆伤→暴击时爆伤/暴击字段按表变化；扫掠路径不变；`vue-tsc` + remap 单测通过。

## 实际结果

- 分支：`feature/embed-main-stat-combo-in-allocation`
- `remapImportedPanelViaEffects` + 词条分析页 `evaluateMainStatComboDamage` 有面板时走撤/加效果；扫掠仍清基准。`remapImportedExternalPanelForMainCombo` 仅测试对照。
- 词条分析页组合试算伤差一律用 `grandTotal`（不绑扫掠柱图事件勾选）；避免未跑扫掠时出现「未选择统计事件 / 0→0」。
- 证据：`npx vite-node scripts/test-remap-imported-panel-main-combo.mjs` → ok；`npm run type-check` → ok（2026-09-14）。
