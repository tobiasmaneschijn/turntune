import type { ChatMention } from './model'
import type { User } from '../../types'

export interface MentionQuery {
  start: number
  end: number
  query: string
}

export interface RoomMentionOption {
  user: User
  mention: ChatMention
}

export interface MentionTextPart {
  text: string
  mention?: ChatMention
}

export function baseMentionHandle(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 40) || 'listener'
}

export function buildRoomMentionOptions(users: User[], currentUserId: string): RoomMentionOption[] {
  const candidates = users.filter((user) => user.id !== currentUserId)
  const bases = candidates.map((user) => baseMentionHandle(user.name))
  const counts = new Map<string, number>()
  for (const base of bases) counts.set(base.toLocaleLowerCase(), (counts.get(base.toLocaleLowerCase()) || 0) + 1)

  return candidates.map((user, index) => {
    const base = bases[index]
    const duplicate = (counts.get(base.toLocaleLowerCase()) || 0) > 1
    const suffix = user.id.replaceAll('-', '').slice(0, 4)
    return {
      user,
      mention: {
        userId: user.id,
        userName: user.name,
        handle: duplicate ? `${base}_${suffix}` : base,
      },
    }
  })
}

export function findMentionQuery(text: string, caret: number | null): MentionQuery | null {
  const end = caret ?? text.length
  const prefix = text.slice(0, end)
  const match = prefix.match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u)
  if (!match) return null
  return { start: prefix.lastIndexOf('@'), end, query: match[1] }
}

export function insertMention(
  text: string,
  query: MentionQuery,
  mention: ChatMention
): { text: string; caret: number } {
  const inserted = `@${mention.handle} `
  const suffixStart = /\s/.test(text[query.end] || '') ? query.end + 1 : query.end
  const nextText = `${text.slice(0, query.start)}${inserted}${text.slice(suffixStart)}`
  return { text: nextText, caret: query.start + inserted.length }
}

export function activeMentions(text: string, mentions: ChatMention[]): ChatMention[] {
  return mentions.filter((mention) => {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(mention.handle)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu')
    return pattern.test(text)
  })
}

export function normalizeChatMentions(value: unknown): ChatMention[] {
  if (!Array.isArray(value)) return []
  const mentions: ChatMention[] = []
  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    if (
      typeof candidate.userId !== 'string' || candidate.userId.length > 100 ||
      typeof candidate.userName !== 'string' || candidate.userName.length < 1 || candidate.userName.length > 32 ||
      typeof candidate.handle !== 'string' || candidate.handle.length < 1 || candidate.handle.length > 48 ||
      !/^[\p{L}\p{N}_-]+$/u.test(candidate.handle)
    ) continue
    mentions.push({
      userId: candidate.userId,
      userName: candidate.userName,
      handle: candidate.handle,
    })
  }
  return mentions
}

export function splitMentionText(text: string, mentions: ChatMention[]): MentionTextPart[] {
  const byHandle = new Map(mentions.map((mention) => [mention.handle.toLocaleLowerCase(), mention]))
  if (!byHandle.size) return [{ text }]
  const handles = [...byHandle.keys()].sort((left, right) => right.length - left.length).map(escapeRegExp)
  const pattern = new RegExp(`@(${handles.join('|')})(?=$|[^\\p{L}\\p{N}_-])`, 'giu')
  const parts: MentionTextPart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ text: text.slice(cursor, index) })
    const mention = byHandle.get(match[1].toLocaleLowerCase())
    parts.push({ text: match[0], mention })
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts.length ? parts : [{ text }]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
