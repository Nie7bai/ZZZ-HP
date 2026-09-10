# 招式库 / 准备阶段 / 流程 · 改造方案

> **状态（2026-08-16）**：计算页三层骨架**已落地**（招式库 → 准备 → 流程）。下文保留改造草案；与现网不一致处以文首「与实现核对」及 [`CALCULATOR_FORMULAS.md`](./CALCULATOR_FORMULAS.md) §7 为准。  
> 范围：ZZZ-HP 伤害计算页面。留言板/社区等不动。  
> 更远期录入/UI：[`future-roadmap.md`](./future-roadmap.md)。

**术语（用户口径，全文统一）**

| 词 | 含义 | 旧名 |
|----|------|------|
| **招式** | 伤害定义：伤害类型 + 招式类型 + 增益锚点 + 倍率% | — |
| **招式类型** | 普攻类、追加攻击类…（多选） | 招式大类 |
| **增益锚点** | 给「专门加强某一招」的 Buff 当识别标记（至多一个） | 招式小类 |
| **准备阶段** | 方案里每人一块 UI：从招式库按需加入、选代理人、可改数值 | — |
| **流程** | 方案里每人一块 UI：编排次数、失衡 | 伤害事件列表 |

**招式类型与增益锚点互不干涉，没有从属关系。**

### 技能组（2026-09）

- 管理端：招式库面板内「技能组」子 Tab；成员小窗编序/次数/是否入流程；可引用招式或建组内私有招式（`ownerGroupId`，与普通新建同表单）；可删除组内新建招式。同一招式可多次加入；公共属性异常只露出角色同属性那条。
- 计算页：招式库可「新建招式 / 新建技能组」（自建组/组内新建只缓存在浏览器）；自建组详情用左右栏加成员（对齐管理端）；库与准备分区展示组；组详情内成员与普通招式同级；从组钻进招式详情关闭后回到组。
- 流程统计：技能组子段 hit id（`entryId#…`）会汇总进流程总伤 / 饼图。

---

## 与实现核对（2026-08-16）

### 三个「谁」——结算面板

| 角色 | 存哪 | 典型乘区 |
|------|------|----------|
| **招式持有者**（流程归属） | 该槽 / `hit.ownerAgentId` | 直伤面板；紊乱/乱流增伤与异常暴击（持有者侧） |
| **异常强度提供者** | `PreparedSkill.anomalyPowerAgentId` | 异常基础、持续时间；紊乱/乱流基础与补偿倍率所在面板 |
| **异常类触发者** | `PreparedSkill.triggerAgentId` | 属性异常/异放/耀变的增伤与倍率；全部异常类的减防/无视防御 |

代码备忘：`DamageCalcInput.triggerFinalPanel` = 强度提供者；`anomalyTriggerPanel` = 异常类触发者。页级 `triggerAnomalyAgentId` = 第一击强度提供者（历史命名）。

### 加入准备时的默认代理人

异常类：**强度提供者与触发者均默认 = 当前流程角色**（可改）。未选全则不出伤。

### 参与条件（不出伤 + 不展示倍率）

| 类型 | 条件 |
|------|------|
| 乱流 | 异常类触发者须为**风**；队伍须同时有风与非风 |
| 耀变 | 队伍有蕾米；招式在蕾米流程；异常类触发者须为**蕾米埃尔** |

提醒在卡片**行尾红字**，不塞进「倍率」格。招式库异常类：双代理人未齐 →「待选择」；触发者不合规 → `—` + 红字。

### 「倍率%」展示

有结算 → 最终倍率区 ×100（紊乱/乱流含时间×补偿）。计算过程仍列区小数，并拆「基础倍率 / 倍率区」。删除自定义招式用站内确认弹窗（白天主题可用）。

### 异常类招式的锚点（2026-09-11 补记）

