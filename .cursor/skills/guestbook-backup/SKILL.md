---
name: guestbook-backup
description: Back up or verify ZZZ-HP guestbook data and images. Use when the user asks to 备份留言板 / 导出留言板 / 检查留言板图片 / restore guestbook images, or when guestbook images 404 / show broken. Exports DB tables + guestbook_image to packages/, and diffs DB image refs against files on disk.
---

# 留言板备份与图片校验

留言板文字在数据库、图片在 `zzz-hp-backend/guestbook_image/`（该目录被 gitignore，Git 不会保存）。此 skill 负责导出备份与找出缺失图片。

## 何时用

- 定期 / 发版前备份留言板。
- 用户反馈留言板图片裂图、404。
- 迁移到云服务器或恢复数据。

## 导出备份

在 `zzz-hp-backend` 目录运行：

```sh
npm run export:guestbook
```

产物在 `packages/guestbook-export-<时间戳>/`（同时生成同名 `.zip`）：

- `guestbook-data.sql` — 帖子 / 评论 / 用户 / 敲敲 / 关注 / site_info / changelog 等表
- `guestbook_image/` — 全部上传图片
- `IMPORT-README.txt` — 云端导入步骤

脚本见 `zzz-hp-backend/scripts/export-guestbook.mjs`。

## 校验图片完整性

```sh
npm run check:guestbook-images
```

输出「引用总数 / 命中 / 缺失」；有缺失时列出文件名并以非零码退出。脚本见 `zzz-hp-backend/scripts/check-guestbook-images.mjs`，它扫描 `guestbook`、`guestbook_comment`、`guestbook_user` 三表引用的 `/guestbook_image/*` 与磁盘对比。

## 恢复缺失图片

1. 先跑校验拿到缺失文件名。
2. 按文件名到备份里找：`packages/guestbook-export-*/guestbook_image/`、旧版 zip、服务器 `guestbook_image/`。
3. 找到后拷回 `zzz-hp-backend/guestbook_image/`，重跑校验确认为 0 缺失。
4. 确实无备份的：图片无法恢复，只能告知用户；前端 `GuestbookSensitiveMedia.vue` 已对加载失败回退到默认图，不会裂图。

## 云端导入

按导出目录里的 `IMPORT-README.txt`：先备份云库 → `mysql -u USER -p DB < guestbook-data.sql` → 拷 `guestbook_image/*` 到云端同目录 → 重启后端。

## 建议

本机已可安装 Windows 计划任务 `ZZZ-HP-Guestbook-Backup`（每天 03:00）：

```sh
powershell -NoProfile -ExecutionPolicy Bypass -File zzz-hp-backend/scripts/daily-guestbook-backup.ps1
```

会执行导出 + 图片校验，日志写到 `packages/backup-logs/`。请把 `packages/guestbook-export-*.zip` 再拷一份到仓库外的备份盘，避免与本机磁盘一起丢失。
