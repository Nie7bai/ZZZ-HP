# 统一效果计算架构（施工指针）

权威施工手册在开发目录，不进 git：`D:\WB_agent_out\ZZZ-HP\dev-docs\unified-effect-pipeline.md`。方案正文同目录 `统一效果计算架构改造方案.md`。

## 要做什么

把局外词条、战斗增益、条件增益和转模统一为 Effect 模型与单一执行管线。不改伤害公式、双代理人、蕾米本人耀变规则、方案存盘或求解搜索算法。

## 怎么做

特征测试锁定现状 → 适配器 → 新旧双跑 → 分源迁移 → 切换删旧链。当前完成阶段 0（手册 + 本机数值/耗时基线）。

## 预期收益

去掉词条库三族分流和扁平增量表双算；可表达「普攻 +15%」；导入面板换主属性收进同一套效果撤换。

## 风险与验收

双跑以修补后的穿透/增伤为基线（+24 穿透 → 局内 24）。性能以 2026-09-14 本机 `scheme-dan` 为准：30 词条求解中位数 833 ms，收益表首屏 62 ms。细节与批准差异表见开发目录手册。

## 实际结果（阶段 0）

- 分支：`feature/unified-effect-pipeline`（基线 `9a9c8f1`）
- `npx vite-node scripts/test-affix-gain-target.mjs` → 32 passed
- `npx vite-node scripts/test-remap-imported-panel-main-combo.mjs` → ok
- `npx vite-node scripts/bench-solve.mjs`（scheme-dan，30 档 × 5 轮）→ 中位数 833 ms，总伤 58839464
