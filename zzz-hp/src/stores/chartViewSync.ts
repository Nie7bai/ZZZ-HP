import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ChartViewMode = 'detail' | 'overview'

export interface ChartLinkedFocus {
  groupId: string
  sourceId: string
  phaseKey: string | null
  /** 详细模式横向滚动时的视口中心对应期数 */
  seq: number
}

export const useChartViewSyncStore = defineStore('chartViewSync', () => {
  const viewMode = ref<ChartViewMode>('detail')
  const hideDatesInOverview = ref(true)
  const linkedFocus = ref<ChartLinkedFocus | null>(null)
  let focusSeq = 0

  function setViewMode(mode: ChartViewMode) {
    viewMode.value = mode
    if (mode === 'overview') hideDatesInOverview.value = true
  }

  function broadcastLinkedFocus(groupId: string, sourceId: string, phaseKey: string | null) {
    focusSeq += 1
    linkedFocus.value = {
      groupId,
      sourceId,
      phaseKey,
      seq: focusSeq,
    }
  }

  return {
    viewMode,
    hideDatesInOverview,
    linkedFocus,
    setViewMode,
    broadcastLinkedFocus,
  }
})
