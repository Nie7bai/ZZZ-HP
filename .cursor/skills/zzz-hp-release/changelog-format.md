# seed_changelog 条目格式

文件：[zzz-hp-backend/scripts/seed_changelog.mjs](../../zzz-hp-backend/scripts/seed_changelog.mjs)

## content 变量模板

```javascript
const content318 = `相对 3.1.7 的增量更新（一句话主题）：

· 要点一
· 要点二
· 要点三`
```

惯例：

- 首行：`相对 {上一版} 的增量更新（{主题}）：`
- 条目用 `·` 开头，每条一行
- 语气与既有条目一致，写用户可见变化，不写内部 refactor 细节

## INSERT 字段

| 字段 | 说明 |
|------|------|
| `version` | 与 package.json 一致，如 `3.1.8` |
| `title` | 短标题，显示在更新日志列表 |
| `content` | 上文的 `content318` 变量 |
| `published_at` | `YYYY-MM-DD HH:mm:ss`，发版时间 |

## 批量维护模式（当前脚本）

较新版本使用：

1. `DELETE FROM changelog WHERE version IN (...)` — 列出要重写的版本
2. 多行 `INSERT INTO changelog ... VALUES (?,?,?,?), ...` — 一次写入多版

新增版本时：扩展 `DELETE` 的 IN 列表，并在 `INSERT` 末尾加一组四个占位符与对应参数。

## 验证

本地有 DB 时可运行 seed 脚本核对写入（需 `.env` 数据库配置）。发版 PR 至少人工 diff 检查 SQL 参数与 version 字符串一致。
