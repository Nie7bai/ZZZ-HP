import { ref } from 'vue'

const viewerOpen = ref(false)
const viewerUrls = ref<string[]>([])
const viewerIndex = ref(0)

export function useGuestbookMediaViewer() {
  function openMediaViewer(urls: string[], index = 0) {
    const list = urls.map((u) => String(u || '').trim()).filter(Boolean)
    if (!list.length) return
    viewerUrls.value = list
    viewerIndex.value = Math.min(Math.max(index, 0), list.length - 1)
    viewerOpen.value = true
  }

  function closeMediaViewer() {
    viewerOpen.value = false
  }

  return {
    viewerOpen,
    viewerUrls,
    viewerIndex,
    openMediaViewer,
    closeMediaViewer,
  }
}
