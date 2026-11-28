# 2026-11-28 数据快照

本目录为当日从**当前数据库**导出的 ASCII 快照副本，可直接用于管理端导入或脚本消费。

| 文件 | kind | 说明 |
|------|------|------|
| `zzz-hp-boss-info.json` | `zzz-hp-boss-info` | 怪物基础库（`boss_info`）155 条 |

## 怎么生成的

在 `zzz-hp-backend` 下：

```bash
npm run export:boss-info -- --file scripts/data/snapshots/2026-11-28/zzz-hp-boss-info.json
```

脚本调用 `src/utils/bossInfoSnapshot.js` 的 `exportBossInfoSnapshot()`，与管理端「怪物基础库 → 导入 / 导出」同一份实现。

## 与上一份快照（2026-11-01）的差异

- **新增两个字段**：`scoringNoteSets`（得分机制多套，`{id,label,name,text}[]`）与 `scoringNote`（第一套文本的镜像，老版本导入仍能读到文本）。
  2026-11-01 及更早的快照没有这两个字段——得分机制是在 2026-11-27 那一轮才加进 `boss_info` 的，
  导入导出一直没带上，这一版补齐（`bossInfoSnapshot.js` 的 SELECT / 导出行 / INSERT / UPDATE 都加了这两列）。
- 26 条怪物带得分机制，其中 3 套以上的是：`自律强袭单位·「提丰·破坏者型」`（4 套）、`恶名·死路屠夫`（3 套）、
  `霸主侵蚀体·庞培` / `恶名·庞培`（各 2 套）。其余 129 条没有得分机制文本。
- 除得分机制外，14 条怪物自 11-01 起有值变化：`weaknessSets` 12 条、`fieldBuffSets` / `fieldBuffEffectBlocks` 各 9 条、
  `staggerMultiplier` 4 条、`anomalyBarCoefficient` 3 条、`level` 2 条；行数仍为 155（无新增 / 删除）。

## 校验

- `kind=zzz-hp-boss-info`、`count=155`、279 KB。
- 与 2026-11-01 快照按 `bossName` 逐行对齐：除上面两个新字段与 14 条数值变化外，其余字段值完全一致。

## 还没覆盖的部分

得分机制的**期数绑定**（`boss.scoring_note_set_id`）在`赛季内容快照`里，本轮已让 `seasonSnapshotService` 的导出 / 导入带上该字段；
但仓库里没有对应的危局赛季内容快照文件（最近一份是 2026-08-25），需要时从管理端「危局 → 导入 / 导出」现导一份。
