-- Calculator buff tables for zzz database
-- Complex nested buff payloads are stored as JSON to avoid data loss.

USE zzz;

CREATE TABLE IF NOT EXISTS `character` (
  `id` VARCHAR(64) NOT NULL COMMENT '角色ID',
  `name` VARCHAR(255) NOT NULL COMMENT '角色名称',
  `profession` VARCHAR(50) NOT NULL DEFAULT '' COMMENT '职业',
  `element` VARCHAR(50) NOT NULL DEFAULT '' COMMENT '属性',
  `support_needs` JSON NOT NULL COMMENT '辅助需求属性数组',
  `avatar_image` VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  `note` TEXT NOT NULL COMMENT '角色注释',
  `base_panel` JSON NOT NULL COMMENT '基础面板属性',
  `mindscape_notes` JSON NOT NULL COMMENT '0-6影画注释数组',
  `mindscape_buffs` JSON NOT NULL COMMENT '0-6影画增益数组',
  `raw_json` JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色增益表';

CREATE TABLE IF NOT EXISTS `bangboo` (
  `id` VARCHAR(64) NOT NULL COMMENT '邦布ID',
  `name` VARCHAR(255) NOT NULL COMMENT '邦布名称',
  `avatar_image` VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  `fixed_mods` JSON NOT NULL COMMENT '固定增益',
  `refinement_mods` JSON NOT NULL COMMENT '精炼增益数组',
  `raw_json` JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邦布增益表';

CREATE TABLE IF NOT EXISTS `drive_disc` (
  `id` VARCHAR(64) NOT NULL COMMENT '驱动盘ID',
  `name` VARCHAR(255) NOT NULL COMMENT '驱动盘名称',
  `avatar_image` VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  `two_piece_note` TEXT NOT NULL COMMENT '2件套注释',
  `four_piece_note` TEXT NOT NULL COMMENT '4件套注释',
  `two_piece_mods` JSON NOT NULL COMMENT '2件套增益',
  `four_piece_buffs` JSON NOT NULL COMMENT '4件套自身/队友增益',
  `raw_json` JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='驱动盘增益表';

CREATE TABLE IF NOT EXISTS `W-Engine` (
  `id` VARCHAR(64) NOT NULL COMMENT '音擎ID',
  `name` VARCHAR(255) NOT NULL COMMENT '音擎名称',
  `profession` VARCHAR(50) NOT NULL DEFAULT '' COMMENT '职业',
  `rarity` VARCHAR(10) NOT NULL DEFAULT 'A' COMMENT '稀有度 S/A/B',
  `avatar_image` VARCHAR(500) DEFAULT NULL COMMENT '头像路径',
  `note` TEXT NOT NULL COMMENT '音擎注释',
  `base_atk` DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '基础攻击力',
  `advanced_stats` JSON NOT NULL COMMENT '高级属性',
  `fixed_buffs` JSON NOT NULL COMMENT '固定自身/队友增益',
  `refinement_buffs` JSON NOT NULL COMMENT '精炼1-5增益数组',
  `raw_json` JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='音擎增益表';
