USE zzz;

ALTER TABLE id_buff
  ADD COLUMN buff_image VARCHAR(500) DEFAULT NULL COMMENT 'Buff图片' AFTER phase;

UPDATE id_buff
SET buff_image = CONCAT('/buff_image/', CONCAT(LEFT(id, 3), RIGHT(id, 1)), '.webp');
