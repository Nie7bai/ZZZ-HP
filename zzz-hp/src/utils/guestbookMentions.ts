import type { GuestbookSocialUser } from '@/api/guestbook'

export const MENTION_TOKEN_REGEX = /@\[([^\[\]\n]{1,40})\]\((\d{1,10})\)/g

const mentionAvatarCache = new Map<number, string>()

export function cacheMentionAvatar(userId: number, avatar?: string) {
  if (avatar) mentionAvatarCache.set(userId, avatar)
}

export function getMentionAvatar(userId: number) {
  return mentionAvatarCache.get(userId) || ''
}

export function buildMentionToken(
  name: string,
  userId: number,
  avatar?: string,
) {
  cacheMentionAvatar(userId, avatar)
  const safeName = (name || '绳网旅人').slice(0, 40).replace(/[\[\]\n]/g, '')
  return `@[${safeName}](${userId})`
}

export function parseMentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret)
  if (/@\[[^\]]*$/.test(before)) return null
  const match = before.match(/@([^\s@\[\]]{0,20})$/)
  if (!match) return null
  return match[1] || ''
}

export function applyMention(
  text: string,
  caret: number,
  user: Pick<GuestbookSocialUser, 'id' | 'nickname' | 'avatar'>,
) {
  const before = text.slice(0, caret)
  const after = text.slice(caret)
  const atIndex = before.lastIndexOf('@')
  if (atIndex < 0) return { text, caret }
  const token = buildMentionToken(user.nickname, user.id, user.avatar)
  const nextText = `${before.slice(0, atIndex)}${token} ${after}`
  const nextCaret = atIndex + token.length + 1
  return { text: nextText, caret: nextCaret }
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; name: string; userId: number }

export function splitContentWithMentions(content: string): MentionSegment[] {
  if (!content) return []
  const re = new RegExp(MENTION_TOKEN_REGEX.source, MENTION_TOKEN_REGEX.flags)
  const segments: MentionSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: 'text', value: content.slice(cursor, match.index) })
    }
    segments.push({
      type: 'mention',
      name: match[1] || '',
      userId: Number(match[2]),
    })
    cursor = match.index + match[0].length
  }
  if (cursor < content.length) {
    segments.push({ type: 'text', value: content.slice(cursor) })
  }
  if (!segments.length) segments.push({ type: 'text', value: content })
  return segments
}

export function stripMentionsToPlain(content: string) {
  if (!content) return ''
  return content.replace(
    new RegExp(MENTION_TOKEN_REGEX.source, MENTION_TOKEN_REGEX.flags),
    (_m, name: string) => `@${name}`,
  )
}

export function renderMentionHtml(content: string) {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(
      new RegExp(MENTION_TOKEN_REGEX.source, MENTION_TOKEN_REGEX.flags),
      (_m, name: string) => `<span class="gb-mention">@${name}</span>`,
    )
    .replace(/@(\d{1,10})\b/g, '<span class="gb-mention">@$1</span>')
}