§4.3「两者都留空」已成历史。现行规则：**招式类型留空、增益锚点保留**，
配套开关是 `appliesToAnomaly`（`BuffEffect.appliesToAnomaly === true` 才会作用到异常伤害）。
迁移侧 `eventToSkill` 会保留旧小类 id 作锚点，`resolvedHit` 再带上锚点所属大类产出匹配坐标。

---

# 第一部分：新架构

## 1. 要解决什么

旧系统把「招式是什么、打几次、失不失衡、谁的伤、双代理人、倍率覆写」全揉在 `DamageEvent` 里，再用**事件模式**打包成全局一份。结果是：

- 招式定义与编排无法分开，库一大就难选
- `ownerAgentId` 既做统计归属又参与结算面板
- 直伤/异常两套列表 + 整页失衡，和「每人一条循环」对不上
- **方案根本不保存事件**：事件只存在全局模式库里，换方案不换编排

拆成三层：**招式库（定义，全局）→ 准备阶段（本方案筛选与结算参数）→ 流程（编排）**。

## 2. 三层关系

```
招式库（全局，很多）
    │  用户按需点加入
    ▼
准备阶段（方案 · 当前角色）
    已加入的招式
      · 仍绑定招式库的 skillId
      · 异常类：选异常强度提供者、异常类触发者
      · 按需：改倍率、增伤等
    │  用户再按需点加入流程
    ▼
流程（方案 · 当前角色）
    次数、失衡、暴击模式、排序
```

- 准备阶段的意图是**筛选 + 填结算参数**，不是再发明一种招式。
- 没加入准备阶段的招式，流程里选不到，也不参与计算。
- 三人各一块准备阶段、一块流程，**结构完全相同**（为将来三条流程合并显示预留）。

## 3. 伤害类型（决定公式）

| 伤害类型 | 大类 | 旧 `DamageEvent.kind` |
|----------|------|----------------------|
| 直伤 | 直伤 | `direct` |
| 属性异常 | 异常类 | `anomaly` |
| 异放 | 异常类 | `anomalyRelease` |
| 紊乱 | 异常类 | `disorder` |
| 乱流 | 异常类 | `turbulence` |
| 耀变 | 异常类 | `radiance` |

一条招式**只有一个**伤害类型。

## 4. 招式类型（多选）与增益锚点（唯一）

```
招式「仪玄·凝云术」
  伤害类型  直伤                 ← 唯一，决定公式
  招式类型  [强化特殊技]          ← 多选，决定 Buff 能否套上
  增益锚点  yixuan-special-…     ← 至多一个，可不选
  名称      用户自定义            ← 与增益锚点无关
  基础倍率  …
```

### 4.1 招式类型清单（扁平展示）

普攻 / 闪避 / 冲刺攻击 / 闪避反击 / 支援 / 特殊技 / 普通特殊技 / 强化特殊技 / 连携 / 终结 / 追加攻击 / 无

- 旧「特殊技」拆成 **普通特殊技 / 强化特殊技**。
- 旧 3 条**公共**小类（冲刺攻击 / 闪避反击 / 强化特殊技）提升为类型——它们跨角色、不指某一招，本就是类型。
- **追加攻击**是类型，只是并非每个角色都有。取代 `countsAsFollowUp` + `FollowUpSkillRule` 两套特判。
- **无**：确实存在没有类型的招式。

蕴含关系（勾子项自动满足父项，避免手动勾两遍）：

```
冲刺攻击 ⊃ 闪避        强化特殊技 ⊃ 特殊技
闪避反击 ⊃ 闪避        普通特殊技 ⊃ 特殊技
```

### 4.2 增益锚点

- 作用**只有一个**：让限定到具体某招的 Buff 认出这条招式。不影响公式、不影响统计。
- 沿用旧 `subcategoryId` 作 id。
- **只能选该角色自己的锚点**（招式跟着角色走）。
- **可以不选**。用户自建招式起什么名都行，名称与锚点无关。
- 它长得像游戏里的真实招名，但工具里不拿它当招式名用。

