# 文档索引

## 项目政策

- [项目政策说明](./policies/index.md)：稳定的协作、发布、质量和安全规则。
- [Git 协作与发布政策](./policies/git-workflow.md)：分支、提交、PR、合并和发版规则的唯一事实来源。

## Cursor Skills

给 Cursor Agent 用的可执行手册；**规则仍以** [Git 协作与发布政策](./policies/git-workflow.md) **为准**，skill 冲突时以政策文档为准。

| Skill | 何时用 | 入口 |
|------|--------|------|
| `zzz-hp-git-workflow` | 分支怎么用、提交流程、能否直接合、开 PR | [SKILL.md](../.cursor/skills/zzz-hp-git-workflow/SKILL.md) |
| `zzz-hp-release` | 发版、改版本号、写站点 changelog、打 tag | [SKILL.md](../.cursor/skills/zzz-hp-release/SKILL.md) |

**怎么用（对话里）：**

指令形态是：**`/skill名` + 一句具体任务**。后面跟「要做什么」，不要空挂 skill。

1. 用 `/` 选中对应 skill，或把 skill 目录 / `SKILL.md` 附到消息上。
2. 写清目标（分支名、版本号、提交/PR/tag 等）。
3. 只了解提交流程时挂 `zzz-hp-git-workflow`；发版相关再挂 `zzz-hp-release`。

**`zzz-hp-git-workflow` 示例（日常提交）：**

```text
/zzz-hp-git-workflow 从最新 main 拉 chore/skills-docs
```

```text
/zzz-hp-git-workflow 把当前改动提交并推送，开 PR 到 main
```

```text
/zzz-hp-git-workflow 能不能直接合进 main？按政策说明一下
```

```text
/zzz-hp-git-workflow 同步 main，创建 fix/calc-disorder-mult，只改计算器相关文件
```

后面宜写清：分支名、目标（提交 / 推送 / PR / 直接合）、范围。

**`zzz-hp-release` 示例（发版）：**

```text
/zzz-hp-release 准备 3.1.9：写 changelog、bump 版本、开 PR
```

```text
/zzz-hp-release 3.1.8 已合入 main，在 merge commit 上打 v3.1.8 并推送
```

```text
/zzz-hp-release 只更新 seed_changelog 里 3.1.9 的条目文案，不 bump 版本
```

后面宜写清：版本号、要不要 changelog、要不要 tag、是否已合入。

| Skill | 后面跟什么 | 少写什么 |
|------|------------|----------|
| git-workflow | 拉什么分支、提交/推送/PR、改哪些事 | 发版号、打 tag |
| release | `x.y.z`、changelog、tag | 日常小功能开发细节 |

一句话：**skill 负责「按哪套流程」，后面那句负责「这次具体要完成什么」。**

补充材料：

- [commands.md](../.cursor/skills/zzz-hp-git-workflow/commands.md)：同步 main、提交推送、直接合入等命令块
- [changelog-format.md](../.cursor/skills/zzz-hp-release/changelog-format.md)：`seed_changelog.mjs` 条目格式
- [tag-release.md](../.cursor/skills/zzz-hp-release/tag-release.md)：合入后打 annotated tag

## 规格文档

- [规格文档索引](./specs/index.md)：当前功能与技术规格、历史实现记录及编写约定。

## 规划与维护

- [未来规划](../future-roadmap.md)：尚未落地的功能方向和后续设计。
- [维护清单](../TODO-FOR-OWNER.md)：需要所有者确认的事项、遗留验证和长期结构债。

## 参考资料

- [历史分支记录](./branch-history.md)：旧版本线、专题分支和交接内容，仅用于追溯。
