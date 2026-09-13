# 最优分配页内嵌主属性组合排行

## 要做什么

在「词条配比分析 · 最优分配」页，于「全词条收益」与「最优分配」之间增加同级独立模块「主属性组合试算」：固定零副词条基线，只替换 4/5/6 主属性与 2 件套做试算排行。

## 怎么做

- 不改 `solveOptimalAffixAllocationAsync`、收益表求解、扫掠柱图模板与求解逻辑。
- 扫掠柱图内原有组合试算模块保持原位、原口径（`analysisCounts`）。
- 分配页独立模块基线 = `affixAllocBaseCounts`（与全词条收益同口径）；`evaluateMainStatComboDamage` 不注入分配求解的 `valuePerCount`/`panelDeltas`（走 `evalCtx` 既有词条库表）。

## 预期收益

无需先求最优分配，即可在分配页对比主属性/2 件套组合。

## 风险与验收

- 验收：页面顺序为 全词条收益 → 主属性组合试算 → 最优分配；扫掠柱图原模块不变；`vue-tsc` 通过。

## 实际结果

- 分支：`feature/embed-main-stat-combo-in-allocation`
- 位置已按用户标注调整为同级模块（不在最优分配结果区内）。
