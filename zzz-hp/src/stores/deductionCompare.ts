import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 临界推演 Buff 对比共享选择（总览「加入对比」与对比面板共用）。
 * 推演 Buff 跨战斗节点同名去重：总览/对比都只认每个（期数+节点名）的首个条目。
 */
export const useDeductionCompareStore = defineStore('deductionCompare', () => {
  const selectedBuffIds = ref<string[]>([])

  function addBuffId(id: string) {
    if (selectedBuffIds.value.includes(id)) return false
    selectedBuffIds.value = [...selectedBuffIds.value, id]
    return true
  }

  function hasBuffId(id: string) {
    return selectedBuffIds.value.includes(id)
  }

  function removeBuffId(id: string) {
    selectedBuffIds.value = selectedBuffIds.value.filter((item) => item !== id)
  }

  function clear() {
    selectedBuffIds.value = []
  }

  return { selectedBuffIds, addBuffId, hasBuffId, removeBuffId, clear }
})
