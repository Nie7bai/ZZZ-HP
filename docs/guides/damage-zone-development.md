# 新建乘区与增益属性的开发规范

## 1. 提需求时必须提供的信息

1. **名字和归属。** 新增乘区须确认乘区中文名、每个增益属性的下拉名、伤害详情显示名。一个乘区可以接收多个属性，逐个确认归属。单独给已有乘区新增属性时，提供新属性名和它归属的乘区。英文内部标识由实现者拟定。
2. **单位和算法。** 说明填 `20` 代表什么，多条同类效果怎么合并，不同属性怎样计入同一个区，以及没有有效效果时的倍率。可以给公式，或给一个能算出结果的例子。

在每条 Buff 中设置适用伤害和受益对象。普通独立乘区可以参与所有伤害公式。没有伤害类型限制的有效 Buff 对直伤、异常、耀变等都能生效。固定限制或专用算法在提需求时单独说明。

例如，乘区「最终伤害」接收百分比属性「最终伤害比例」，伤害详情显示「最终伤害区」。同区两条有效 Buff 分别为 20% 和 10% 时，乘区倍率为 1.30。没有有效 Buff 时为 1。

## 2. 新增普通的独立乘区

管理端「角色计算器 → 乘区方案」用于查看定义和方案。配置通过管理 API 维护。调用时携带 `X-Admin-Token`，使用目标环境的 `POST /api/admin/login` 返回的 `data.token`。写请求使用 `Content-Type: application/json`。[管理 API 路由](../../zzz-hp-backend/src/routes/calculatorZoneRoutes.js)

1. 用 `GET /api/admin/calculator/zone-definitions` 核对现有乘区键和定义中的属性键，用 `GET /api/admin/calculator/zone-schemes?scope=global` 读取现有全局方案。以下用已有的最终伤害作示例。新增时使用本次确认的名字和未占用的键。

2. 用 `POST /api/admin/calculator/zone-definitions` 保存启用的定义。普通独立乘区使用 `percentSum`，没有来源限制时使用 `providers: all`。以下请求体包含定义名和 Buff 下拉名。

   ```json
   {
     "zoneKey": "custom:finalDamage",
     "label": "最终伤害",
     "primitive": "percentSum",
     "providers": "all",
     "enabled": true,
     "stats": [{"key":"finalDamageRatio","label":"最终伤害比例","valueType":"percent","sign":"both"}]
   }
   ```

3. 把规则加入启用的全局方案。规则的 `label` 是详情显示名，`params.statKeys` 使用定义里的属性键。

   ```json
   {"key":"custom:finalDamage","action":"replace","module":"percentSum","label":"最终伤害区","params":{"statKeys":["finalDamageRatio"]}}
   ```

   - 已有全局方案时，调用 `PUT /api/admin/calculator/zone-schemes/:id`，将 `:id` 换成读回的方案 ID。保存会整体替换规则，提交时保留 `scope`、`targetId`、`name`、`priority`、`enabled` 和原有规则，再追加新规则。已有同键规则时在原位置更新。
   - 库里没有全局方案时，调用 `POST /api/admin/calculator/zone-schemes`。请求体使用 `scope` 为 `global`、`targetId` 为空字符串、`name` 为方案名称、`enabled` 为 `true`、`rules` 为规则数组。

4. 用管理 API 读回定义和方案，核对两者均启用且规则完整。刷新计算器，在 Buff 条目中选择属性，填写百分比和适用条件。生效的独立乘区各参与一次连乘，在详情各占一项。

给已有的普通独立乘区新增百分比属性时，先确认属性归属，再读回原定义和方案。在定义的 `stats` 和规则的 `params.statKeys` 各追加一项，保留其余配置。更新定义或方案时省略 `version`，由服务端递增。

需要随版本发布时，将定义和方案规则登记在[计算器发布配置](../../zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json)的 `zoneDefinitions` 和 `zoneSchemes` 中。烬痕、最终伤害和一布之力的正式配置可在这里对照。[加载与验收示例](../../zzz-hp/scripts/test-zone-custom-e2e.mjs)使用同一份数据。

## 3. 接入专用规则或扩展内置乘区

需要专用算法或组合展示时，按该乘区的专用规则处理。给已有乘区加字段时，先确认属性属于哪个区，再接入该区的算法。

「烬痕」使用 `scaledPercentSum`。两组属性都登记在定义的 `stats` 中，方案用 `params.statKeys` 指定烬痕比例，用 `params.scalingStatKeys` 指定烬痕积攒量提升。结算分别加总两组百分比，按 `1 + 比例合计 × (1 + 积攒量提升合计)` 求值。比例 60%、积攒量提升 35% 时，伤害详情的「烬痕区」显示 `1 + 60% × (1 + 35%) = 1.81`。

1. 在 [calculator.ts](../../zzz-hp/src/types/calculator.ts) 和 [calculatorUi.ts](../../zzz-hp/src/utils/calculatorUi.ts) 登记新增的内置属性及默认值。同步前端 [buffEffect.ts](../../zzz-hp/src/utils/buffEffect.ts) 和后端 [calculatorBuffFields.js](../../zzz-hp-backend/src/utils/calculatorBuffFields.js) 的字段清单。Buff 条件匹配见[增益功能链路](../specs/buff-pipeline.md)。
2. 涉及面板字段时，在 [calculatorPanel.ts](../../zzz-hp/src/types/calculatorPanel.ts) 和 [panelBuffCalc.ts](../../zzz-hp/src/utils/panelBuffCalc.ts) 接入默认值及聚合。对应的专用公式和取值见[计算器公式核查表](../../CALCULATOR_FORMULAS.md)。
3. 在[乘区目录](../../zzz-hp/src/zones/catalog.ts)和[详情展示](../../zzz-hp/src/zones/display.ts)核对名称、实际倍率及来源。专用展示规则按该区实现。

## 4. 用算例验收

- 核对无有效 Buff 时为 1，同区加算、跨区连乘。将一条 Buff 限制到指定伤害类型，核对它只在匹配的伤害上生效。
- 对照直伤、决算、异常与本人耀变的实际伤害。详情里的每个普通独立乘区应单列名称和倍率，对得上本次结算。
- 确认配置可保存并在加载后识别，运行[项目要求的检查](../../AGENTS.md)。普通独立乘区重点核对[伤害路径和详情](../../zzz-hp/scripts/test-zone-custom-application.mjs)与[正式配置及 Buff 范围](../../zzz-hp/scripts/test-zone-custom-e2e.mjs)。
