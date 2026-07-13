# ZZZ-HP

绝区零相关查询 / 伤害计算站点（前端 + 后端）。

仓库结构：

```text
ZZZ-HP/
├── zzz-hp/              # 前端（Vue 3 + Vite + TypeScript）
└── zzz-hp-backend/      # 后端（Express + MySQL）
```

## 环境要求

- Node.js `^22.18` 或 `>=24.12`
- MySQL 8（本地或云数据库）

## 快速开始

### 1. 克隆仓库

```sh
git clone https://github.com/Nie7bai/ZZZ-HP.git
cd ZZZ-HP
```

### 2. 配置数据库

```sh
cd zzz-hp-backend
copy .env.example .env
```

编辑 `.env`，填入你的 MySQL 连接信息，然后按需执行仓库内 SQL（如 `init_tables.sql`、`create_*.sql`）初始化表结构，并用 `scripts/` 下的导入脚本补充数据。

### 3. 启动后端

```sh
cd zzz-hp-backend
npm install
npm run dev
```

默认端口：`3010`

### 4. 启动前端

另开终端：

```sh
cd zzz-hp
npm install
npm run dev
```

前端开发服务器默认由 Vite 启动；也可在 `zzz-hp` 目录使用：

```sh
npm run dev:all
```

同时拉起前后端（Windows PowerShell 脚本）。

### 5. 生产构建

```sh
cd zzz-hp
npm run build
```

## 说明

- **不要提交** `.env`、`node_modules`、`dist`、运行时 `uploads`
- 数据库内容不在 Git 中；请用 SQL / 迁移脚本在目标环境重建
- 图片等静态资源位于后端各资源目录，以及前端 `public` / `boss_image` 等目录
