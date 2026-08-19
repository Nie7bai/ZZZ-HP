-- 临界推演（deduction）节点表
-- 节点图结构：剧情/开场节点含 story_text；战斗/最终战节点含 layers_json（层+怪物）与 buffs_json（可选增益）
-- 怪物/增益的平铺数据在 boss / buff 表（mode='deduction'）

USE zzz;

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