**锚点是因 Buff 而生的**：管理员配某条 Buff 时发现要限定到某一招，就在 Buff 编辑器里当场新建这个锚点（`createSubcategory`：填角色、名字，直接存库）。这解释了为什么 89 条锚点的倍率字段全是默认值——建的时候根本不关心倍率。

### 4.3 异常类招式

**招式类型留空。**（2026-08-16 起：**增益锚点保留**，不再留空 —— 见下方说明。）  
公共异常没有招式名的概念。

锚点保留的原因：异常伤害的「招式限定 Buff」由 `appliesToAnomaly` 开关决定是否生效
（`buffEffect.shouldApplyEffect`：`scope=skill` 且 `damageKind=anomaly` 时须 `appliesToAnomaly === true`），
而这类 Buff 要先靠锚点认出招式。若迁移时把锚点丢掉，管理员为异常伤害配的招式限定增益永远无法命中
（后端脚本 `zzz-hp-backend/scripts/fix-skill-anomaly-applies.mjs` 正是在给固有异常乘区补该标记）。
`skillTypes` 仍为空：异常伤害不吃「按招式类型」的限定。

## 5. 三个「谁」

旧 `ownerAgentId` 既统计又结算，这是拆分点。**现网乘区归属见文首「与实现核对」。**

| | 放哪 | 作用 |
|--|------|------|
| **归属者** | 该条流程所属角色 | 直伤：用该角色面板结算并计入其统计；异常类统计归属 |
| **异常强度提供者** | 准备阶段该条招式，存 **agentId** | 异常基础、持续时间；紊乱/乱流基础倍率面板等 |
| **异常类触发者** | 准备阶段该条招式，存 **agentId** | 属性异常/异放/耀变增伤与倍率；减防/无视防御 |

- 由用户在**准备阶段手选**，从队伍 3 人中选，**选择结果存进方案**。
- 直伤不需要选这两人。
- 公共招式进了朱鸢的准备/流程 → 统计算朱鸢。

### 默认值（只是加入准备阶段时的初值，不写死）

| 伤害类型 | 异常强度提供者 | 异常类触发者 |
|----------|----------------|--------------|
| 全部异常类（属性异常/异放/紊乱/乱流/耀变） | 默认 = **招式持有者** | 默认 = **招式持有者** |

**留空则不能计算**，直到用户选好。预填的默认值用户仍可改。  
乱流另要求触发者为风；耀变另要求触发者为蕾米（见文首表）。

### 选人存 agentId，不存槽下标

- 可选范围 = 当前队伍三人。
- 队伍换掉某人：已存的 agentId 若不在新队伍里 → 视为留空，不能算。不会自动改成新角色。

## 6. 数据结构

```
Scheme（方案）
  teamSlots / panel / buffs / …     现有，不动
  slots: SchemeSlot[3]              按下标对齐 teamSlots

SchemeSlot
  prepared: PreparedSkill[]
  flow: FlowEntry[]

PreparedSkill                仅代码名；用户仍叫「招式」
  id                         本方案内实例 id
  skillId                    绑定招式库
  skillSource                'preset' | 'custom'
  anomalyPowerAgentId?       异常强度提供者
  triggerAgentId?            异常类触发者
  extraMods?                 稀疏增量，如 { dmgBonus: 60 }

FlowEntry
  ownerAgentId               该流程角色，为三流程合并预留
  preparedId                 指向准备阶段那一条
  count
  stagger                    是否失衡期
  critMode                   expected | noCrit | fullCrit

Skill（招式库）
  id, name
  visibility                 public | agentId
  source                     preset | custom
  damageType                 一条只有一个
  skillTypes: []             多选；异常类留空
  buffAnchorId?              至多一个，沿用旧 subcategoryId；异常类亦**保留**（见 §4.3）
  baseMult
  settlementMult?            仅直伤可选
```

`slots` **按下标对齐 `teamSlots`**，不另存 agentId，避免换人后两处对不上。（这与「选人存 agentId」不冲突：那是指代理人字段。）

