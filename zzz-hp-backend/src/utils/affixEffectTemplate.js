/**
 * 官方预设词条条目的版本化效果模板（`effect_json`）。
 *
 * 前端权威在 `zzz-hp/src/utils/affixEffectTemplate.ts`。这里只服务端回填 / 写库用，
 * 规则必须对得上：十格形态的 panel: 字段 → count；其余 panel:/gain: → effect spec。
 */

export const AFFIX_EFFECT_TEMPLATE_VERSION = 1

const PERCENT_OF_BASE_FIELDS = new Set(['anomalyControl', 'energyRegen'])

function conditionsFromEntry(entry) {
  const conditions = {}
  if (entry.applySituation) conditions.applySituation = entry.applySituation
  if (entry.scope) conditions.scope = entry.scope
  if (entry.skillCategory) {
    conditions.skillTargets = [
      { category: entry.skillCategory, subcategoryId: entry.skillSubcategoryId ?? null },
    ]
  }
  if (typeof entry.appliesToAnomaly === 'boolean') {
    conditions.appliesToAnomaly = entry.appliesToAnomaly
  }
  return conditions
}

export function buildAffixEffectTemplate(entry) {
  const target = String(entry?.target ?? '').trim()
  const COUNT_FIELDS = new Set([
    'hpFlat',
    'hpPercent',
    'atkFlat',
    'atkPercent',
    'defFlat',
    'defPercent',
    'pen',
    'critRate',
    'critDmg',
  ])
  if (target.startsWith('panel:')) {
    const field = target.slice('panel:'.length)
    if (COUNT_FIELDS.has(field)) {
      return {
        version: AFFIX_EFFECT_TEMPLATE_VERSION,
        allocation: 'count',
        legacyTarget: target,
      }
    }
  }
  if (!target.startsWith('panel:') && !target.startsWith('gain:')) return null
  const field = target.slice(target.indexOf(':') + 1)
  if (!field) return null
  return {
    version: AFFIX_EFFECT_TEMPLATE_VERSION,
    allocation: 'effect',
    legacyTarget: target,
    spec: {
      version: 1,
      stat: field,
      operation: PERCENT_OF_BASE_FIELDS.has(field) ? 'percentOfBase' : 'add',
      stage: target.startsWith('gain:') ? 'combatPreConvert' : 'external',
      beneficiary: 'self',
      conditions: conditionsFromEntry(entry),
    },
  }
}

export function parseAffixEffectTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.version !== AFFIX_EFFECT_TEMPLATE_VERSION) return null
  if (typeof raw.legacyTarget !== 'string' || !raw.legacyTarget) return null
  if (raw.allocation === 'count') {
    return {
      version: AFFIX_EFFECT_TEMPLATE_VERSION,
      allocation: 'count',
      legacyTarget: raw.legacyTarget,
    }
  }
  if (raw.allocation !== 'effect' || !raw.spec || typeof raw.spec !== 'object') return null
  return {
    version: AFFIX_EFFECT_TEMPLATE_VERSION,
    allocation: 'effect',
    legacyTarget: raw.legacyTarget,
    spec: raw.spec,
  }
}
