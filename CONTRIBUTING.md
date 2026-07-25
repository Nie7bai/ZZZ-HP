# 贡献与 Git 规范

本仓库采用简化的 GitHub Flow：`main` 保持可发布，日常开发走短命分支，版本发布用 SemVer + tag。

## 分支

| 分支 | 用途 |
|------|------|
| `main` | 稳定主干，默认只通过 PR 合入 |
| `feature/<简述>` | 新功能，例如 `feature/guestbook-dm` |
| `fix/<简述>` | Bug 修复，例如 `fix/image-404` |
| `chore/<简述>` | 构建、文档、依赖等杂项 |
| `release/x.y.z` | 可选：收拢发版改动、改版本号、写 changelog |

**不要**再使用四段版本号作分支名（如 `3.0.9.1`）。历史分支可保留，新发布统一用 `release/3.0.10` 或直接在 `main` 打 tag。

### 日常流程

```sh
git checkout main
git pull
git checkout -b feature/your-change

# 开发与自测 …

git add <相关文件>
git commit -m "feat(scope): 简述"
git push -u origin HEAD
```

在 GitHub 开 PR → 合并进 `main` → 删除远程功能分支。

## 提交信息（Conventional Commits）

格式：

```text
<type>(optional-scope): <简述，祈使语气，不超过约 72 字>

可选正文：说明为什么改，而不是罗列改了哪些文件。
```

常用 `type`：

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 重构（行为不变） |
| `docs` | 文档 |
| `chore` | 杂务（gitignore、依赖、脚本） |
| `perf` | 性能 |
| `test` | 测试 |

`scope` 建议：`calculator`、`guestbook`、`admin`、`auth`、`backend`、`ci`。

示例：

```text
feat(calculator): 异常伤害拆为四类期望
fix(guestbook): 恢复 App 全局挂载与登录弹窗
chore: 补充 CONTRIBUTING 与 PR 模板
```

**一个提交只做一件事。** 计算器改动与留言板修复应拆开提交。

## 版本号（SemVer）

前后端 `package.json` 的 `version` 保持一致，使用三段式：`MAJOR.MINOR.PATCH`。

| 变更 | 版本怎么动 |
|------|------------|
| 不兼容的 API / 重大行为变化 | `MAJOR` +1，MINOR/PATCH 归零 |
| 向后兼容的新功能 | `MINOR` +1，PATCH 归零 |
| 向后兼容的修复、文案、小优化 | `PATCH` +1 |

发版步骤：

1. 在发版提交中同步修改 `zzz-hp/package.json` 与 `zzz-hp-backend/package.json`。
2. 更新 changelog（站点 changelog 表 / `seed_changelog.mjs`，按现有流程）。
3. 合并到 `main` 后打 annotated tag 并推送：

```sh
git tag -a v3.0.10 -m "Release 3.0.10"
git push origin v3.0.10
```

## 暂存与忽略

- 不要 `git add .` 无脑全加；先 `git status` / `git diff` 确认。
- 勿提交：`.env`、证书、`guestbook_image` 用户上传、`data/*` 会话文件、`node_modules`、`packages/` 打包产物。
- 运行时上传目录已在 `.gitignore`；默认封面等需入库的静态资源走导出包或运维拷贝，不要指望 git 备份用户图。

## PR 检查清单

- [ ] 标题符合 Conventional Commits 风格或清晰说明意图
- [ ] 只包含与本 PR 相关的文件
- [ ] 前端：`cd zzz-hp && npm run type-check`（有 UI 改动时建议再 `npm run build`）
- [ ] 后端：相关接口本地可跑通；涉及表结构时说明迁移 / `init_schema.sql` 是否需更新
- [ ] 无密钥、无大体积二进制误加
