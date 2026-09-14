-- 官方预设词条库（zzz 库）
-- 口径：官方预设的唯一来源＝数据库，管理员维护；用户自己的词条库仍在浏览器 localStorage。
-- 用户 2026-09-12 拍板：「官方预设，管理员(或开发者)能改，用户改不了，只能基于这个备份新建」。
--
-- ⚠️ id 一旦发布不可改名：用户本地的 enabledOverride / overrides / removedEntryIds 都按 id 索引，
--    改名会让用户已存的启用状态、每档覆盖、删除记录全部失配。

USE zzz;

CREATE TABLE IF NOT EXISTS `affix_preset_entry` (
  `id` VARCHAR(64) NOT NULL COMMENT '条目 ID（稳定，不可改名）',
  `label` VARCHAR(255) NOT NULL COMMENT '显示名（自由文本，如「爆伤 48%」）',
  `target` VARCHAR(64) NOT NULL COMMENT '实际效果落点：stat:<AffixCounts 字段> / panel:<面板字段> / gain:<增益字段>',
  `per_roll` DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '每档增量',
  `cap` INT NOT NULL DEFAULT 0 COMMENT '该条最大档数，0 = 不设上限',
  `group_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '所属分组名（对应 affix_preset_group.name）',
  `roll_cost` INT NOT NULL DEFAULT 1 COMMENT '每档占用的总词条数预算',
  `enabled_by_default` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '新用户默认是否参与计算',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同组内排序',
  `raw_json` JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  `effect_json` JSON NULL COMMENT '版本化效果模板（读新优先；旧 target 仍写、仍回退）',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group_sort` (`group_name`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='官方预设词条条目';

CREATE TABLE IF NOT EXISTS `affix_preset_group` (
  `name` VARCHAR(64) NOT NULL COMMENT '分组名',
  `cap` INT NOT NULL DEFAULT 0 COMMENT '组额度：组内各条档数之和的上限，0 = 不限',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '展示顺序',
  `raw_json` JSON NOT NULL COMMENT '原始完整文档，防丢字段',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='官方预设词条分组';
