# Git 协作与发布政策

本政策是项目 Git 协作与版本发布规则的唯一事实来源，适用于项目成员和自动化工具。当前分支及其远程状态应通过 Git 或 GitHub 查询，不在文档中维护动态清单。

本文中的发布规则只覆盖版本号、站点 changelog、PR 合并和 Git tag。更新包制作与服务器部署沿用现有运维流程，不在本文定义。

## 远端仓库角色

权威仓库是 `Nie7bai/ZZZ-HP`。本政策使用以下远端角色：

- `origin` 是 clone 时创建的默认远端，可以指向个人 fork，也可以直接指向权威仓库，用于推送短期分支。
- 使用 fork 时，`upstream` 指向权威仓库，用于同步 `main`；直接 clone 权威仓库时可以只使用 `origin`。

首次使用前通过 `git remote -v` 核对远端。`origin` 指向 fork 且没有 `upstream` 时执行：

```sh
git remote add upstream https://github.com/Nie7bai/ZZZ-HP.git
```

不得根据远端名称推断仓库身份。同步 `main` 时，应在 `upstream` 和 `origin` 中选择 fetch URL 指向权威仓库的远端；发布前还必须确认所选远端的全部 fetch URL 和 push URL 都属于 `Nie7bai/ZZZ-HP`。

## 分支模型

项目采用简化的 GitHub Flow。`main` 保持稳定、可发布，日常改动使用短期分支，并通过 PR 合入 `main`。

| 分支 | 用途 |
|------|------|
| `main` | 稳定主干，默认只通过 PR 合入 |
| `feature/<简述>` | 新功能，例如 `feature/guestbook-dm` |
| `fix/<简述>` | Bug 修复，例如 `fix/image-404` |
| `chore/<简述>` | 构建、文档、依赖等杂项 |
| `release/x.y.z` | 可选，用于收拢发版改动、更新版本号和 changelog |

不再使用四段版本号作为分支名，例如 `3.0.9.1`。历史版本分支可以保留用于追溯，新版本使用 `release/x.y.z`，也可以直接从 `main` 发布。

分支用途通过名称和 PR 说明表达，不维护静态的分支状态表。历史分支记录不作为当前开发或发布基线。

## 日常开发流程

以下初始化步骤应作为一个子 shell 整段执行，任一步失败都会停止后续步骤：

```sh
(
  set -eu

  main_remote=
  for candidate in upstream origin; do
    candidate_url="$(git remote get-url "$candidate" 2>/dev/null || true)"
    case "$candidate_url" in
      git@github.com:Nie7bai/ZZZ-HP | \
      git@github.com:Nie7bai/ZZZ-HP.git | \
      ssh://git@github.com/Nie7bai/ZZZ-HP | \
      ssh://git@github.com/Nie7bai/ZZZ-HP.git | \
      https://github.com/Nie7bai/ZZZ-HP | \
      https://github.com/Nie7bai/ZZZ-HP.git)
        main_remote="$candidate"
        break
        ;;
    esac
  done

  test -n "$main_remote" || {
    printf '%s\n' '未找到指向 Nie7bai/ZZZ-HP 的远端；fork clone 请先配置 upstream。' >&2
    exit 1
  }

  main_ref="refs/remotes/${main_remote}/main"
  git fetch --no-tags "$main_remote" \
    "+refs/heads/main:${main_ref}"
  test -z "$(git status --porcelain)"
  git switch main
  test -z "$(git status --porcelain)"
  git merge --ff-only "$main_ref"
  test "$(git rev-parse HEAD)" = "$(git rev-parse "$main_ref")"
  git switch -c feature/your-change
)
```

开发并完成相关验证后，再整段执行提交步骤：

```sh
(
  set -eu
  current_branch="$(git branch --show-current)"
  case "$current_branch" in
    feature/* | fix/* | chore/* | release/*) ;;
    *)
      printf '拒绝从分支 %s 提交或推送。\n' "$current_branch" >&2
      exit 1
      ;;
  esac

  git status
  git diff
  git add -- path/to/changed-file
  git diff --cached --check
  git diff --cached
  git commit -m "feat(scope): 简述"
  git push -u origin HEAD
)
```

如果 `git merge --ff-only` 因本地主干与远端分叉而失败，应立即停止。不要通过普通 merge、rebase 或 push 把历史重写前的旧主干重新接回当前历史；旧 clone 默认重新 clone。确需保留本地未推送工作时，先将待保留改动导出为补丁或独立提交并人工核对，再迁移到新的 clone。

推送后在 GitHub 创建 PR，合入 `main` 后删除远程功能分支。

## 提交信息

提交信息采用 Conventional Commits：

```text
<type>(optional-scope): <简述，使用祈使语气，不超过约 72 字>

可选正文：说明为什么修改，不重复罗列文件变化。
```

