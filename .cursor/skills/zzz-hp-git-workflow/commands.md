# ZZZ-HP Git 命令块

在 **Git Bash** 或支持 `set -eu` 的 shell 中整段执行。PowerShell 用户可用 Git Bash 运行下列块。

## sync-main — 同步 main 并创建功能分支

将 `feature/your-change` 换成实际分支名。

```sh
(
  set -eu

  main_remote=
  for candidate in upstream origin; do
    candidate_url="$(git remote get-url "$candidate" 2>/dev/null || true)"
    case "$candidate_url" in
      git@github.com:Nie7bai/ZZZ-HP | git@github.com:Nie7bai/ZZZ-HP.git | \
      ssh://git@github.com/Nie7bai/ZZZ-HP | ssh://git@github.com/Nie7bai/ZZZ-HP.git | \
      https://github.com/Nie7bai/ZZZ-HP | https://github.com/Nie7bai/ZZZ-HP.git)
        main_remote="$candidate"
        break
        ;;
    esac
  done

  test -n "$main_remote" || { echo '未找到指向 Nie7bai/ZZZ-HP 的远端' >&2; exit 1; }

  main_ref="refs/remotes/${main_remote}/main"
  git fetch --no-tags "$main_remote" "+refs/heads/main:${main_ref}"
  test -z "$(git status --porcelain)"
  git switch main
  git merge --ff-only "$main_ref"
  git switch -c feature/your-change
)
```

## commit-push — 从短期分支提交并推送

```sh
(
  set -eu
  current_branch="$(git branch --show-current)"
  case "$current_branch" in
    feature/* | fix/* | chore/* | release/*) ;;
    *) echo "拒绝从分支 $current_branch 提交" >&2; exit 1 ;;
  esac

  git status
  git diff
  # git add -- path/to/file
  git diff --cached --check
  git diff --cached
  git commit -m "feat(scope): 简述"
  git push -u origin HEAD
)
```

## direct-merge-main — 直接合入 main（非默认，需写权限）

```sh
(
  set -eu
  git fetch origin
  git switch main
  git merge --ff-only origin/feature/your-change
  git push origin main
)
```

## pr-create — 推送后用 gh 开 PR

需已 `gh auth login`。

```sh
gh pr create --base main --head "$(git branch --show-current)" \
  --title "feat(scope): 简述" \
  --body "$(cat <<'EOF'
## Summary

-

## Type

- [x] feat

## Test plan

- [ ] `cd zzz-hp && npm run type-check`
- [ ] `cd zzz-hp-backend && npm test`

EOF
)"
```
