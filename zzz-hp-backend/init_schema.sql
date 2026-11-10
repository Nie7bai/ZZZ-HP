-- ZZZ-HP 数据库结构初始化（一次性执行）
-- 用法：mysql -u root -p < init_schema.sql
-- 或在 MySQL 客户端中：SOURCE /path/to/init_schema.sql;
--
-- 说明：
-- - 仅创建库与表结构，不含业务数据
-- - 数据导入请使用 insert_*.sql 或 scripts/ 下的导入脚本
-- - 用户安全等增量列仍可能由运行时 ensure* 自愈；启动入口见
--   src/bootstrap/ensureRuntimeSchema.js（app 启动时调用）

CREATE DATABASE IF NOT EXISTS zzz DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE zzz;

-- ---------------------------------------------------------------------------
-- 防卫战 / 危局强袭 / 式舆
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS boss (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '阶段',
  boss_name VARCHAR(255) NOT NULL COMMENT 'Boss名称',
  hp INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '生命值',
  hp_coeff_percent INT NULL COMMENT '危局血量系数%（手动覆盖，空则自动计算）',
  defense INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '防御力',
  level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '等级',
  room VARCHAR(100) DEFAULT NULL COMMENT '房间',
  weakness VARCHAR(255) DEFAULT NULL COMMENT '弱点',
  resistance VARCHAR(255) DEFAULT NULL COMMENT '抗性',
  resistance_high VARCHAR(255) DEFAULT NULL COMMENT '高抗性属性（40%）；为 resistance 的子集；空则回退 boss_info',
  boss_image VARCHAR(500) DEFAULT NULL COMMENT 'Boss图片',
  stagger_multiplier DECIMAL(5,3) NULL COMMENT '失衡易伤区基础乘数；空则回退 boss_info',
  stagger_time DECIMAL(8,2) NULL COMMENT '失衡时间（秒）；空则回退 boss_info',
  mode VARCHAR(20) NOT NULL DEFAULT 'crisis' COMMENT 'crisis|defense|deduction（版块归属）',
  field_buff_set_id VARCHAR(64) NULL COMMENT '危局当期绑定的场地 Buff 套 id（boss_info.field_buff_sets）',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Boss表';

CREATE TABLE IF NOT EXISTS buff (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '阶段',
  buff_name VARCHAR(100) NOT NULL COMMENT 'Buff名称',
  buff TEXT DEFAULT NULL COMMENT 'Buff效果描述',
  buff_image VARCHAR(500) DEFAULT NULL COMMENT 'Buff图片',
  effect_blocks JSON NULL COMMENT '计算器结构化效果块（BuffEffectBlock[]）',
  mode VARCHAR(20) NOT NULL DEFAULT 'crisis' COMMENT 'crisis|defense|deduction（版块归属）',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Buff表';

CREATE TABLE IF NOT EXISTS boss_info (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  boss_name VARCHAR(255) NOT NULL COMMENT 'Boss名称',
  defense INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '防御力',
  level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '等级',
  boss_image VARCHAR(500) DEFAULT NULL COMMENT 'Boss图片',
  weakness VARCHAR(255) DEFAULT NULL COMMENT '弱点',
  resistance VARCHAR(255) DEFAULT NULL COMMENT '抗性',
  resistance_high VARCHAR(255) DEFAULT NULL COMMENT '高抗性属性（40%）；为 resistance 的子集',
  crisis_base_hp DOUBLE NULL COMMENT '怪物危局基础血量',
  stagger_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.500 COMMENT '失衡易伤区基础乘数（1.5=150%）',
  stagger_time DECIMAL(8,2) NULL COMMENT '失衡时间（秒）',
  anomaly_bar_coefficient DECIMAL(6,4) NULL COMMENT '异常条系数；最大异常积蓄 = 基础异常条 × 系数；空按 1 处理',
  field_buff_name VARCHAR(100) NULL COMMENT 'Boss 场地 Buff 名称',
  field_buff_text TEXT NULL COMMENT 'Boss 场地 Buff 文本说明',
  field_buff_image VARCHAR(500) NULL COMMENT 'Boss 场地 Buff 图片',
  field_buff_effect_blocks JSON NULL COMMENT 'Boss 场地 Buff 结构化效果块',
  field_buff_sets JSON NULL COMMENT '危局 Boss 场地 Buff 多套（id/name/text/image/effectBlocks）',
  PRIMARY KEY (id),
  UNIQUE KEY uk_boss_name (boss_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Boss基础信息表';

CREATE TABLE IF NOT EXISTS id_info (
  id INT UNSIGNED NOT NULL COMMENT '房间ID（版本+期数+房间）',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '阶段',
  room VARCHAR(10) NOT NULL COMMENT '房间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房间ID信息表';

CREATE TABLE IF NOT EXISTS id_table (
  id INT UNSIGNED NOT NULL COMMENT '版本期数ID（如1.4第1期为141）',
  tid INT UNSIGNED NOT NULL COMMENT '游戏内ID（如69001）',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='期数ID映射表';

CREATE TABLE IF NOT EXISTS id_buff (
  id INT UNSIGNED NOT NULL COMMENT 'Buff ID（如14101=1.4第1期Buff1）',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '期数',
  buff_image VARCHAR(500) DEFAULT NULL COMMENT 'Buff图片',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Buff ID信息表';

CREATE TABLE IF NOT EXISTS date (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  mode VARCHAR(20) NOT NULL DEFAULT 'crisis' COMMENT 'crisis|defense',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '阶段',
  start_date DATE NOT NULL COMMENT '开始日期',
  end_date DATE NOT NULL COMMENT '结束日期',
  PRIMARY KEY (id),
  UNIQUE KEY uk_date_mode_version_phase (mode, version, phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日期表';

-- ---------------------------------------------------------------------------
-- 临界推演（版块 mode='deduction'）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deduction_node (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(50) NOT NULL,
  phase VARCHAR(50) NOT NULL DEFAULT '1',
  node_id VARCHAR(20) NOT NULL,
  node_name VARCHAR(100) NOT NULL DEFAULT '',
  node_type INT NOT NULL DEFAULT 0,
  prev_node VARCHAR(20) NOT NULL DEFAULT '',
  story_text TEXT NULL,
  layers_json JSON NULL,
  buffs_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  period_name VARCHAR(100) NOT NULL DEFAULT '' COMMENT '期数显示名，如 临界推演：歧路回响',
  PRIMARY KEY (id),
  UNIQUE KEY uk_dd_node (version, phase, node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临界推演节点（剧情/战斗）';

-- ---------------------------------------------------------------------------
-- 管理后台
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `admin` (
  id INT NOT NULL AUTO_INCREMENT COMMENT '主键',
  password VARCHAR(255) NOT NULL COMMENT '管理员密码',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账号';

-- ---------------------------------------------------------------------------
-- 伤害计算器（角色 / 邦布 / 驱动盘 / 音擎）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `character` (
  id VARCHAR(64) NOT NULL COMMENT '角色ID',
  name VARCHAR(255) NOT NULL COMMENT '角色名称',
  profession VARCHAR(50) NOT NULL DEFAULT '' COMMENT '职业',
  element VARCHAR(50) NOT NULL DEFAULT '' COMMENT '属性',
  support_needs JSON NOT NULL COMMENT '辅助需求属性数组',
  avatar_image VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  note TEXT NOT NULL COMMENT '角色注释',
  base_panel JSON NOT NULL COMMENT '基础面板属性',
  mindscape_notes JSON NOT NULL COMMENT '0-6影画注释数组',
  mindscape_buffs JSON NOT NULL COMMENT '0-6影画增益数组',
  raw_json JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色增益表';

CREATE TABLE IF NOT EXISTS `bangboo` (
  id VARCHAR(64) NOT NULL COMMENT '邦布ID',
  name VARCHAR(255) NOT NULL COMMENT '邦布名称',
  avatar_image VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  fixed_mods JSON NOT NULL COMMENT '固定增益',
  refinement_mods JSON NOT NULL COMMENT '精炼增益数组',
  raw_json JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邦布增益表';

CREATE TABLE IF NOT EXISTS `drive_disc` (
  id VARCHAR(64) NOT NULL COMMENT '驱动盘ID',
  name VARCHAR(255) NOT NULL COMMENT '驱动盘名称',
  avatar_image VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  two_piece_note TEXT NOT NULL COMMENT '2件套注释',
  four_piece_note TEXT NOT NULL COMMENT '4件套注释',
  two_piece_mods JSON NOT NULL COMMENT '2件套增益',
  four_piece_buffs JSON NOT NULL COMMENT '4件套自身/队友增益',
  raw_json JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='驱动盘增益表';

CREATE TABLE IF NOT EXISTS `W-Engine` (
  id VARCHAR(64) NOT NULL COMMENT '音擎ID',
  name VARCHAR(255) NOT NULL COMMENT '音擎名称',
  profession VARCHAR(50) NOT NULL DEFAULT '' COMMENT '职业',
  rarity VARCHAR(10) NOT NULL DEFAULT 'A' COMMENT '稀有度 S/A/B',
  avatar_image VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  note TEXT NOT NULL COMMENT '音擎注释',
  base_atk DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '基础攻击力',
  base_def DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '基础防御力（锋御音擎基础属性）',
  advanced_stats JSON NOT NULL COMMENT '高级属性',
  fixed_buffs JSON NOT NULL COMMENT '固定自身/队友增益',
  refinement_buffs JSON NOT NULL COMMENT '精炼1-5增益数组',
  raw_json JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='音擎增益表';

CREATE TABLE IF NOT EXISTS calculator_skill_subcategories (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  category_id VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='计算器招式小类';

-- 乘区定义：`zone_key` + 展示元数据 + 求值原语（白名单）+ 原语参数 + 可吃增益键
CREATE TABLE IF NOT EXISTS calculator_zone_definitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zone_key VARCHAR(64) NOT NULL COMMENT '乘区键：内置键（dmgMultiplier）或 custom:<slug>',
  label VARCHAR(100) NOT NULL COMMENT '展示名',
  sort_order INT NOT NULL DEFAULT 100 COMMENT '展示顺序',
  applies_to JSON NOT NULL COMMENT '适用范围 {damageKinds,agents,skills,providers}',
  primitive VARCHAR(64) NOT NULL COMMENT '求值原语（白名单）',
  params JSON NOT NULL COMMENT '原语参数',
  stats JSON NULL COMMENT '该乘区可吃的增益键',
  display JSON NULL COMMENT '展示配置',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  version INT NOT NULL DEFAULT 1 COMMENT '发布版本，服务端递增',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_zone_key (zone_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='计算器乘区定义';

-- 乘区方案：某作用域对定义的引用顺序与覆盖（rules 即方案文档里的 zones 数组）
CREATE TABLE IF NOT EXISTS calculator_zone_schemes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('global','profession','agent','skill_group','skill') NOT NULL COMMENT '作用域（global 最弱，skill 最强）',
  target_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '作用域目标：global 为空，其余为职业/角色/技能组/招式 id',
  name VARCHAR(100) NOT NULL COMMENT '方案名',
  priority INT NOT NULL DEFAULT 10 COMMENT '同作用域覆盖顺序',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  version INT NOT NULL DEFAULT 1 COMMENT '发布版本，服务端递增',
  rules JSON NOT NULL COMMENT '方案条目数组',
  updated_by VARCHAR(64) NULL COMMENT '最后修改人',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_scope_target (scope, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='计算器乘区方案';

-- 计算链路：chain_key + 作用域 + 有序阶段数组
CREATE TABLE IF NOT EXISTS calculator_damage_chains (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain_key VARCHAR(64) NOT NULL COMMENT '链路键：内置（direct/anomaly/radiance-self）或 custom:<slug>',
  label VARCHAR(100) NULL COMMENT '展示名',
  applies_to JSON NOT NULL COMMENT '命中条件 {damageKinds,subKinds?}',
  scope ENUM('global','profession','agent','skill_group','skill') NOT NULL COMMENT '作用域（与乘区方案同口径）',
  target_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '作用域目标：global 为空',
  priority INT NOT NULL DEFAULT 0 COMMENT '同作用域覆盖顺序',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  version INT NOT NULL DEFAULT 1 COMMENT '发布版本，服务端递增',
  stages JSON NOT NULL COMMENT '有序阶段数组',
  updated_by VARCHAR(64) NULL COMMENT '最后修改人',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chain_scope_target (chain_key, scope, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='计算器伤害计算链路';

-- ---------------------------------------------------------------------------
-- 站点更新日志
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS changelog (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  version VARCHAR(32) NOT NULL COMMENT '版本号，如 3.0.0',
  title VARCHAR(200) NOT NULL COMMENT '标题',
  content TEXT NOT NULL COMMENT '更新内容（纯文本，换行保留）',
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布日期',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_changelog_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站点更新日志';
