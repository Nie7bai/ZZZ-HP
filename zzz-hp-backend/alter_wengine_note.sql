-- Add note column to W-Engine table
USE zzz;

ALTER TABLE `W-Engine`
  ADD COLUMN IF NOT EXISTS `note` TEXT NOT NULL COMMENT '音擎注释' AFTER `avatar_image`;

UPDATE `W-Engine`
SET note = ''
WHERE note IS NULL;
