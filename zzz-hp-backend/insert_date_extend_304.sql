USE zzz;

INSERT INTO `date` (id, version, phase, start_date, end_date) VALUES
(304, '3.0', '4', '2026-07-29', '2026-08-12')
ON DUPLICATE KEY UPDATE
  version = VALUES(version),
  phase = VALUES(phase),
  start_date = VALUES(start_date),
  end_date = VALUES(end_date);
