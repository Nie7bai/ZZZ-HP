export function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function linkifyPlainText(text: string) {
  const escaped = escapeHtml(text)
  return escaped.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  )
}
