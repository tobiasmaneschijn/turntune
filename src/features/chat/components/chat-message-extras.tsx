import type { ChatMessage } from '../model'
import type { ChatMessageFeatures } from '../message-features'
import { firstChatLink } from '../link-previews'
import { ChatSongAttachment } from './chat-song-attachment'
import { ChatLinkPreviewCard } from './chat-link-preview'

export function ChatMessageExtras({ message, features }: { message: ChatMessage; features?: ChatMessageFeatures }) {
  const url = message.type === 'text' && !message.game ? firstChatLink(message.content) : undefined
  return <>
    {message.song && <ChatSongAttachment song={message.song} />}
    {url && features?.preview && <ChatLinkPreviewCard key={url} url={url} {...features.preview} />}
  </>
}
