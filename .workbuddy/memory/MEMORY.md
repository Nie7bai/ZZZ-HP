# 项目长期记忆（E:\zzz_HP）

## Git 网络操作（重要）

- 本机系统 Internet 设置里残留代理 `127.0.0.1:7899`（ProxyEnable=0，但 git 仍会走它且该代理已失效），直接 `git fetch/pull/push` 报 `SSL_ERROR_SYSCALL`、`HTTP2 framing layer` 或 `CONNECT tunnel failed 502`。
- 直连 GitHub 通常是通的，但不稳定（偶发 `Recv failure: Connection was reset`）；失败时先重试 1-3 次再判定失败。执行 git 网络操作前先清环境变量并禁用代理：

  ```
  $env:http_proxy=""; $env:https_proxy=""; $env:ALL_PROXY=""
  git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 fetch origin
  ```

- 输出中文日志会乱码（PowerShell 默认 GBK 解码 git 的 UTF-8 输出）；先设 `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8` 再写文件即可。
- 当前唯一远端是 `origin = https://github.com/Nie7bai/ZZZ-HP.git`（权威仓库，push 需用户明确要求）。

## 本机工具环境坑（Windows / WorkBuddy）

- **Git Bash 不可用**：`ls` / `head` / `dirname` 都报 command not found，连 shim 自身都会挂。列目录用 Glob，查内容用 Grep，别用 Bash。
- **PowerShell 工具不回显 stdout**：调用结果只显示 exit code，看不到输出。解决办法是让命令把结果 `Set-Content`/`Add-Content` 写到一个临时文件，再用 Read 工具读。临时文件放 `.workbuddy/` 下（该目录本身未跟踪）。
- **PowerShell 里别写裸 `@{...}`**：`git rev-parse @{u}` 中的 `@{u}` 会被解析成哈希表字面量，导致**整个脚本解析失败、一行都不执行**（表现为 exit 1 且临时文件没被写入）。要用就加引号 `'@{u}'`。

## .git/index.lock 事故（2026-09-24，已修复）

- 现象：`git switch main` 撞上残留的 `.git/index.lock`（前一次被中断的 git 操作留下的 0 字节文件），报 `fatal: Unable to create '.../index.lock': File exists`。
- 教训：**确认无 git 进程后再删锁，删完必须立刻 `git reset --hard <branch>` 重建索引**。只删锁就直接 switch，git 会读到损坏的索引，把约 710 个仍属于目标分支的文件当成"待删除"而物理删除（当时 `zzz-hp-backend/src/app.js`、`docs/policies/git-workflow.md`、`zzz-hp/src/assets/main.css` 等全部消失）。
- 恢复方式（内容无损失，git 对象是唯一真相源）：`git reset --hard main` → `Updating files: 100% (710/710)`，未跟踪文件不受影响。
- 判断依据：`git ls-tree -r main --name-only` 仍能列出 1485 个文件、`git checkout main -- <单文件>` 能恢复 → 说明只是工作区/索引失同步，不是数据丢失。
