export const GUESTBOOK_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔',
  '😅', '😭', '😡', '🥺', '😴', '🤯', '😱', '👍', '👎', '👏',
  '🙏', '💪', '✌️', '🤝', '❤️', '🔥', '⭐', '✨', '🎉', '💯',
  'ZZZ', '🎮', '⚡', '🍜', '🐶', '🐱', '🦊', '🐻', '🐼', '🐸',
] as const

export function insertAtCursor(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const next = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`
  el.value = next
  const pos = start + text.length
  el.setSelectionRange(pos, pos)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
}
