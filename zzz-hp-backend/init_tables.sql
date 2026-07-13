CREATE DATABASE IF NOT EXISTS zzz DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE zzz;

CREATE TABLE IF NOT EXISTS boss (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  version VARCHAR(50) NOT NULL COMMENT '版本',
  phase VARCHAR(50) NOT NULL COMMENT '阶段',
  boss_name VARCHAR(255) NOT NULL COMMENT 'Boss名称',
  hp INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '生命值',
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

ALTER TABLE boss MODIFY boss_name VARCHAR(255) NOT NULL;
ALTER TABLE boss_info MODIFY boss_name VARCHAR(255) NOT NULL;

INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
SELECT i.version, i.phase, '恶名·冥宁芙', 84171995, 0, 1, i.room,
       bi.weakness, bi.resistance, bi.boss_image
FROM id_info i
LEFT JOIN boss_info bi ON bi.boss_name = '恶名·冥宁芙'
WHERE i.id = 1721
  AND NOT EXISTS (
    SELECT 1 FROM boss b
    WHERE b.version = i.version
      AND b.phase = i.phase
      AND b.boss_name = '恶名·冥宁芙'
      AND b.room = i.room
  );

INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
SELECT i.version, i.phase, '恶名·思路屠夫', 102985418, 0, 1, i.room,
       bi.weakness, bi.resistance, bi.boss_image
FROM id_info i
LEFT JOIN boss_info bi ON bi.boss_name = '恶名·思路屠夫'
WHERE i.id = 1722
  AND NOT EXISTS (
    SELECT 1 FROM boss b
    WHERE b.version = i.version
      AND b.phase = i.phase
      AND b.boss_name = '恶名·思路屠夫'
      AND b.room = i.room
  );

INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
SELECT i.version, i.phase, '自律强袭单位·提丰·破坏者型', 82445155, 0, 1, i.room,
       bi.weakness, bi.resistance, bi.boss_image
FROM id_info i
LEFT JOIN boss_info bi ON bi.boss_name = '自律强袭单位·提丰·破坏者型'
WHERE i.id = 1723
  AND NOT EXISTS (
    SELECT 1 FROM boss b
    WHERE b.version = i.version
      AND b.phase = i.phase
      AND b.boss_name = '自律强袭单位·提丰·破坏者型'
      AND b.room = i.room
  );
