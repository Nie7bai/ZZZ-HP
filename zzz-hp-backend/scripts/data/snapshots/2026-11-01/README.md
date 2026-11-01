# 2026-11-01 数据快照

本目录为当日从**当前数据库**导出的 ASCII 快照副本，可直接用于管理端导入或脚本消费。

| 文件 | kind | 说明 |
|------|------|------|
| `zzz-hp-boss-info.json` | `zzz-hp-boss-info` | 怪物基础库（`boss_info`）155 条 |

## 怎么生成的

在 `zzz-hp-backend` 下：

```bash
npm run export:boss-info -- --file scripts/data/snapshots/2026-11-01/zzz-hp-boss-info.json
```

脚本直接调用 `src/utils/bossInfoSnapshot.js` 的 `exportBossInfoSnapshot()`，与管理端「怪物基础库 → 导入 / 导出」走同一份实现，
因此字段范围一致：场地 Buff 多套（`fieldBuffSets`）、弱点多套（`weaknessSets`）、失衡易伤 / 失衡时间、
高抗性、危局基础血量、异常条系数（`anomalyBarCoefficient`）都在。

## 校验

- 与所有者 2026-11-01 从管理端导出的同库文件逐行比对：**155 条、字段值完全一致**，仅 `exportedAt` 不同。
- 覆盖导入前请先在管理端导出一份当前库，导入是「先清空 `boss_info` 再写入」。

## 与上一份快照（2026-08-25，153 条）的差异

按 `id` 对齐：

- 新增 8 条：`「征服者」`、`以太异体·特里薇亚`、`库萨里库`、`异构·基塔布鲁·滞变畸兽`、`异构·焚昼余火`、`熔狱行赭`、`遴命者·「骇鸟」`、测试行 `fetch测试`
- 删除 6 条：`覆盖测试`、`覆盖测试2`、重复的裸名 `亵渎者`（同名的 `「亵渎者」` 仍在库中）、`初生死路屠夫`、`太初梦魇·始主`、`自律强袭单位·提丰·破坏者型`
- 无同 `id` 改名；其余行的差异来自数值 / 场地 Buff 调整

完整导入导出说明见仓库根目录：`json备份/导入导出说明.md`。