结算读招式库定义 + extraMods。管理员改预设且用户未覆写 → 方案跟着新预设。**不**把整份招式定义抄进方案。

## 7. 浏览器存储

方案已在 localStorage（约 5MB）。体积主要在面板快照 / Buff，不在招式编排。

准备阶段只存 skillId + 两个 agentId + 稀疏 extraMods，比现在整条 `DamageEvent` 更轻或持平。自定义招式全局一份，不按方案复制。

禁止：每条准备备份整份招式；extraMods 写成整块面板。

## 8. 招式被删

准备阶段条目只绑 `skillId`，库里那条没了则悬空。

- 不自动删准备阶段/流程里的条目。
- 该条标记「招式已删除」，**不参与结算**。
- 删自定义招式前扫本地方案，有引用则确认。
- 管理员删预设拦不到用户方案，靠标记 + 跳过结算。
- 从准备阶段移除一条时，同步去掉该角色流程里指向它的条目。

---

# 第二部分：影响面（阶段性改造的边界）

## 9. 会不会动数据库？—— 现有数据一行都不用改

**结论：只新增一张招式库表/JSON 节点，现有 DB 数据零改动。**

关键做法：**不改 Buff 数据，改匹配方式**。

现在 Buff 匹配靠 `SkillCalcContext { categoryId, subcategoryId, isFollowUp }`（都是单值）。新招式有多个类型 + 一个锚点，所以适配层把一条招式翻译成**一组旧坐标**，Buff 命中任意一个即生效：

| 新招式类型 | 等价旧坐标 |
|-----------|-----------|
| 普攻 | `basic` |
| 闪避 | `dodge` |
| 冲刺攻击 | `dodge` + 公共锚点 `all-dodge-ms0dnpmr` |
| 闪避反击 | `dodge` + 公共锚点 `all-dodge-ms4e5xea` |
| 支援 | `assist` |
| 特殊技 | `special` |
| 强化特殊技 | `special` + 公共锚点 `all-special-ms0fcqv7` |
| 连携 | `chain` |
| 终结 | `ultimate` |
| 追加攻击 | `isFollowUp = true` |
| （增益锚点） | 该锚点 id |

于是：

| DB 对象 | 处理 |
|---------|------|
| Buff 的 `skillTargets`（430 条限定） | **不动** |
| `skill_subcategories`（89 条） | **不动**。3 条公共的成为 3 个类型的内部 id，仍留表里 |
| `followUpSkillRules`（5 条）/ `countsAsFollowUp`（6 条） | **不动**。只在起草预设招式时读一次，计算时不再调用 `resolveIsFollowUp` |
| `damageEventModes`（旧事件模式预设） | **不删，停用**（前端不再读），便于回滚 |
| **招式库** | **新增**表 / JSON 新节点 |

代码代价：`buffEffect.ts` 的 `SkillCalcContext` 从单值改成集合，`skillTargetMatchesContext` 改成集合匹配。几十行。

> 若将来想彻底清理（把 3 条公共锚点真正提升成类型、重映射那 112 条限定），可作为**后续独立阶段**，本次不做。

## 10. 受影响的文件（共 19 个引用 `DamageEvent`）

### A. 核心，你预期内

| 文件 | 改什么 |
|------|--------|
| `types/calculator.ts` | 新类型；`DamageEvent` 保留待废 |
| `utils/damageEvent.ts` | 事件工具 → 流程工具 |
| `components/calculator/PanelCalcSection.vue` | 计算页主体 |
| `components/calculator/DamageEventEditor.vue` | → 准备阶段 + 流程 UI |
| `components/calculator/DamageEventModeModal.vue` | → 招式库选择器 |
| `components/calculator/DamageCalcPage.vue` | 页面容器接线 |
| `utils/customDamageEventModes.ts` | 旧全局模式，迁移后停用 |
| `utils/damageCalcHistory.ts` / `types/damageCalcHistory.ts` | 方案库存盘 + 版本升级 |

### B. 躲不掉，但可能超出你预期

