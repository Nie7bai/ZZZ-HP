-- ZZZ-HP 数据库结构初始化（一次性执行）
-- 用法：mysql -u root -p < init_schema.sql
-- 或在 MySQL 客户端中：SOURCE /path/to/init_schema.sql;
--
-- 说明：
-- - 仅创建库与表结构，不含业务数据
-- - 数据导入请使用 insert_*.sql 或 scripts/ 下的导入脚本

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
  boss_image VARCHAR(500) DEFAULT NULL COMMENT 'Boss图片',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Boss表';

CREATE TABLE IF NOT EXISTS buff (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '阶段',
  buff_name VARCHAR(100) NOT NULL COMMENT 'Buff名称',
  buff TEXT DEFAULT NULL COMMENT 'Buff效果描述',
  buff_image VARCHAR(500) DEFAULT NULL COMMENT 'Buff图片',
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
  crisis_base_hp DOUBLE NULL COMMENT '怪物危局基础血量',
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

-- ---------------------------------------------------------------------------
-- 首页留言板
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guestbook (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nickname VARCHAR(40) NOT NULL DEFAULT '匿名' COMMENT '昵称',
  title VARCHAR(80) NOT NULL DEFAULT '' COMMENT '标题',
  category VARCHAR(20) NOT NULL DEFAULT '灌水' COMMENT '分类',
  content VARCHAR(1000) NOT NULL COMMENT '留言内容',
  is_hidden TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=隐藏，前台不展示',
  is_anonymous TINYINT(1) NOT NULL DEFAULT 0 COMMENT '匿名发布',
  is_sensitive TINYINT(1) NOT NULL DEFAULT 0 COMMENT '敏感内容（图片默认模糊）',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_guestbook_visible_created (is_hidden, created_at),
  KEY idx_guestbook_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页留言板';

CREATE TABLE IF NOT EXISTS guestbook_comment (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id INT UNSIGNED NOT NULL COMMENT '所属帖子',
  nickname VARCHAR(40) NOT NULL DEFAULT '匿名' COMMENT '昵称',
  content VARCHAR(1000) NOT NULL COMMENT '评论内容',
  is_hidden TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=隐藏',
  is_anonymous TINYINT(1) NOT NULL DEFAULT 0 COMMENT '匿名评论',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gb_comment_post_created (post_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='留言板评论';

CREATE TABLE IF NOT EXISTS guestbook_setting (
  setting_key VARCHAR(64) NOT NULL,
  setting_value VARCHAR(255) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='留言板设置';
