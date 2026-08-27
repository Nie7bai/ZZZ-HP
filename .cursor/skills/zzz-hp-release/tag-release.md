# 打 release tag

发版 PR 已合入 `main` 后，在**干净工作区**执行。将 `<release-pr-merge-oid>` 换成实际 merge commit。

完整逻辑见 [docs/policies/git-workflow.md](../../docs/policies/git-workflow.md) 发布脚本。

## 要点

1. 远端 fetch 后，`main` 必须等于 `<release-pr-merge-oid>`
2. 从该 commit 的 tree 读取 4 个 JSON，校验 6 个 version 字段一致且为三段 SemVer
3. `git tag -a vX.Y.Z <oid> -m "Release X.Y.Z"`
4. 推送前 `git ls-remote` 确认远端 main 仍为该 OID
5. `git push --atomic` 推送 tag（政策脚本含 lease；仅推 tag 时：`git push origin vX.Y.Z`）

## 最小 tag 流程（已人工核对 OID 与版本）

```sh
RELEASE_OID="<release-pr-merge-oid>"
VERSION="3.1.8"
TAG="v${VERSION}"

git fetch origin
git switch main
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "$RELEASE_OID"

git tag -a "$TAG" "$RELEASE_OID" -m "Release $VERSION"
git push origin "$TAG"
```

若 push 前 `main` 已有新提交，**停止**，重新确认应对哪一 commit 发版。