| 文件 | 为什么 |
|------|--------|
| `utils/optimalAffixAlloc.ts`（1700+ 行） | 整套建在 `DamageEvent[]` 上 |
| `components/calculator/OptimalAffixAllocSection.vue` | 同上 |
| `utils/buffEffect.ts` | 匹配上下文改集合（§9） |
| `utils/extraBuffCalc.ts` | 构造 `SkillCalcContext` |
| `utils/damageEventOwner.ts` | 归属者 / teamKey |
| `utils/remielUtils.ts` | 耀变/蕾米埃尔资格判断 |
| `stores/calculatorBuffs.ts` | 数据归一化 |

### C. 管理端，可后置

`AdminDamageEventPanel.vue`（事件模式 → 招式库）、`AdminBuffEffectEditor.vue`（限定项二级联动 → 类型/锚点二选一）、`AdminSkillSubcategoryPanel.vue`（小类管理 → 增益锚点管理）、`AdminCalculatorLayout.vue`、`api/calculatorBuffs.ts`。

### D. 不受影响

`affixPanelCalc.ts`（局外/词条模式不经事件）、`panelBuffCalc.computeFinalPanel`（只是被调用）、`damageCalc.ts` 公式本身、以及留言板/社区/账号等全部非计算器模块。

## 11. 会改变现有计算结果的地方（需你确认）

改造不是纯重构，以下几处**算出来的数会变**：

1. **异常公式去掉主 C 乘区**，改取异常类触发者 / 强度提供者分角色（见文首核对与 `CALCULATOR_FORMULAS.md` §7）。（§5.1 旧代码里异放/耀变仍走 `mainCFinalPanel`）
2. **异常类不再吃招式限定 Buff**（无锚点时）。旧数据里 `skillBound=true` 的异放事件原本吃，改后不吃；有增益锚点时可再命中。
3. **修掉「不绑招式退化成 `basic`」**：旧代码关掉绑定后大类退化成 `basic`，导致限定「普攻整大类」的 Buff 仍命中异常伤害。改后不再命中，**异常伤害可能变低**。
4. **修掉「公共强化特殊技匹配不到角色专属招式」**：限定公共「强化特殊技」的 80 条 Buff 过去匹配不到「强化特殊技：凝云术」，改后能命中，**相关伤害可能变高**。
5. **留空的提供者/触发者直接不出伤**，不再静默按主 C 兜底。
6. **乱流 / 耀变参与条件收紧**：乱流触发者须风；耀变触发者须蕾米（旧「持有者/提供者/触发者之一为风」已废止）。
---

# 第三部分：改造实施

## 12. 旧概念对照

| 旧 | 新 |
|----|----|
| `SkillSubcategory`（89 条） | 3 条公共 → 招式类型；86 条角色 → **增益锚点**（id 不动） |
| `DamageEvent.kind` | 招式的**伤害类型** |
| `DamageEvent.categoryId` | 招式的**招式类型**（多选） |
| `DamageEvent.skillSubcategoryId` | `PreparedSkill.skillId`（招式），锚点另存在招式上 |
| `DamageEvent.count` / `staggerPhase` / `critMode` | `FlowEntry` |
| `DamageEvent.ownerAgentId` | 流程归属者 |
| `DamageEvent.triggerAgentId` | 准备阶段的两位代理人 |
| `DamageEvent.multOverrides` | `extraMods` |
| `DamageEvent.skillBound` | 取消。异常类招式类型留空即等效 |
| `DamageEventMode`（全局模式） | 招式库 + 每方案的准备阶段/流程 |
| 方案 `directEvents` / `anomalyEvents` | 仅 3.1.6.4 有；**未上线，不迁** |
| 页级 `damageKind` / `staggerPhase` | 不再当主交互（失衡在流程条目上） |

## 13. 招式库数据从哪来

实测（`zzz-hp-calculator-buffs.json`）：89 条小类的 `directDmgMult` 全是 100，`settlement/anomalyRelease/disorder` 全是 0。**一条真实倍率都没有**，倍率全来自事件里的 `multOverrides` 或面板回落。

