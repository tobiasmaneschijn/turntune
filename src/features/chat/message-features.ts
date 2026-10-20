import type { ComponentProps } from 'react'
import type { ChatLinkPreviewCard } from './components/chat-link-preview'
import type { ChatTriviaSource } from './trivia'

export interface ChatMessageFeatures {
  trivia?: { source: ChatTriviaSource; scope: string; disabled: boolean; active: boolean }
  preview?: Omit<ComponentProps<typeof ChatLinkPreviewCard>, 'url'>
  pins?: {
    canManage: boolean
    ids: ReadonlySet<string>
    pendingIds: ReadonlySet<string>
    setPinned: (messageId: string, pinned: boolean) => void
  }
}
