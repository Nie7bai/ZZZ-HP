/** 怪物危局基础血量（按完整名称匹配） */
export const CRISIS_BASE_HP_BY_NAME = {
  亵渎者: 70729255,
  初生死路屠夫: 37312835,
  '叛律孤歌·薇斯珀': 114805556,
  基塔布鲁: 87632502,
  '太初梦魇·始主': 105729812.5,
  '恶名·死路屠夫': 44776269,
  彷徨猎手: 87261932,
  '恶名·冥宁芙': 58049652,
  '恶名·庞培': 44919296,
  未知复合侵蚀体: 48505819,
  '焚昼余火·法厄同': 90148485.5,
  '牲鬼·布林格': 44919296,
  猎血清道夫: 131704469,
  秽息司祭: 91370720,
  '秽息妖鬼·名可名': 65677784,
  '自律强袭单位·提丰·破坏者型': 51208171,
  '霸主侵蚀体·庞培': 44919296,
  '魇缚者·叶释渊': 89725904.5,
}

export function getCrisisBaseHpByName(bossName) {
  const name = String(bossName ?? '').trim()
  if (!name) return null
  if (Object.prototype.hasOwnProperty.call(CRISIS_BASE_HP_BY_NAME, name)) {
    return CRISIS_BASE_HP_BY_NAME[name]
  }
  return null
}

/** 危局血量系数（整数百分比）：round(bossHp / baseHp * 100) */
export function calcCrisisHpCoeffPercent(bossHp, baseHp) {
  const hp = Number(bossHp)
  const base = Number(baseHp)
  if (!Number.isFinite(hp) || !Number.isFinite(base) || base <= 0) return null
  return Math.round((hp / base) * 100)
}

/**
 * 解析最终展示用系数：手动优先，否则按血量/基础血量自动计算
 * @returns {{ percent: number|null, manual: boolean, autoPercent: number|null }}
 */
export function resolveCrisisHpCoeff({
  bossHp,
  baseHp,
  manualPercent = null,
}) {
  const autoPercent = calcCrisisHpCoeffPercent(bossHp, baseHp)
  const manual =
    manualPercent != null &&
    manualPercent !== '' &&
    Number.isFinite(Number(manualPercent))
      ? Math.round(Number(manualPercent))
      : null

  if (manual != null) {
    return { percent: manual, manual: true, autoPercent }
  }
  return { percent: autoPercent, manual: false, autoPercent }
}

export function formatCrisisHpCoeffPercent(percent) {
  if (percent == null || !Number.isFinite(Number(percent))) return null
  return `${Math.round(Number(percent))}%`
}