常用 `type`：

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 不改变行为的重构 |
| `docs` | 文档 |
| `chore` | Git 配置、依赖和脚本等杂项 |
| `perf` | 性能优化 |
| `test` | 测试 |

`scope` 可使用 `calculator`、`guestbook`、`admin`、`auth`、`backend`、`ci` 等具体模块名。

```text
feat(calculator): 异常伤害拆为四类期望
fix(guestbook): 恢复 App 全局挂载与登录弹窗
chore: 补充贡献指南与 PR 模板
```

一个提交只处理一件事。不同模块或不同目的的改动应拆开提交。

## PR 与合并

- PR 标题应符合 Conventional Commits 风格，或清楚说明改动意图。
- PR 只包含与当前目标相关的文件，并在描述中说明改动原因和验证结果。
- 前端改动运行 `cd zzz-hp && npm run type-check`；有 UI 改动时建议再运行 `npm run build`。
- 后端改动运行 `cd zzz-hp-backend && npm test`，并验证相关接口。涉及表结构时，说明迁移方式以及是否需要更新 `init_schema.sql`。
- 提交前确认没有密钥文件、明文管理员密码、运行时数据或误加的大体积二进制文件。
- PR 默认合入 `main`。合并后删除已完成的远程功能分支。

PR 描述使用仓库的 [PR 模板](../../.github/PULL_REQUEST_TEMPLATE.md)。

## 版本与发布

发版 PR 合入前，前后端 `package.json` 的 `version`，以及对应 `package-lock.json` 的顶层 `version` 和 `packages[""]` 根包版本必须保持一致，并使用三段式 SemVer：`MAJOR.MINOR.PATCH`。

| 变更 | 版本调整 |
|------|----------|
| 不兼容的 API 或重大行为变化 | `MAJOR` 加 1，`MINOR` 和 `PATCH` 归零 |
| 向后兼容的新功能 | `MINOR` 加 1，`PATCH` 归零 |
| 向后兼容的修复、文案或小优化 | `PATCH` 加 1 |

发版时按以下步骤操作：

1. 分别在前后端目录使用 `npm version x.y.z --no-git-tag-version` 更新版本，确保两个 `package.json` 及对应 `package-lock.json` 同步变化；不要手工编辑 lockfile。
2. 核对上述所有版本字段一致，并分别在干净环境运行 `npm ci`。
3. 按现有流程更新站点 changelog。站点首页的更新日志由 [`seed_changelog.mjs`](../../zzz-hp-backend/scripts/seed_changelog.mjs) 写入数据库。
4. 通过 PR 合入 `main`。
5. 从 PR 合并结果中记录本次 release PR 落在 `main` 上的确切提交 OID。在干净工作区从权威仓库远端同步 `main`，并确认该远端的 `main` 仍等于该 OID；如果后续提交已经进入 `main`，应停止并重新确认发布目标，不得默认给最新提交打标签。
6. 从该发布提交的 Git tree 读取并核对六个版本字段，派生 tag 名后对这个确切提交创建 annotated tag。推送前再次核对远端 `main`，并使用精确 lease 与 atomic push 尽早发现并发更新；这不是服务端发布锁，校验完成后 `main` 仍可能正常前进，但 tag 的目标不得随之改变。PR 合并不会自动更新本地分支，不得直接给未核对的当前 `HEAD` 打发布标签。

以下命令应作为一个子 shell 整段执行；任一命令或校验失败都会终止发布步骤，但不会退出当前交互 shell。

