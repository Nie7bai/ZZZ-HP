## Summary

<!-- 用 1–3 条说明这次改动解决了什么问题 / 为什么改 -->

-

## Type

- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] docs / chore
- [ ] other:

## Test plan

- [ ] `cd zzz-hp && npm run type-check`
- [ ] `cd zzz-hp-backend && npm test`
- [ ] 相关页面 / API 本地手测通过
- [ ] 未误提交 `.env`、上传图、会话文件、明文管理员密码
- [ ] 已核对：`git diff --cached --check` 和 `git diff --cached`
- [ ] 已跑暂存区辅助扫描：`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-no-secrets.ps1 -StagedOnly`

## Notes

<!-- 破坏性变更、迁移步骤、后续跟进写这里；没有可删 -->
