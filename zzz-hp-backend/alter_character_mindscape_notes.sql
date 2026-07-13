-- Add per-rank mindscape notes to character table
USE zzz;

ALTER TABLE `character`
  ADD COLUMN IF NOT EXISTS `mindscape_notes` JSON NOT NULL
    COMMENT '0-6影画注释数组'
    AFTER `note`;

-- MySQL 8.0.12 may not support IF NOT EXISTS on ADD COLUMN; fallback for older versions:
-- Run only if column missing:
-- ALTER TABLE `character` ADD COLUMN `mindscape_notes` JSON NOT NULL COMMENT '0-6影画注释数组' AFTER `note`;

UPDATE `character`
SET mindscape_notes = JSON_ARRAY('', '', '', '', '', '', '')
WHERE mindscape_notes IS NULL;