→ 原「按倍率把小类拆成多条招式」的做法**作废，无倍率可拆**。

预设招式是**新建**的。86 条角色锚点天然对应 86 条预设直伤招式，名字里已带类型前缀（「冲刺攻击：冰渊潜袭」「强化特殊技：凝云术」），可据此脚本批量起草招式类型，再人工校对。

另需补一批**公共异常招式**：属性异常、异放、紊乱、乱流、耀变。类型与锚点均留空。

用户自定义招式：新 localStorage 键（如 `zzz-hp-skill-library-custom`），与旧模式库分开。

## 14. 迁移：全局事件模式 → 每方案的准备阶段 + 流程

### 现状

```
localStorage: zzz-hp-custom-damage-event-modes   （全局一份）
DamageEventMode {
  id, agentId, teamKey, name,
  modeType: 'direct' | 'anomaly',
  events: DamageEvent[]
}
```

**方案里没有事件。** 现网方案只存队伍、面板、Buff 勾选，编排完全来自全局模式库——这正是要修的问题。

### 为什么方案不能靠猜（已确认）

`DamageCalcPage.vue` 切方案时主动把 `directEventModeId` / `anomalyEventModeId` 清成 `null`（否则弹窗的 `watch(events, deep)` 会按旧 modeId 把当前事件写回全局库、覆盖同名模式）。**「选中哪套」只是页面临时状态，从不落盘。**

而且 `persistCurrentCustom` 挂在深度 watch 上——改一下次数就写回全局库，自定义模式本身就是实时编辑缓冲区。

`DamageEventMode` 也没有时间字段（id 里的时间戳只是创建时刻，编辑不更新），数组顺序 = 创建顺序。

**结论：没有任何信号能还原「这个方案当时用的是哪套模式」。不要猜。**

### 定案：全局 → 全局，方案一个字不动

**旧的全局事件模式库 → 新的全局自定义招式库。一条旧事件 = 一条自定义招式。**

- 流程**统一留空**（用户已选此策略），因此迁移**不产出准备阶段数据**，招式↔准备阶段的依赖链问题不存在。
- 不匹配 teamKey、不遍历方案、不往方案写任何东西 → 原方案里最易出错的部分直接消失。
- 用户打开旧方案：准备阶段与流程为空，但招式库里已有他全部的自定义招式（按角色分好），自己加入再排即可。

### 单条事件 → 一条自定义招式

| 旧字段 | 去处 |
|--------|------|
| `kind` | `damageType` |
| `categoryId` | `skillTypes`（异常类丢弃，留空） |
| `skillSubcategoryId` | `buffAnchorId`（异常类留空） |
| **`multOverrides`** | **`baseMult`**（按 `kind` 取对应字段） |
| `ownerAgentId` ?? `mode.agentId` | `visibility`（这条招式归谁） |
| `count` / `staggerPhase` / `critMode` | **丢弃**（编排信息） |
| `triggerAgentId` / `skillBound` / `teamKey` / `modeType` | **丢弃** |

**`multOverrides` 这行是重点**：旧锚点不存倍率，用户手填的倍率全在这里，转成招式基础倍率才不丢数据。

字段一一对应，无歧义（一条事件只有一个 `kind`）：

| `kind` | 取 `multOverrides` 的 |
|--------|----------------------|
| `direct` | `directDmgMult`（+ `settlementDmgMult`、`directDmgMultFactor`） |
| `anomaly` | `anomalyMult`（+ Factor） |
| `anomalyRelease` | `anomalyReleaseMult`（+ Factor） |
| `disorder` | `disorderBaseMult`（+ Factor、`disorderCompMult`） |
| `turbulence` | `turbulenceBaseMult`（+ Factor、`turbulenceCompMult`） |
| `radiance` | `radianceMult`（+ Factor） |

取不到（为 null）则用招式默认值。

### 去重与命名