```sh
(
  set -eu

  is_authoritative_url() {
    case "$1" in
      git@github.com:Nie7bai/ZZZ-HP | \
      git@github.com:Nie7bai/ZZZ-HP.git | \
      ssh://git@github.com/Nie7bai/ZZZ-HP | \
      ssh://git@github.com/Nie7bai/ZZZ-HP.git | \
      https://github.com/Nie7bai/ZZZ-HP | \
      https://github.com/Nie7bai/ZZZ-HP.git)
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  }

  remote_urls_are_authoritative() (
    remote_name="$1"
    direction="$2"

    case "$direction" in
      fetch) urls="$(git remote get-url --all "$remote_name")" || exit 1 ;;
      push) urls="$(git remote get-url --push --all "$remote_name")" || exit 1 ;;
      *) exit 1 ;;
    esac

    test -n "$urls" || exit 1
    while IFS= read -r url; do
      is_authoritative_url "$url" || exit 1
    done <<EOF
$urls
EOF
  )

  release_remote=
  for candidate in upstream origin; do
    if remote_urls_are_authoritative "$candidate" fetch 2>/dev/null &&
       remote_urls_are_authoritative "$candidate" push 2>/dev/null; then
      release_remote="$candidate"
      break
    fi
  done

  test -n "$release_remote" || {
    printf '%s\n' '发布已停止：没有远端的 fetch URL 与全部 push URL 同时指向 Nie7bai/ZZZ-HP。' >&2
    exit 1
  }

  release_main_ref="refs/remotes/${release_remote}/main"
  git fetch --prune --tags "$release_remote" \
    "+refs/heads/main:${release_main_ref}"
  test -z "$(git status --porcelain)"
  git switch main
  test -z "$(git status --porcelain)"
  git merge --ff-only "$release_main_ref"
  test -z "$(git status --porcelain)"

  release_commit="<release-pr-merge-oid>"
  git cat-file -e "${release_commit}^{commit}"
  test "$(git rev-parse "$release_main_ref")" = "$release_commit"
  test "$(git rev-parse HEAD)" = "$release_commit"

  release_version="$(
    for version_file in \
      zzz-hp/package.json \
      zzz-hp/package-lock.json \
      zzz-hp-backend/package.json \
      zzz-hp-backend/package-lock.json; do
      git show "${release_commit}:${version_file}"
      printf '\0'
    done | node -e '
      const fs = require("node:fs")
      const documents = fs.readFileSync(0).toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map(JSON.parse)
      if (documents.length !== 4) {
        console.error(`Expected 4 version documents, got ${documents.length}`)
        process.exit(1)
      }
      const versions = [
        documents[0].version,
        documents[1].version,
        documents[1].packages[""].version,
        documents[2].version,
        documents[3].version,
        documents[3].packages[""].version,
      ]
      if (versions.some((version) => version !== versions[0])) {
        console.error(`Version mismatch: ${versions.join(", ")}`)
        process.exit(1)
      }
      if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(versions[0])) {
        console.error(`Version is not three-part SemVer: ${versions[0]}`)
        process.exit(1)
      }
      process.stdout.write(versions[0])
    '
  )"
  release_tag="v${release_version}"

  git tag -a "$release_tag" "$release_commit" -m "Release $release_version"
  test "$(git rev-list -n 1 "$release_tag")" = "$release_commit"

  live_remote_main="$(git ls-remote "$release_remote" refs/heads/main | cut -f1)"
  test "$live_remote_main" = "$release_commit"

  git push --atomic \
    --force-with-lease="refs/heads/main:${release_commit}" \
    "$release_remote" \
    "${release_commit}:refs/heads/main" \
    "refs/tags/$release_tag"

  remote_release_commit="$(git ls-remote "$release_remote" "refs/tags/${release_tag}^{}" | cut -f1)"
  test "$remote_release_commit" = "$release_commit"
)
```

`release/x.y.z` 仅在需要集中处理发版改动时使用，不建立与 `main` 并行的长期开发线。

## 暂存与安全

- 暂存前使用 `git status` 和 `git diff` 核对改动，不使用 `git add .` 无差别暂存文件。暂存后运行 `git diff --cached --check` 和 `git diff --cached`，以 Git index 中的实际提交内容为准。
- 不提交 `.env`、证书、`guestbook_image` 用户上传、`data/*` 会话文件、`node_modules` 或 `packages/` 打包产物。
- 禁止提交明文管理员口令，包括 SQL 中的 `INSERT INTO admin`。管理员口令只写入云端 `.env` 的 `ADMIN_PASSWORD`。轮换前必须停止后端服务并确认管理员登录接口已不可访问，再从仓库根目录运行 `cd zzz-hp-backend && npm run set:admin-password` 写入 bcrypt 并撤销全部现有管理员会话；命令成功后才能重启后端。若会话撤销失败，命令会以失败状态退出，必须保持停服并处理后再继续。
- 计算器、危局、防卫和站点等业务表只允许提交经过审查的静态初始化数据或种子数据。禁止提交生产数据库 dump、用户私信、手机号等个人信息以及其他运行时数据。
- 密钥检查脚本是辅助检查，只覆盖有限的敏感文件名、密钥扩展名和明文管理员密码模式；它不会判断业务数据是否来自生产环境，也不能替代对 staged diff 和打包内容的人工核对。

提交前核对暂存内容：

```sh
git diff --cached --check
git diff --cached
```

提交前运行暂存区辅助扫描。该模式读取 Git index 中实际准备提交的内容，包括通常被完整扫描跳过的资源目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-no-secrets.ps1 -StagedOnly
```

打包前运行完整工作区辅助扫描；`pack-update.ps1` 还会对生成的包目录再次扫描：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-no-secrets.ps1
```

运行时上传目录由 `.gitignore` 排除。需要入库的默认封面等静态资源使用导出包或运维拷贝，Git 不负责备份用户上传文件。

## 相关文档

- [贡献指南](../../CONTRIBUTING.md) 提供 GitHub 上的协作入口和最短操作路径。
- [历史分支记录](../branch-history.md) 只用于追溯旧分支，不定义现行规则或当前状态。
- 用户可见的版本更新内容由 [`seed_changelog.mjs`](../../zzz-hp-backend/scripts/seed_changelog.mjs) 维护。
