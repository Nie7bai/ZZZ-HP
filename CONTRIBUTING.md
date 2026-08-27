# 贡献指南

完整且具有约束力的 Git 规则见 [Git 协作与发布政策](./docs/policies/git-workflow.md)。本文件保留 GitHub 上的贡献入口和最短操作路径；规则发生冲突时，以政策文档为准。

## 提交一个改动

从最新的 `main` 创建符合[分支命名规则](./docs/policies/git-workflow.md#分支模型)的短期分支：

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

命令会在 `upstream` 和 `origin` 中选择指向权威仓库 `Nie7bai/ZZZ-HP` 的远端；`origin` 仍是当前贡献者用于推送短期分支的可写仓库。配置和核对方法见完整政策中的[远端仓库角色](./docs/policies/git-workflow.md#远端仓库角色)。

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

如果 fast-forward 同步失败，应立即停止，不要将旧主干 merge、rebase 或 push 回当前历史；具体处理见完整政策中的[日常开发流程](./docs/policies/git-workflow.md#日常开发流程)。

提交信息、验证范围和暂存要求见政策中的[提交信息](./docs/policies/git-workflow.md#提交信息)、[PR 与合并](./docs/policies/git-workflow.md#pr-与合并)及[暂存与安全](./docs/policies/git-workflow.md#暂存与安全)。推送后填写仓库 PR 模板，合入 `main` 后删除远程功能分支。

涉及版本发布时，按[版本与发布政策](./docs/policies/git-workflow.md#版本与发布)执行。历史分支内容可在[历史分支记录](./docs/branch-history.md)中查阅，但不得用它判断当前开发基线。
