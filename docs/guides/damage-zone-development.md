# 新建乘区与增益属性的开发规范

## 1. 提需求时必须提供的信息

1. **名字和归属。** 新增乘区须确认乘区中文名、每个增益属性的下拉名、伤害详情显示名。一个乘区可以接收多个属性，逐个确认归属。单独给已有乘区新增属性时，提供新属性名和它归属的乘区。英文内部标识由实现者拟定。
2. **单位和算法。** 说明填 `20` 代表什么，多条同类效果怎么合并，不同属性怎样计入同一个区，以及没有有效效果时的倍率。可以给公式，或给一个能算出结果的例子。

在每条 Buff 中设置适用伤害和受益对象。普通独立乘区可以参与所有伤害公式。没有伤害类型限制的有效 Buff 对直伤、异常、耀变等都能生效。固定限制或专用算法在提需求时单独说明。

例如，乘区「烬痕」接收百分比属性「烬痕比例」，伤害详情显示「烬痕区」。同区两条有效 Buff 分别为 20% 和 10% 时，乘区倍率为 1.30。没有有效 Buff 时为 1。

## 2. 新增普通的独立乘区

1. 在管理端「角色计算器 → 乘区方案 → 乘区定义」新增定义。填写 `custom:<内部键>` 和乘区中文名，原语选 `percentSum`。没有来源限制时，`providers` 选值为 `all` 的选项。填写 `stats` 数组，保存并启用定义。烬痕的 `stats` 如下。

   ```json
   [{"key":"emberMarkRatio","label":"烬痕比例","valueType":"percent","sign":"both"}]
   ```

2. 在乘区方案的 `rules` 数组中追加规则并保留原有规则。通用方案用「全局」作用域，目标留空。`key` 引用乘区定义，`params.statKeys` 填定义里的属性键，`label` 是详情名。保存并启用方案。烬痕的规则对象如下。

   ```json
   {"key":"custom:emberMark","action":"replace","module":"percentSum","label":"烬痕区","params":{"statKeys":["emberMarkRatio"]}}
   ```

3. 刷新计算器让它加载新方案，在 Buff 条目中选择属性，填写百分比和适用条件。每个独立乘区各参与一次连乘，在详情各占一项。各因子地位相同，配置顺序用于展示。

给已有的普通独立乘区新增百分比属性时，先确认属性归属，在该定义的 `stats` 和规则的 `params.statKeys` 各追加一项，沿用原乘区键和详情名。

需要随版本发布时，将定义和方案规则登记在[计算器发布配置](../../zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json)的 `zoneDefinitions` 和 `zoneSchemes` 中。烬痕、最终伤害和一布之力的正式配置可在这里对照。[加载与验收示例](../../zzz-hp/scripts/test-zone-custom-e2e.mjs)使用同一份数据。

## 3. 接入专用规则或扩展内置乘区

需要专用算法或组合展示时，按该乘区的专用规则处理。给已有乘区加字段时，先确认属性属于哪个区，再接入该区的算法。

1. 在 [calculator.ts](../../zzz-hp/src/types/calculator.ts) 和 [calculatorUi.ts](../../zzz-hp/src/utils/calculatorUi.ts) 登记新增的内置属性及默认值。同步前端 [buffEffect.ts](../../zzz-hp/src/utils/buffEffect.ts) 和后端 [calculatorBuffFields.js](../../zzz-hp-backend/src/utils/calculatorBuffFields.js) 的字段清单。Buff 条件匹配见[增益功能链路](../specs/buff-pipeline.md)。
2. 涉及面板字段时，在 [calculatorPanel.ts](../../zzz-hp/src/types/calculatorPanel.ts) 和 [panelBuffCalc.ts](../../zzz-hp/src/utils/panelBuffCalc.ts) 接入默认值及聚合。对应的专用公式和取值见[计算器公式核查表](../../CALCULATOR_FORMULAS.md)。
3. 在[乘区目录](../../zzz-hp/src/zones/catalog.ts)和[详情展示](../../zzz-hp/src/zones/display.ts)核对名称、实际倍率及来源。专用展示规则按该区实现。

## 4. 用算例验收

- 核对无有效 Buff 时为 1，同区加算、跨区连乘。将一条 Buff 限制到指定伤害类型，核对它只在匹配的伤害上生效。
- 对照直伤、决算、异常与本人耀变的实际伤害。详情里的每个普通独立乘区应单列名称和倍率，对得上本次结算。
- 确认配置可保存并在加载后识别，运行[项目要求的检查](../../AGENTS.md)。普通独立乘区重点核对[伤害路径和详情](../../zzz-hp/scripts/test-zone-custom-application.mjs)与[正式配置及 Buff 范围](../../zzz-hp/scripts/test-zone-custom-e2e.mjs)。
