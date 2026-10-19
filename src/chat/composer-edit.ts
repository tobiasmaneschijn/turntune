import { activeMentions } from './mentions'
import type { ChatMention } from './model'

/** Selection offsets follow textarea UTF-16 offsets, including multiline drafts. */
export function insertComposerText(text: string, insertion: string, start: number, end: number, mentions: ChatMention[], limit = 500) {
  const from = Math.max(0, Math.min(text.length, start))
  const to = Math.max(from, Math.min(text.length, end))
  const next = text.slice(0, from) + insertion + text.slice(to)
  if (next.length > limit) return null
  return { text: next, caret: from + insertion.length, mentions: activeMentions(next, mentions) }
}
