import type { GuestbookSocialUser } from '@/api/guestbook'

const RECENT_MENTIONS_KEY = 'zzz-hp-gb-recent-mentions'
const RECENT_MAX = 12

export function loadRecentMentions(): GuestbookSocialUser[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_MENTIONS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is GuestbookSocialUser => Boolean(item && typeof item.id === 'number'))
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

export function pushRecentMention(user: GuestbookSocialUser) {
  const next = [
    user,
    ...loadRecentMentions().filter((item) => item.id !== user.id),
  ].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_MENTIONS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function fuzzyMatchUser(user: GuestbookSocialUser, query: string) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const nickname = String(user.nickname || '').toLowerCase()
  const id = String(user.id)
  if (nickname.includes(q) || id.includes(q)) return true
  return [...q].every((ch) => nickname.includes(ch))
}

export function dedupeUsers(users: GuestbookSocialUser[]) {
  const seen = new Set<number>()
  const result: GuestbookSocialUser[] = []
  for (const user of users) {
    if (!user?.id || seen.has(user.id)) continue
    seen.add(user.id)
    result.push(user)
  }
  return result
}

export function mergeMentionSearchResults(
  query: string,
  recent: GuestbookSocialUser[],
  following: GuestbookSocialUser[],
  remote: GuestbookSocialUser[],
) {
  const q = String(query || '').trim()
  if (!q) {
    return {
      recent: dedupeUsers(recent),
      following: dedupeUsers(following).filter(
        (user) => !recent.some((item) => item.id === user.id),
      ),
      remote: [] as GuestbookSocialUser[],
    }
  }
  const local = dedupeUsers([
    ...recent.filter((user) => fuzzyMatchUser(user, q)),
    ...following.filter((user) => fuzzyMatchUser(user, q)),
  ])
  const remoteFiltered = dedupeUsers(remote).filter(
    (user) => !local.some((item) => item.id === user.id),
  )
  return {
    recent: local,
    following: [] as GuestbookSocialUser[],
    remote: remoteFiltered,
  }
}
