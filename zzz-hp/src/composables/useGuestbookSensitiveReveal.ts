import { ref, type InjectionKey } from 'vue'

export interface GuestbookSensitiveRevealApi {
  shouldBlurPost: (postId: number, isSensitive?: boolean) => boolean
  revealPost: (postId: number) => void
}

export const GUESTBOOK_SENSITIVE_REVEAL_KEY: InjectionKey<GuestbookSensitiveRevealApi> =
  Symbol('guestbookSensitiveReveal')

export function useGuestbookSensitiveReveal() {
  const revealedIds = ref<Set<number>>(new Set())

  function shouldBlurPost(postId: number, isSensitive?: boolean) {
    return Boolean(isSensitive && !revealedIds.value.has(postId))
  }

  function revealPost(postId: number) {
    if (revealedIds.value.has(postId)) return
    const next = new Set(revealedIds.value)
    next.add(postId)
    revealedIds.value = next
  }

  return { revealedIds, shouldBlurPost, revealPost }
}
