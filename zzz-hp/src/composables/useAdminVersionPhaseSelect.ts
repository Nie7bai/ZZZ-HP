import { computed, onMounted, ref, watch, type Ref } from 'vue'
import {
  fetchSeasonDates,
  searchBossRecords,
  searchBuffRecords,
  type SeasonDateMode,
} from '@/api/admin'
import { fetchDeductionAdminPeriods } from '@/api/deductionAdmin'
import type { AdminScope } from '@/types/admin'
import { isDefenseScope, isDeductionScope, recordSchemeFromScope } from '@/types/admin'

export type AdminVersionPhaseSource = 'boss' | 'buff' | 'both'

function compareVersionDesc(a: string, b: string) {
  const parse = (value: string) =>
    value.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0)
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function normalizePhase(phase: string | number) {
  const text = String(phase ?? '').trim()
  return text.replace(/\D/g, '') || text
}

/** 管理后台版本/期数：下拉 + 自定义输入（与添加怪物一致） */
export function useAdminVersionPhaseSelect(
  scope: Ref<AdminScope>,
  options: { source?: AdminVersionPhaseSource; autoDefault?: boolean } = {},
) {
  const source = options.source ?? 'both'
  const autoDefault = options.autoDefault !== false

  const version = ref('')
  const phase = ref('')
  const customVersion = ref('')
  const customPhase = ref('')
  const knownVersionPhases = ref<Array<{ version: string; phase: string }>>([])
  const loadingOptions = ref(false)

  const seasonMode = computed<SeasonDateMode>(() => {
    if (isDefenseScope(scope.value)) return 'defense'
    if (isDeductionScope(scope.value)) return 'deduction'
    return 'crisis'
  })

  const resolvedVersion = computed(() => customVersion.value.trim() || version.value.trim())
  const resolvedPhase = computed(() => customPhase.value.trim() || phase.value.trim())

  const availableVersions = computed(() => {
    const set = new Set(knownVersionPhases.value.map((item) => item.version).filter(Boolean))
    return [...set].sort(compareVersionDesc)
  })

  const availablePhases = computed(() => {
    const currentVersion = resolvedVersion.value
    if (!currentVersion) return []
    const set = new Set(
      knownVersionPhases.value
        .filter((item) => item.version === currentVersion)
        .map((item) => normalizePhase(item.phase))
        .filter(Boolean),
    )
    return [...set].sort((a, b) => Number(b) - Number(a))
  })

  function applyDefaultVersionPhase() {
    if (!autoDefault) return
    const latestVersion = availableVersions.value[0] ?? ''
    if (!version.value && latestVersion) version.value = latestVersion
    const phases = availablePhases.value
    if (!normalizePhase(phase.value) && !customPhase.value.trim() && phases.length) {
      phase.value = phases[0] ?? ''
    }
  }

  async function loadVersionPhaseOptions() {
    loadingOptions.value = true
    try {
      if (isDeductionScope(scope.value)) {
        // 推演：期数以 deduction_node 为准（含刚新建的期数），phase 恒为 1
        const periods = await fetchDeductionAdminPeriods()
        knownVersionPhases.value = periods.map((row) => ({
          version: String(row.version),
          phase: String(row.phase ?? '1') || '1',
        }))
        applyDefaultVersionPhase()
        return
      }
      const scheme = recordSchemeFromScope(scope.value)
      const tasks: Array<Promise<Array<{ version: string; phase: string }>>> = [
        fetchSeasonDates(seasonMode.value).then((rows) =>
          rows.map((row) => ({ version: row.version, phase: String(row.phase) })),
        ),
      ]

      if (scheme && (source === 'boss' || source === 'both')) {
        tasks.push(
          searchBossRecords({ recordScheme: scheme, limit: 1000 }).then((rows) =>
            rows.map((row) => ({ version: row.version, phase: String(row.phase) })),
          ),
        )
      }
      if (scheme && (source === 'buff' || source === 'both')) {
        tasks.push(
          searchBuffRecords({ recordScheme: scheme, limit: 1000 }).then((rows) =>
            rows.map((row) => ({ version: row.version, phase: String(row.phase) })),
          ),
        )
      }

      const parts = await Promise.all(tasks)
      knownVersionPhases.value = parts.flat()
      applyDefaultVersionPhase()
    } catch {
      knownVersionPhases.value = []
    } finally {
      loadingOptions.value = false
    }
  }

  function keepVersionPhaseAfterSubmit() {
    const keptVersion = resolvedVersion.value
    const keptPhase = normalizePhase(resolvedPhase.value)
    version.value = keptVersion
    phase.value = keptPhase
    customVersion.value = ''
    customPhase.value = ''
    if (keptPhase && !availablePhases.value.includes(keptPhase)) {
      customPhase.value = keptPhase
      phase.value = ''
    }
  }

  watch([version, customVersion], () => {
    const phases = availablePhases.value
    const current = normalizePhase(phase.value || customPhase.value)
    if (current && phases.includes(current)) {
      phase.value = current
      if (normalizePhase(customPhase.value) === current) customPhase.value = ''
      return
    }
    // 当前期数不在下拉中时保留原值，切勿跳到最新一期
    if (current) {
      phase.value = ''
      customPhase.value = current
      return
    }
    if (autoDefault && phases.length) {
      phase.value = phases[0] ?? ''
    }
  })

  watch(
    () => scope.value,
    () => {
      version.value = ''
      phase.value = ''
      customVersion.value = ''
      customPhase.value = ''
      void loadVersionPhaseOptions()
    },
  )

  onMounted(() => {
    void loadVersionPhaseOptions()
  })

  return {
    version,
    phase,
    customVersion,
    customPhase,
    resolvedVersion,
    resolvedPhase,
    availableVersions,
    availablePhases,
    loadingOptions,
    loadVersionPhaseOptions,
    keepVersionPhaseAfterSubmit,
  }
}
