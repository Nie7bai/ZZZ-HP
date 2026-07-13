USE zzz;

INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
SELECT i.id, i.version, i.phase, bi.boss_name, 166774698, bi.defense, bi.level, i.room, bi.weakness, bi.resistance, bi.boss_image
FROM id_info i
JOIN boss_info bi ON bi.boss_name = '焚昼余火·法厄同'
WHERE i.id = 3031
  AND NOT EXISTS (SELECT 1 FROM boss b WHERE b.id = 3031);

INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
SELECT i.id, i.version, i.phase, bi.boss_name, 148233678, bi.defense, bi.level, i.room, bi.weakness, bi.resistance, bi.boss_image
FROM id_info i
JOIN boss_info bi ON bi.boss_name = '恶名·庞培'
WHERE i.id = 3032
  AND NOT EXISTS (SELECT 1 FROM boss b WHERE b.id = 3032);

INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
SELECT i.id, i.version, i.phase, bi.boss_name, 190465574, bi.defense, bi.level, i.room, bi.weakness, bi.resistance, bi.boss_image
FROM id_info i
JOIN boss_info bi ON bi.boss_name = '秽息妖鬼·名可名'
WHERE i.id = 3033
  AND NOT EXISTS (SELECT 1 FROM boss b WHERE b.id = 3033);
