---
name: zzz-hp-release
description: >-
  ZZZ-HP 发版流程：release 分支、SemVer 版本号、seed_changelog 站点更新日志、
  PR 合 main、annotated tag。在用户问发版、打 tag、更新 changelog、
  release 分支、npm version 时使用。
---

# ZZZ-HP 发版

权威来源：[docs/policies/git-workflow.md](../../docs/policies/git-workflow.md) §版本与发布。

用法索引：[docs/index.md § Cursor Skills](../../docs/index.md#cursor-skills)。

## 对话指令示例

形态：`/zzz-hp-release` + 一句具体任务。后面宜写清版本号、要不要 changelog、要不要 tag、是否已合入；少写日常功能开发细节。

```text
/zzz-hp-release 准备 3.1.9：写 changelog、bump 版本、开 PR
```

```text
/zzz-hp-release 3.1.8 已合入 main，在 merge commit 上打 v3.1.8 并推送
```

```text
/zzz-hp-release 只更新 seed_changelog 里 3.1.9 的条目文案，不 bump 版本
```

## 何时发版

功能已合入 `main`（或准备在 `release/x.y.z` 收拢版本号与 changelog 后一次性 PR 合入）。

## 版本号（SemVer 三段）

| 变更 | 调整 |
|------|------|
| 不兼容 API / 重大行为 | MAJOR+1，MINOR/PATCH 归零 |
| 向后兼容新功能 | MINOR+1，PATCH 归零 |
| 修复、文案、小优化 | PATCH+1 |

以下 **6 处** 必须一致（用 `npm version`，勿手改 lockfile）：

- `zzz-hp/package.json` → `version`
- `zzz-hp/package-lock.json` → `version` 与 `packages[""].version`
- `zzz-hp-backend/package.json` → `version`
- `zzz-hp-backend/package-lock.json` → `version` 与 `packages[""].version`

## 发版流程

```
release/x.y.z（或 chore/bump-x.y.z）
  → npm version（前后端）
  → 更新 seed_changelog.mjs
  → npm ci 验证
  → PR → main
  → 记录 merge commit OID
  → 对该 OID 打 vX.Y.Z annotated tag
  → 推送 tag
```

### 1. 创建发版分支

从最新 `main`：`release/3.1.8`（推荐）或 `chore/bump-3.1.8`。

### 2.  bump 版本

```sh
cd zzz-hp && npm version 3.1.8 --no-git-tag-version
cd ../zzz-hp-backend && npm version 3.1.8 --no-git-tag-version
```

分别在前后端目录运行 `npm ci` 验证。

### 3. 更新站点 changelog

编辑 [zzz-hp-backend/scripts/seed_changelog.mjs](../../zzz-hp-backend/scripts/seed_changelog.mjs)：

1. 新增 `const content318 = \`...\``（条目格式见 [changelog-format.md](changelog-format.md)）
2. 在批量 `DELETE ... IN (...)` 列表中加入新版本号（若沿用该模式）
3. 在批量 `INSERT` 中增加一行 `(version, title, content, published_at)`

**注意**：seed 供新部署写库；线上可在管理后台改 changelog，但发版 PR 仍应更新 seed 以保持仓库与部署一致。

### 4. PR 合入 main

- 提交信息示例：`chore(release): bump 3.1.8 and changelog`
- 合入后**记录** PR merge 在 `main` 上的 **commit OID**

### 5. 打 tag（必须钉在该 OID）

不得对未核对的本地 `HEAD` 或「最新 main」默认打 tag。完整校验与推送见 [tag-release.md](tag-release.md) 或政策文档中的发布脚本。

Tag 名：`v` + 版本号，例如 `v3.1.8`。

## Agent 注意事项

- 发版 PR **只含**版本与 changelog 相关文件，不夹带无关功能
- 打 tag 前再次确认远端 `main` 仍等于 release merge OID
- 打包部署沿用现有运维流程，不在此 skill 定义

## 相关 Skill

- 分支与 PR：[zzz-hp-git-workflow](../zzz-hp-git-workflow/SKILL.md)
