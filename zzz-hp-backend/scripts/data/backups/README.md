# Calculator buff JSON backups

Timestamped full exports from local MySQL via `npm run export:calculator-buffs`.
`import-nanoka-skills.mjs --all --write` also copies the current seed JSON here before writing.

Restore (upsert, not replace by default):

```powershell
cd zzz-hp-backend
node scripts/import-calculator-buffs.mjs --file scripts/data/backups/<file>.json
```

Use `--replace` only when you intentionally want the DB to match the backup exactly.

Full-roster skill import (dry-run / write):

```powershell
npm run import:nanoka-skills:all
npm run import:nanoka-skills:all:write
```