招式条数可能膨胀（20 套 × 5 条 = 100 条），必须去重。

- **去重键**：`visibility + damageType + buffAnchorId + baseMult + settlementMult + skillTypes`，全同则合并为一条。
- **命名**：优先用锚点名（「强化特殊技：凝云术」）；异常类用伤害类型名（「紊乱」）；同名但参数不同时追加模式名或序号。

### 收尾

1. 打一次性迁移标记（**不复用** `customEventsMigrated`）。
2. 旧全局模式库 `zzz-hp-custom-damage-event-modes` **保留只读**，不删，便于回滚与人工查对。
3. 3.1.6.4 的 `directEvents` / `anomalyEvents`：当不存在。旧函数 `migrateLegacyGlobalEvents` **删除**。

### 代价（已接受）

次数、失衡、暴击模式、代理人选择全部丢失，用户需在新界面重排一次。换来的是迁移零风险、不会算出虚高伤害。

## 15. 结算接线

`computeDamageResult` / `summarizeDamageEvents` 保留。加适配层：

```
准备阶段 + 流程
   → 展开成【结算条目列表】ResolvedHit[]
        招式定义 + extraMods + 两位代理人 + 次数 + 失衡 + 暴击模式
   → 伤害计算       （computeDamageResult，按 ownerAgentId 汇总）
   → 最优词条分配    （吃同一份列表）
```

**伤害计算与最优词条分配必须吃同一份 `ResolvedHit[]`。**

现状隐患：`optimalAffixAlloc.ts` 与 `PanelCalcSection.vue` 各自遍历事件、各自组装计算输入（两处都有一份 skillBound / resolveIsFollowUp / overrides 合并逻辑）。只接一边，准备阶段的倍率修改和流程的次数失衡就会漏进最优词条，两边结果不一致且极难发现。

产品口径：**伤害计算结果是唯一正确的，最优词条分配建立在它之上。** 靠共用列表在结构上保证。

其他：`bonusPanel` / 异放倍率取异常类触发者；异常基础取强度提供者；留空的提供者/触发者直接 skip；乱流/耀变触发者资格见文首；乘区对表核对 `CALCULATOR_FORMULAS.md` + `damageCalc.ts`。

## 16. 实施顺序

> 下列为改造当时的计划序；**1–6 主体已在 `3.1.6.3` / `3.1.6.4` 落地**，管理端锚点录入等仍见 `future-roadmap.md`。

1. 类型与空存盘；`SchemeStore.version` 2→3，导出包同步；导入旧包走同一迁移。
2. `buffEffect.ts` 匹配改集合（§9 等价坐标表）——先做这步，老功能不受影响可单独验证。
3. 招式库数据：预设直伤招式 + 公共异常招式。
4. 适配层 `ResolvedHit[]`；异常公式去掉主 C。
5. 接最优词条分配到同一份列表。
6. 计算页 UI：招式库 / 准备阶段 / 流程（**功能完整优先，UI 细节后调**）。
7. 迁移脚本（§14，全局 → 全局，不碰方案）。
8. 管理端招式库；旧事件模式入口关掉。
9. 删 `migrateLegacyGlobalEvents`、`resolveIsFollowUp` 调用点。

## 17. 已确认 / 待确认

已确认：

1. 迁移走「全局 → 全局」，流程统一留空（§14）。
2. §11 五处结果变化**全部符合预期**，照此改。
3. `extraMods` 加算，**优先级低**，先预留字段与接线口子，UI 后议。

待确认：暂无。开工前若无新问题，按 §16 顺序实施。

## 18. 明确不做

- 不改留言板/社区/账号。
- 不改任何现有 DB 数据（Buff 限定、小类、追加规则一律不动）。
- 不把招式全文快照进每个方案（除非迁移对不上 id 的一次性兜底）。
- 不把准备阶段做成「不落盘的临时调试」。
- 三条流程不做成不同数据结构。
- 不为未上线的 3.1.6.4 方案内事件再写一遍拆分。
