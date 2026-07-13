import { ref } from 'vue'
import type { HpChartPoint } from '@/api/crisisAssault'

export function usePhaseDetailModal() {
  const visible = ref(false)
  const point = ref<HpChartPoint | null>(null)

  function open(selected: HpChartPoint) {
    point.value = selected
    visible.value = true
  }

  function close() {
    visible.value = false
  }

  return { visible, point, open, close }
}
