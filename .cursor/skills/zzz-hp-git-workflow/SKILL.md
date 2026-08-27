---
name: zzz-hp-git-workflow
description: >-
  ZZZ-HP 项目的 Git 分支、PR 与合入规则。在用户问分支怎么用、能否直接合并、
  feature/fix/chore/release 分支、日常开发流程、推 main、PR 是否必须时使用。
---

# ZZZ-HP Git 工作流

权威来源：[docs/policies/git-workflow.md](../../docs/policies/git-workflow.md)。冲突时以政策为准。

## 分支模型（现行）

| 分支 | 用途 |
|------|------|
| `main` | 稳定主干，**默认只通过 PR 合入** |
| `feature/<简述>` | 新功能 |
| `fix/<简述>` | Bug 修复 |
| `chore/<简述>` | 文档、依赖、脚本等 |
| `release/x.y.z` | 可选，收拢发版（版本号 + changelog） |

**不再**新建四段版本分支（如 `3.1.7.3`）。旧 `3.1.7.x` 仅作历史追溯。

## 合并必须走 PR 吗？

**政策默认：是。** `main` 通过 PR 合入，便于留审查记录、PR 描述、CI 与发版时锁定 merge commit。

**技术上：不强制。** 若有仓库写权限且 GitHub 未开分支保护，可直接：

```sh
git switch main
git merge --ff-only origin/feature/your-change   # 或本地分支
git push origin main
```

| 方式 | 适用 |
|------|------|
| **PR（推荐）** | 日常功能、发版、需留痕与 review |
| **直接 merge + push** | 单人维护、紧急热修、已本地充分验证且接受无 PR 记录 |

发版打 tag 时，政策要求**先确认 release PR 落在 `main` 上的确切提交 OID**，再对该提交打 annotated tag。无 PR 时须自行记录该 merge/push 的 commit hash。

## 日常开发（Agent 执行顺序）

1. 确认工作区干净：`git status --porcelain` 为空
2. 从权威远端 fast-forward 同步 `main`（见 [commands.md](commands.md) 的 `sync-main`）
3. 创建短期分支：`feature/`、`fix/`、`chore/` 或 `release/`
4. 改动、验证（见下方检查清单）
5. 按路径暂存，**不用** `git add .`
6. 提交：`type(scope): 简述`（Conventional Commits）
7. `git push -u origin HEAD`
8. **默认**：GitHub 开 PR → 合入 `main` → 删远程功能分支

**禁止**从 `main` 或历史版本分支（如 `3.1.7.2`）直接提交日常改动。

## 合入前检查清单

- [ ] `git diff --cached --check` 与 `git diff --cached`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-no-secrets.ps1 -StagedOnly`
- [ ] 前端：`cd zzz-hp && npm run type-check`（有 UI 时建议 `npm run build`）
- [ ] 后端：`cd zzz-hp-backend && npm test`
- [ ] 无 `.env`、明文管理员密码、用户上传、会话文件、`node_modules`

## PR

- 标题：Conventional Commits 或清楚说明意图
- 正文：使用 [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)

## 相关 Skill

- 发版、changelog、tag： [zzz-hp-release](../zzz-hp-release/SKILL.md)
- 可复制命令块： [commands.md](commands.md)
