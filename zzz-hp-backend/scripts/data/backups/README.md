# Calculator buff JSON backups

Timestamped full exports from local MySQL via `npm run export:calculator-buffs`.
`import-nanoka-skills.mjs --all --write` also copies the current seed JSON here before writing.

Restore (upsert, not replace by default):

```powershell
cd zzz-hp-backend
node scripts/import-calculator-buffs.mjs --file scripts/data/backups/<file>.json
```

Use `--replace` only when you intentionally want the DB to match the backup exactly.

Affix preset snapshots (not calculator buffs):

- `affix-preset.before-effect-json-20260914-200456.json` — 加 `effect_json` 列之前，可 `npm run restore:affix-preset`
- `affix-preset.after-t1-20260915.json` — T1 收口后（300 条均有 `effect_json`）
- `zzz-hp-db-full-20260915.json` — 当前整库 42 表（用户 2026-09-15：内容快照进 Gitee，含本机账号表）
- 当前库内容另见上一级 `affix-preset.export.json`（`npm run export:affix-preset`）
- 计算器 Buff 当前份：上一级 `zzz-hp-calculator-buffs.json`
- 环境 Buff 当前份：上一级 `buff.json`

Full-roster skill import (dry-run / write):

```powershell
npm run import:nanoka-skills:all
npm run import:nanoka-skills:all:write
```
