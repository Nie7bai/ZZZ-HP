/** 危局血量系数：round(bossHp / baseHp * 100)，展示为整数百分比 */

export const CRISIS_BASE_HP_BY_NAME: Record<string, number> = {
  亵渎者: 70729255,
  初生死路屠夫: 37312835,
  '初生·死路屠夫': 37312835,
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

export function getCrisisBaseHpByName(bossName: string): number | null {
  const name = String(bossName ?? '').trim()
  if (!name) return null
  return Object.prototype.hasOwnProperty.call(CRISIS_BASE_HP_BY_NAME, name)
    ? CRISIS_BASE_HP_BY_NAME[name]!
    : null
}

export function calcCrisisHpCoeffPercent(bossHp: number, baseHp: number | null | undefined): number | null {
  const hp = Number(bossHp)
  const base = Number(baseHp)
  if (!Number.isFinite(hp) || !Number.isFinite(base) || base <= 0) return null
  return Math.round((hp / base) * 100)
}

export function formatCrisisHpCoeffPercent(percent: number | null | undefined): string | null {
  if (percent == null || !Number.isFinite(Number(percent))) return null
  return `${Math.round(Number(percent))}%`
}
