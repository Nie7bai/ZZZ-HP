# 最优分配内嵌主属性组合排行

## 要做什么

在「词条配比分析 · 最优分配」求解结果下方，嵌入与扫掠柱图相同的「限定组合计算范围 / 组合排行」模块：固定分配得到的副词条条数，只替换 4/5/6 主属性与 2 件套做试算排行。

## 怎么做

- 不改 `solveOptimalAffixAllocationAsync`、收益表、扫掠柱图模板与求解逻辑。
- 组合试算在分配模式下改用 `affixAllocResult.counts`，并传入同次求解的 `panelDeltas` / `valuePerCount`，避免与分配器口径分叉。
- 扫掠模式仍用原 `analysisCounts`；`evaluateMainStatComboDamage` 仅在分配模式附带上述字段。

## 预期收益

最优分配完成后可直接对比主属性/2 件套组合，无需切到扫掠柱图。

## 风险与验收

- 风险：漏传 `valuePerCount` 会导致试算与分配总伤对不上。
- 验收：分配求解后出现组合试算与限定组合 UI；扫掠柱图原模块行为不变；`vue-tsc` 通过。

## 实际结果

- 分支：`feature/embed-main-stat-combo-in-allocation`
- 改动：`OptimalAffixAllocSection.vue`（分配结果下嵌入组合试算/限定排行；`comboBaselineCounts` + 分配态传入 `valuePerCount`/`panelDeltas`）；扫掠柱图模板未改展示结构
- 证据：`cd zzz-hp && npm run type-check` → exit 0
