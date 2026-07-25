---
name: release-version
description: Cut a new ZZZ-HP release. Use when the user asks to 发版 / 打版本 / release / bump version / 打 tag for this repo, e.g. "发个 3.0.10". Bumps front+back package.json, type-checks, builds, updates changelog, commits, tags, and pushes.
---

# ZZZ-HP 发版

从当前 `main`（或指定发布分支）产出一个新版本：同步版本号、构建校验、更新 changelog、打 tag 并推送。

## 前置确认

1. 目标版本号 `X.Y.Z`（三段 SemVer；补丁 +1、新功能则次版本 +1 并归零补丁）。不使用四段号。
2. 工作区干净（`git status --short` 为空）或改动都属于本次发版。
3. 已在正确分支（通常 `main`；如走发布分支则 `release/X.Y.Z`）。

## 步骤

复制此清单并逐项完成：

```
- [ ] 1 确认版本号与分支
- [ ] 2 同步 package.json 版本
- [ ] 3 type-check + build
- [ ] 4 更新 changelog
- [ ] 5 提交
- [ ] 6 打 tag 并推送
```

### 1 确认版本号与分支

```sh
git branch --show-current
git status --short
```

### 2 同步版本号

前后端两个文件的 `version` 必须一致：

- `zzz-hp/package.json`
- `zzz-hp-backend/package.json`

### 3 构建校验

```sh
cd zzz-hp
npm run type-check
npm run build
```

任一失败则停下修复，不要继续发版。

### 4 更新 changelog

站点 changelog 存在数据库 `changelog` 表，由 `zzz-hp-backend/scripts/seed_changelog.mjs` 维护：

- 在该脚本的 `DELETE ... WHERE version IN (...)` 列表和 `INSERT` 值里追加新版本条目（`version` / `title` / `content` / `published_at`）。
- 需要写库时运行：`cd zzz-hp-backend && node scripts/seed_changelog.mjs`（会连 `.env` 里的库，确认是本地库再跑）。

### 5 提交

```sh
git add zzz-hp/package.json zzz-hp-backend/package.json zzz-hp-backend/scripts/seed_changelog.mjs
git commit -m "chore(release): X.Y.Z"
```

如本次发版还含功能改动，按 Conventional Commits 分成独立提交，发版提交只放版本号 / changelog。

### 6 打 tag 并推送

```sh
git push -u origin HEAD
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin vX.Y.Z
```

## 可选：导出打包

如需生成分发 zip，用 `packages/` 下既有格式（`ZZZ-HP-X.Y.Z-update-*.zip`），或参考 `guestbook-backup` skill 导出留言板数据。

## 红线

- 未 type-check / build 通过不打 tag。
- 不提交 `.env`、上传图、`data/*`、`node_modules`、`packages/`。
- 未经用户确认不 `git push`。
