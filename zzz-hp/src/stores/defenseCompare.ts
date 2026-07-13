import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'zzz-hp-defense-compare'

interface CompareCache {
  selectedBuffIds: string[]
  selectedPhaseLabels: string[]
}

function readCache(): CompareCache {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { selectedBuffIds: [], selectedPhaseLabels: [] }
    }

    const parsed = JSON.parse(raw) as Partial<CompareCache>
    return {
      selectedBuffIds: Array.isArray(parsed.selectedBuffIds) ? parsed.selectedBuffIds : [],
      selectedPhaseLabels: Array.isArray(parsed.selectedPhaseLabels)
        ? parsed.selectedPhaseLabels
        : [],
    }
  } catch {
    return { selectedBuffIds: [], selectedPhaseLabels: [] }
  }
}

function writeCache(cache: CompareCache) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
}

export const useDefenseCompareStore = defineStore('defenseCompare', () => {
  const initial = readCache()
  const selectedBuffIds = ref<string[]>([...initial.selectedBuffIds])
  const selectedPhaseLabels = ref<string[]>([...initial.selectedPhaseLabels])

  watch(
    [selectedBuffIds, selectedPhaseLabels],
    () => {
      writeCache({
        selectedBuffIds: selectedBuffIds.value,
        selectedPhaseLabels: selectedPhaseLabels.value,
      })
    },
    { deep: true },
  )

  function clear() {
    selectedBuffIds.value = []
    selectedPhaseLabels.value = []
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
    clear,
    addBuffId,
    hasBuffId,
  }
})
