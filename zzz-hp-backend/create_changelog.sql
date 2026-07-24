-- 更新日志表（已有库可单独执行建表；初始文案请用 scripts/seed_changelog.mjs 写入以防编码损坏）
USE zzz;

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
