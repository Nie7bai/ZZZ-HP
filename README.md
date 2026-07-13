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

编辑 `.env`，填入你的 MySQL 连接信息，然后**执行一次**结构初始化脚本：

```sh
# 在 zzz-hp-backend 目录，按你的账号密码调整 -u / -p
mysql -u root -p < init_schema.sql
```

`init_schema.sql` 已整合原先分散的 `init_tables.sql`、`create_*.sql`、`alter_*.sql` 中的**建表逻辑**，会创建 `zzz` 库及全部业务表。

导入业务数据（可选，按需执行）：

- `insert_*.sql` — 防卫战 Buff / Boss / 期数等静态数据
- `scripts/import-calculator-buffs.mjs` — 计算器角色/音擎/驱动盘/邦布
- `scripts/seed-admin.mjs` — 管理员账号

### 3. 安装依赖

前后端各执行一次（首次克隆后必做）：

```sh
cd zzz-hp-backend
npm install

cd ../zzz-hp
npm install
```

### 4. 启动开发环境

#### 方式 A：一键启动（推荐，Windows）

在 **`zzz-hp`** 目录下任选其一：

```sh
# 双击或在资源管理器中运行
start-dev.bat
```

```sh
# 或在终端中
npm run dev:all
```

脚本会打开两个新终端窗口，分别启动：

| 服务 | 地址 |
|------|------|
| 后端 API | http://localhost:3010 |
| 前端页面 | http://localhost:5173 |

前提：已配置 `zzz-hp-backend/.env`，且前后端均已 `npm install`。脚本通过相对路径查找同级目录 `zzz-hp-backend`，与仓库当前结构一致。

#### 方式 B：手动分别启动

后端：

```sh
cd zzz-hp-backend
npm run dev
```

前端（另开终端）：

```sh
cd zzz-hp
npm run dev
```

### 5. 生产构建

```sh
cd zzz-hp
npm run build
```

## 说明

- **不要提交** `.env`、`node_modules`、`dist`、运行时 `uploads`
- 数据库内容不在 Git 中；clone 后先跑 `init_schema.sql` 建表，再用 SQL / 导入脚本写入数据
- 旧的 `init_tables.sql`、`create_*.sql`、`alter_*.sql` 仍保留作参考，新环境请优先使用 `init_schema.sql`
- 图片等静态资源位于后端各资源目录，以及前端 `public` / `boss_image` 等目录
