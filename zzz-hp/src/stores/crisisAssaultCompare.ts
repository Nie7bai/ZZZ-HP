import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'zzz-hp-crisis-assault-compare'

interface CompareCache {
  selectedBuffIds: string[]
  selectedPhaseLabels: string[]
  selectedHardPhaseLabels: string[]
}

function readCache(): CompareCache {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { selectedBuffIds: [], selectedPhaseLabels: [], selectedHardPhaseLabels: [] }
    }

    const parsed = JSON.parse(raw) as Partial<CompareCache>
    return {
      selectedBuffIds: Array.isArray(parsed.selectedBuffIds) ? parsed.selectedBuffIds : [],
      selectedPhaseLabels: Array.isArray(parsed.selectedPhaseLabels)
        ? parsed.selectedPhaseLabels
        : [],
      selectedHardPhaseLabels: Array.isArray(parsed.selectedHardPhaseLabels)
        ? parsed.selectedHardPhaseLabels
        : [],
    }
  } catch {
    return { selectedBuffIds: [], selectedPhaseLabels: [], selectedHardPhaseLabels: [] }
  }
}

function writeCache(cache: CompareCache) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
}

export const useCrisisAssaultCompareStore = defineStore('crisisAssaultCompare', () => {
  const initial = readCache()
  const selectedBuffIds = ref<string[]>([...initial.selectedBuffIds])
  const selectedPhaseLabels = ref<string[]>([...initial.selectedPhaseLabels])
  const selectedHardPhaseLabels = ref<string[]>([...initial.selectedHardPhaseLabels])

  watch(
    [selectedBuffIds, selectedPhaseLabels, selectedHardPhaseLabels],
    () => {
      writeCache({
        selectedBuffIds: selectedBuffIds.value,
        selectedPhaseLabels: selectedPhaseLabels.value,
        selectedHardPhaseLabels: selectedHardPhaseLabels.value,
      })
    },
    { deep: true },
  )

  function clear() {
    selectedBuffIds.value = []
    selectedPhaseLabels.value = []
    selectedHardPhaseLabels.value = []
    sessionStorage.removeItem(STORAGE_KEY)
  }

  function addBuffId(id: string) {
    if (selectedBuffIds.value.includes(id)) return false
    selectedBuffIds.value = [...selectedBuffIds.value, id]
    return true
  }

  function hasBuffId(id: string) {
    return selectedBuffIds.value.includes(id)
  }

  return {
    selectedBuffIds,
    selectedPhaseLabels,
    selectedHardPhaseLabels,
    clear,
    addBuffId,
    hasBuffId,
  }
})
