import { approvedImageUrl } from "../lib/remote-images";
import { ArrowDown, Bell, BellOff, Plus, Reply, Search, Send, Smile, X } from 'lucide-react'
import { toast } from 'sonner'
import { createPortal } from 'react-dom'
import type { SkinTones, Theme } from 'emoji-picker-react'
import { useTheme } from 'next-themes'
import { insertComposerText } from '@/chat/composer-edit'
import { prepareUploadedChatImage } from '@/chat/image-upload'
import { chatCommandSuggestions, parseChatCommand, type ChatCommandName } from '@/chat/commands'
import { ChatPollComposer } from '@/components/chat-poll-composer'
import '@/styles/chat-polls.css'
import { getScopedSupabaseClient } from '@/supabase'
import { boundedOperation, CLEANUP_TIMEOUT_MS, SUBMISSION_TIMEOUT_MS } from '@/lib/bounded-operation'
import {
  forwardRef,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  applyChatUserProfiles,
  applyReactionEvents,
  applyPollVoteEvents,
  applyRemovalEvents,
  createReplySnapshot,
  mergeChatMessages,
  CHAT_LIVE_WINDOW_LIMIT,
  recentChatMessages,
  shouldShowMessageHeader,
  startsNewDay,
  type ChatMessage,
  type ChatMention,
  type ChatReply,
} from '@/chat/model'
import {
  activeMentions,
  buildRoomMentionOptions,
  findMentionQuery,
  insertMention,
  type MentionQuery,
  type RoomMentionOption,
} from '@/chat/mentions'
import {
  CHAT_IMAGE_ACCEPT,
  createChatStoragePath,
  fetchGiphyGifs,
  readPastedChatMedia,
  validateChatImage,
  type GiphyGif,
} from '@/chat/media'
import { persistReactionChange } from '@/chat/persistence'
import { createChatDraftStore, type ChatDraft } from '@/chat/drafts'
import type { ChatSaveStates } from '@/chat/delivery'
import { useChatDelivery } from '@/hooks/use-chat-delivery'
import type { ChatHistorySource } from '@/chat/history-reader'
import type { ChatSessionFactory } from '@/chat/realtime'
import { cn } from '@/lib/utils'
import { requestJson } from '@/lib/authenticated-http'
import { ChatMessageItem } from '@/components/chat-message'
import { Avatar } from '@/components/Avatar'
import { DevFlair } from '@/components/DevFlair'
import {
  chatPickerEmojiStyle,
  PlatformEmojiText,
  readEmojiSkinTone,
  saveEmojiSkinTone,
} from '@/components/platform-emoji-text'
import { useChatScroll } from '@/hooks/use-chat-scroll'
import { useChatVisibility } from '@/hooks/use-chat-visibility'
import { getVisibleMessagePreview } from '@/chat/visibility'
import { useChatHistory } from '@/hooks/use-chat-history'
import { useRoomNotificationMuted } from '@/hooks/use-room-notifications'
import { useChatPickerBounds } from '@/hooks/use-chat-picker-bounds'
import { createChatAttentionTracker, isAppInBackground, notifyWithAttention } from '@/notifications'
import type { SoundSpinUserSettings } from '@/playback-settings'
import { effectiveScrollBehavior, useEffectiveMotion } from '@/hooks/use-effective-motion'
import { useRealtimeChat } from '@/hooks/use-realtime-chat'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog'
import {Label} from '@/components/ui/label'
import type { User,RoomCapabilities } from '@/types'

const EmojiPicker = lazy(() => import('./accessible-emoji-picker'))

interface RealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: User
  onMessage?: (messages: ChatMessage[]) => void
  onSend?: (message: ChatMessage) => Promise<void> | void
  messages?: ChatMessage[]
  onOpenProfile?: (userId: string) => void
  onOpenQueue?: () => void
  adminUserIds?: string[]
  roomUsers?: User[]
  isVisible?: boolean
  onUnreadCountChange?: (count: number) => void
  onConnected?: () => void
  historyRoomSlug?: string
  historySource?: ChatHistorySource
  historyHasOlder?: boolean
  historyLoading?: boolean
  historyUnavailable?: boolean
  onHistoricalMessages?: (messages: ChatMessage[]) => void
  notifications?: SoundSpinUserSettings['notifications']
  onNotificationActivate?: () => void
  transport?: ChatSessionFactory
  onPersistReaction?: (change: { id?: string; action: 'add' | 'remove'; messageId: string; userId: string; emoji: string }) => Promise<void>
  onResolveMediaUrl?: (storagePath: string) => Promise<string>
  headerActionsContainer?: HTMLElement | null
  capabilities?:Pick<RoomCapabilities,'chat'|'media'|'links'|'polls'|'chatParticipants'>
  slowModeSeconds?:number
  restrictionMessage?:string
  onRemoveMessage?:(message:ChatMessage,reason:string)=>Promise<void>
  onReportMessage?:(message:ChatMessage,reason:string)=>Promise<void>
  canRemoveMessage?:(message:ChatMessage)=>boolean
}

export interface RealtimeChatHandle {
  focusComposer: () => void
}

const TYPING_ROOM_LIMIT = 20
const TYPING_BROADCAST_THROTTLE_MS = 2_000
const TYPING_IDLE_MS = 3_000
const GIPHY_SEARCH_DEBOUNCE_MS = 500
const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_USERS: User[] = []
const EMPTY_ADMIN_IDS: string[] = []

interface ChatMessageListProps {
  messages: ChatMessage[]
  hiddenIds: ReadonlySet<string>
  onHiddenChange: (messageId: string, hidden: boolean) => void
  onResolveMediaUrl?: (storagePath: string) => Promise<string>
  currentUserId: string
  liveAdminUserIds: ReadonlySet<string>
  unreadMessageId?: string
  onOpenProfile?: (userId: string) => void
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string) => void
  onJumpToMessage: (messageId: string) => void
  saveStates: ChatSaveStates
  onRetrySave: (messageId: string) => void
  onRetrySend: (messageId: string) => void
  onVotePoll: (message: ChatMessage, optionIndex: number) => void
  pollVoteStates: Record<string, { pending: boolean; error?: string }>
  pollVotingEnabled: boolean
  onRemove?:(message:ChatMessage)=>void
  onReport?:(message:ChatMessage)=>void
  canRemoveMessage?:(message:ChatMessage)=>boolean
  participationDisabled?:boolean
}

const ChatMessageList = memo(function ChatMessageList({
  messages,
  hiddenIds,
  onHiddenChange,
  onResolveMediaUrl,
  currentUserId,
  liveAdminUserIds,
  unreadMessageId,
  onOpenProfile,
  onReply,
  onReact,
  onJumpToMessage,
  saveStates,
  onRetrySave,
  onRetrySend,
  onVotePoll,
  pollVoteStates,
  pollVotingEnabled,
  onRemove,onReport,canRemoveMessage,participationDisabled,
}: ChatMessageListProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [openPickerId, setOpenPickerId] = useState<string | null>(null)
  const handleActionMenuOpenChange = useCallback((messageId: string, open: boolean) => {
    setOpenMenuId((current) => open ? messageId : current === messageId ? null : current)
    if (open) setOpenPickerId(null)
  }, [])
  const handleReactionPickerOpenChange = useCallback((messageId: string, open: boolean) => {
    setOpenPickerId((current) => open ? messageId : current === messageId ? null : current)
    if (open) setOpenMenuId(null)
  }, [])
  return (
    <div className="chat-message-list space-y-1">
      {messages.map((message, index) => {
        const previousMessage = index > 0 ? messages[index - 1] : undefined
        const beginsNewDay = startsNewDay(message, previousMessage)
        const showHeader = shouldShowMessageHeader(message, previousMessage)

        return (
          <div
            key={message.id}
            className="chat-message-wrapper"
          >
            {beginsNewDay && (
              <div className="chat-date-divider">
                <span>
                  {new Date(message.createdAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}
            {unreadMessageId === message.id && (
              <div className="chat-unread-divider"><span>New messages</span></div>
            )}
            <ChatMessageItem
              message={message}
              isHidden={hiddenIds.has(message.id)}
              isReplyHidden={Boolean(message.replyTo && hiddenIds.has(message.replyTo.id))}
              onHiddenChange={onHiddenChange}
              isOwnMessage={message.user.id === currentUserId}
              currentUserId={currentUserId}
              showHeader={showHeader}
              isAuthorAppAdmin={Boolean(message.user.isAppAdmin || liveAdminUserIds.has(message.user.id))}
              isReplyAuthorAppAdmin={Boolean(message.replyTo && (
                message.replyTo.user.isAppAdmin || liveAdminUserIds.has(message.replyTo.user.id)
              ))}
              onOpenProfile={onOpenProfile}
              onReply={onReply}
              onReact={onReact}
              onJumpToMessage={onJumpToMessage}
              saveStatus={message.user.id === currentUserId ? saveStates[message.id] : undefined}
              onRetrySave={onRetrySave}
              onRetrySend={onRetrySend}
              onVotePoll={onVotePoll}
              pollVoting={pollVoteStates[message.id]?.pending}
              pollVoteError={pollVoteStates[message.id]?.error}
              pollVotingDisabled={!pollVotingEnabled}
              onResolveMediaUrl={onResolveMediaUrl}
              onRemove={canRemoveMessage&&!canRemoveMessage(message)?undefined:onRemove}
              onReport={onReport}
              participationDisabled={participationDisabled}
              actionMenuOpen={openMenuId === message.id}
              onActionMenuOpenChange={handleActionMenuOpenChange}
              reactionPickerOpen={openPickerId === message.id}
              onReactionPickerOpenChange={handleReactionPickerOpenChange}
            />
          </div>
        )
      })}
    </div>
  )
})

/**
 * Interactive room chat. `useRealtimeChat` handles low-latency Broadcast
 * delivery; the parent supplies durable history and an `onSend` persistence
 * callback. See `docs/chat.md` for the complete data flow.
 */
export const RealtimeChat = forwardRef<RealtimeChatHandle, RealtimeChatProps>(function RealtimeChat({
  client,
  roomName,
  user,
  onMessage,
  onSend,
  onOpenProfile,
  onOpenQueue,
  adminUserIds = EMPTY_ADMIN_IDS,
  roomUsers = EMPTY_USERS,
  isVisible = true,
  onUnreadCountChange,
  onConnected,
  historyRoomSlug,
  historySource,
  historyHasOlder,
  historyLoading = false,
  historyUnavailable = false,
  onHistoricalMessages,
  notifications,
  onNotificationActivate,
  transport,
  onPersistReaction,
  onResolveMediaUrl,
  headerActionsContainer,
  capabilities,slowModeSeconds=0,restrictionMessage,onRemoveMessage,onReportMessage,canRemoveMessage,
  messages: initialMessages = EMPTY_MESSAGES,
}, ref) {
  const reducedMotion = useEffectiveMotion()
  const { resolvedTheme } = useTheme()
  const mentionListId = useId()
  const composerHintId = useId()
  const mediaPanelId = useId()
  const commandListId = useId()
  const { hiddenIds, setMessageHidden } = useChatVisibility(user.id, roomName)
  const handleHiddenChange = useCallback((messageId: string, hidden: boolean) => {
    const persisted = setMessageHidden(messageId, hidden)
    toast.dismiss(`mention:${user.id}:${historyRoomSlug || roomName}:${messageId}`)
    if (!persisted) toast.info(hidden ? 'Hidden until you leave this chat. Device storage is unavailable.' : 'Unhidden until you leave this chat. Device storage is unavailable.')
    else if (hidden) toast.info('Message hidden on this device.')
  }, [setMessageHidden, user.id, roomName, historyRoomSlug])
  useEffect(() => {
    for (const messageId of hiddenIds) toast.dismiss(`mention:${user.id}:${historyRoomSlug || roomName}:${messageId}`)
  }, [hiddenIds, user.id, roomName, historyRoomSlug])
  const draftStore = useMemo(() => createChatDraftStore(user.id, roomName), [user.id, roomName])
  const initialDraft = useMemo(() => draftStore.read(), [draftStore])
  const {
    containerRef,
    scrollToBottom,
    refreshPosition,
    isNearBottom,
    scrollRevision,
    preserveAnchor,
    restoreAnchor,
    cancelAnchor,
    anchorRevision,
  } = useChatScroll(`${user.id}:${roomName}`)
  const liveWindowRef = useRef<ChatMessage[]>([])
  const readingRef = useRef(false)
  readingRef.current = !isNearBottom
  const [readerWindow, setReaderWindow] = useState<ChatMessage[] | null>(null)
  const readerWindowRef = useRef<ChatMessage[] | null>(null)

  const {
    messages: realtimeMessages,
    prepareMessage,
    sendExistingMessage,
    broadcastReaction,
    reactionEvents,
    pollVoteEvents,
    applyPollVote,
    removalEvents,applyRemoval,
    broadcastTyping,
    typingUserIds,
    isConnected,
  } = useRealtimeChat({
    client,
    roomName,
    user,
    onConnected,
    transport,
    onBeforeMessage: (message, messages) => {
      const window = liveWindowRef.current
      if (readingRef.current && !readerWindowRef.current && mergeChatMessages(initialMessages, messages).length > CHAT_LIVE_WINDOW_LIMIT && !window.some((row) => row.id === message.id)) {
        readerWindowRef.current = window
        setReaderWindow(window)
      }
    },
  })
  const liveWindow = useMemo(() => recentChatMessages(mergeChatMessages(initialMessages, realtimeMessages)), [initialMessages, realtimeMessages])
  liveWindowRef.current = liveWindow
  const [draftText, setDraftText] = useState(initialDraft?.text || '')
  const [commandMenuDismissed, setCommandMenuDismissed] = useState(false)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [pollQuestion, setPollQuestion] = useState<string | null>(null)
  const pollComposerGenerationRef = useRef(0)
  const [pollVoteStates, setPollVoteStates] = useState<Record<string, { pending: boolean; error?: string }>>({})
  const pendingPollVotesRef = useRef(new Set<string>())
  const commandCandidates = commandMenuDismissed ? [] : chatCommandSuggestions(draftText)
  const commandDraft = parseChatCommand(draftText)
  const [hasDraft, setHasDraft] = useState(Boolean(initialDraft?.text.trim()))
  const [draftRestored, setDraftRestored] = useState(Boolean(initialDraft))
  const [replyRestoreNotice, setReplyRestoreNotice] = useState('')
  const [replyingTo, setReplyingTo] = useState<ChatReply | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGiphy, setShowGiphy] = useState(false)
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const [giphyQuery, setGiphyQuery] = useState('')
  const [gifs, setGifs] = useState<GiphyGif[]>([])
  const [gifsLoading, setGifsLoading] = useState(false)
  const [composerError, setComposerError] = useState('')
  const [moderationTarget,setModerationTarget]=useState<{kind:'remove'|'report';message:ChatMessage}|null>(null)
  const [moderationReason,setModerationReason]=useState('')
  const [moderationPending,setModerationPending]=useState(false)
  const [moderationError,setModerationError]=useState('')
  const [cooldownUntil,setCooldownUntil]=useState(0)
  const [cooldownNow,setCooldownNow]=useState(Date.now())
  useEffect(()=>{if(cooldownUntil<=Date.now())return;const timer=setInterval(()=>setCooldownNow(Date.now()),250);return()=>clearInterval(timer)},[cooldownUntil])
  const cooldownRemaining=Math.max(0,Math.ceil((cooldownUntil-cooldownNow)/1000))
  const canChat=capabilities?.chat!==false
  const canMedia=canChat&&capabilities?.media!==false
  const canPoll=canChat&&capabilities?.polls!==false
  useEffect(()=>{setCooldownUntil(0);setCooldownNow(Date.now());setModerationTarget(null)},[roomName,user.id])
  useEffect(()=>{if(slowModeSeconds===0)setCooldownUntil(0)},[slowModeSeconds])
  useEffect(()=>{if(!canMedia){setShowGiphy(false);setPendingImage(null)}},[canMedia])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [selectedMentions, setSelectedMentions] = useState<ChatMention[]>(initialDraft?.mentions || [])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [unreadMessageIds, setUnreadMessageIds] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const mediaPickerBounds = useChatPickerBounds(showEmoji || showGiphy, composerRef, 'composer')
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const draftMessageRef = useRef(initialDraft?.text || '')
  const draftRevisionRef = useRef(0)
  const composingRef = useRef(false)
  const selectionRef = useRef({ start: initialDraft?.text.length || 0, end: initialDraft?.text.length || 0 })
  const restoredReplyIdRef = useRef(initialDraft?.replyToId)
  const draftSnapshotRef = useRef<{ store: typeof draftStore; draft: ChatDraft }>({ store: draftStore, draft: initialDraft || { text: '', mentions: [] } })
  const pendingReactionsRef = useRef(new Set<string>())
  const uploadAbortRef = useRef<AbortController | null>(null)
  const uploadScopeRef = useRef(`${user.id}:${roomName}`)
  uploadScopeRef.current = `${user.id}:${roomName}`
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const previousMessageIdsRef = useRef(new Set<string>())
  const initializedScrollRef = useRef(false)
  const previousVisibilityRef = useRef(isVisible)
  const ignoreNextVisibleScrollRef = useRef(false)
  const typingActiveRef = useRef(false)
  const lastTypingBroadcastRef = useRef(0)
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const giphyCacheRef = useRef(new Map<string, GiphyGif[]>())
  const giphyRequestRef = useRef(0)
  const giphyAbortRef = useRef<AbortController | null>(null)
  const giphyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [giphyConfigured, setGiphyConfigured] = useState(false)
  const [showHistorySearch, setShowHistorySearch] = useState(false)
  const historySearchId = useId()
  const historySearchInputRef = useRef<HTMLInputElement>(null)
  const historySearchButtonRef = useRef<HTMLButtonElement>(null)
  const [historySearchText, setHistorySearchText] = useState('')
  const [pageAttended, setPageAttended] = useState(() => !isAppInBackground())
  const [roomMuted, setRoomMuted] = useRoomNotificationMuted(user.id, historyRoomSlug || roomName)
  const joinedAt = useMemo(() => Date.now(), [user.id, roomName])
  const attentionTracker = useMemo(() => createChatAttentionTracker(user.id, joinedAt), [user.id, joinedAt])
  const liveScrollTopRef = useRef(0)
  const pendingJumpRef = useRef<string | null>(null)
  const jumpHighlightRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seedHistoricalMessages = useCallback((messages: ChatMessage[]) => {
    attentionTracker.seed(messages)
    onHistoricalMessages?.(messages)
  }, [attentionTracker, onHistoricalMessages])
  const history = useChatHistory(client, historyRoomSlug, `${user.id}:${roomName}`, readerWindow || liveWindow, seedHistoricalMessages, historySource, historyHasOlder)
  useEffect(() => {
    if (showHistorySearch) historySearchInputRef.current?.focus({ preventScroll: true })
  }, [showHistorySearch])
  useEffect(() => {
    if (!readerWindow || !isNearBottom) return
    readerWindowRef.current = null; setReaderWindow(null)
    history.resetPages(liveWindow)
    requestAnimationFrame(() => scrollToBottom('auto'))
  }, [readerWindow, isNearBottom, history.resetPages, liveWindow, scrollToBottom])
  useEffect(() => { readerWindowRef.current = null; setReaderWindow(null) }, [roomName, user.id])
  const attendingLive = isVisible && pageAttended && !history.context
  const liveAdminUserIds = useMemo(() => new Set(adminUserIds), [adminUserIds])
  const reactionNamesByUserId = useMemo(
    () => new Map(roomUsers.map((roomUser) => [roomUser.id, roomUser.name])),
    [roomUsers]
  )
  const roomMentionOptions = useMemo(
    () => buildRoomMentionOptions(roomUsers, user.id),
    [roomUsers, user.id]
  )
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return []
    const query = mentionQuery.query.toLocaleLowerCase()
    return roomMentionOptions.filter((option) =>
      option.mention.handle.toLocaleLowerCase().includes(query) ||
      option.user.name.toLocaleLowerCase().includes(query)
    ).slice(0, 8)
  }, [mentionQuery, roomMentionOptions])

  const { saveStates, outboxMessages, sending, uploading, sendingRef, uploadingRef, setUploading, lifetimeRef,
    sendText, sendPoll, sendMedia: sendMediaMessage, sendMediaWithOwnership, retrySend, retrySave } = useChatDelivery({
    scope: `${user.id}:${roomName}`, isConnected:isConnected&&canChat&&!cooldownRemaining, prepareMessage,
    deliver: (message) => boundedOperation(() => sendExistingMessage(message), { timeoutMs: SUBMISSION_TIMEOUT_MS }),
    persist: onSend ? (message) => boundedOperation(() => Promise.resolve(onSend(message)), { timeoutMs: SUBMISSION_TIMEOUT_MS }) : undefined,
    composer: () => ({ text: draftMessageRef.current, mentions: activeMentions(draftMessageRef.current.trim(), selectedMentions), replyTo: replyingTo, revision: draftRevisionRef.current }),
    onError: setComposerError,
    beforeTextSend: () => requestAnimationFrame(() => { if (lifetimeRef.current.active && !history.context) scrollToBottom('auto') }),
    confirmedSend:()=>{if(slowModeSeconds>0){const until=Date.now()+slowModeSeconds*1000;setCooldownUntil(until);setCooldownNow(Date.now())}},
    confirmed: (snapshot, text) => {
      if (text && draftRevisionRef.current === snapshot.revision && draftMessageRef.current === snapshot.text && replyingTo?.id === snapshot.replyTo?.id &&
          JSON.stringify(activeMentions(draftMessageRef.current.trim(), selectedMentions)) === JSON.stringify(snapshot.mentions)) {
        draftMessageRef.current = ''
        draftSnapshotRef.current.draft = { text: '', mentions: [] }
        setDraftText(''); setHasDraft(false); setSelectedMentions([]); setMentionQuery(null); setDraftRestored(false)
        restoredReplyIdRef.current = undefined
        draftStore.save({ text: '', mentions: [] })
        stopTyping()
      }
      setReplyingTo((current) => draftRevisionRef.current === snapshot.revision && current?.id === snapshot.replyTo?.id ? null : current)
    },
  })

  useEffect(() => {
    setComposerError('')
    pollComposerGenerationRef.current++
    setPollQuestion(null)
    setPollVoteStates({})
    pendingPollVotesRef.current = new Set()
    setCommandMenuDismissed(false)
    setDraftText(initialDraft?.text || '')
    draftMessageRef.current = initialDraft?.text || ''
    draftRevisionRef.current++
    setHasDraft(Boolean(initialDraft?.text.trim()))
    setSelectedMentions(initialDraft?.mentions || [])
    setReplyingTo(null)
    setDraftRestored(Boolean(initialDraft))
    setReplyRestoreNotice('')
    restoredReplyIdRef.current = initialDraft?.replyToId
  }, [roomName, user.id, initialDraft])

  useEffect(() => {
    setPendingImage(null)
    return () => { uploadAbortRef.current?.abort(); uploadAbortRef.current = null }
  }, [roomName, user.id])

  // Debounce session storage, then flush the latest scoped draft on navigation/reload.
  useEffect(() => {
    if (draftMessageRef.current !== draftText) return
    draftSnapshotRef.current = { store: draftStore, draft: { text: draftText, mentions: selectedMentions,
      replyToId: replyingTo?.id || restoredReplyIdRef.current } }
    const timer = setTimeout(() => draftStore.save(draftSnapshotRef.current.draft), 200)
    return () => clearTimeout(timer)
  }, [draftStore, draftText, selectedMentions, replyingTo])

  useEffect(() => {
    const flush = () => {
      if (draftSnapshotRef.current.store === draftStore) draftStore.save(draftSnapshotRef.current.draft)
    }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [draftStore])

  useEffect(() => {
    const composer = messageInputRef.current
    if (!composer) return
    composer.style.height = 'auto'
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 40), 128)}px`
  }, [draftText, isVisible])

  useEffect(() => {
    const composer = composerRef.current
    const body = composer?.parentElement
    if (!composer || !body) return
    const update = () => body.style.setProperty('--chat-composer-height', `${composer.offsetHeight}px`)
    const observer = new ResizeObserver(update)
    observer.observe(composer)
    update()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void requestJson<{ giphyConfigured?: boolean }>('/api/config', { signal: controller.signal })
      .then((config: { giphyConfigured?: boolean }) => {
        setGiphyConfigured(Boolean(config.giphyConfigured))
      })
      .catch(() => {
        // GIF support remains disabled when runtime configuration is unavailable.
      })
    return () => controller.abort()
  }, [])

  const baseMessages = useMemo(
    () => mergeChatMessages(mergeChatMessages(readerWindow || liveWindow, history.olderMessages), outboxMessages),
    [readerWindow, liveWindow, history.olderMessages, outboxMessages]
  )
  const profiledMessages = useMemo(
    () => applyChatUserProfiles(baseMessages, roomUsers),
    [baseMessages, roomUsers]
  )
  const allMessages = useMemo(
    () => applyRemovalEvents(applyPollVoteEvents(applyReactionEvents(profiledMessages, reactionEvents, reactionNamesByUserId), pollVoteEvents),removalEvents),
    [profiledMessages, reactionEvents, reactionNamesByUserId, pollVoteEvents,removalEvents]
  )
  useEffect(()=>{setReplyingTo(current=>{
    if(!current||current.removedAt)return current
    const removedAt=removalEvents.find(event=>event.messageId===current.id)?.removedAt||allMessages.find(message=>message.id===current.id)?.removedAt
    return removedAt?{...current,content:'Message removed',type:'text',mediaUrl:undefined,mentions:[],removedAt}:current
  })},[removalEvents,allMessages])
  const visibleMessages = useMemo(() => history.context
    ? applyRemovalEvents(applyPollVoteEvents(applyReactionEvents(applyChatUserProfiles(history.context.messages, roomUsers), reactionEvents, reactionNamesByUserId), pollVoteEvents),removalEvents)
    : allMessages, [history.context, roomUsers, reactionEvents, reactionNamesByUserId, pollVoteEvents, allMessages,removalEvents])

  useLayoutEffect(() => {
    if (!history.loadingOlder && !history.contextLoading) restoreAnchor()
  }, [visibleMessages, history.loadingOlder, history.contextLoading, anchorRevision, restoreAnchor])

  useEffect(() => {
    const refresh = () => setPageAttended(!isAppInBackground())
    window.addEventListener('focus', refresh); window.addEventListener('blur', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('blur', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => { attentionTracker.seed(initialMessages) }, [attentionTracker, initialMessages])
  useEffect(() => {
    if (historyLoading) return
    for (const message of realtimeMessages) {
      if (!attentionTracker.consume(message) || hiddenIds.has(message.id) || !notifications?.chatMentions || roomMuted || attendingLive) continue
      const key = `mention:${user.id}:${historyRoomSlug || roomName}:${message.id}`
      const lifetime = lifetimeRef.current
      const activate = () => {
        if (!lifetime.active) return
        cancelAnchor()
        history.closeContext()
        setShowHistorySearch(false)
        onNotificationActivate?.()
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!lifetime.active) return
          const row = document.getElementById(`chat-message-${message.id}`)
          if (row) {
            row.scrollIntoView({ behavior: 'auto', block: 'center' })
            row.focus({ preventScroll: true })
            row.classList.add('chat-message-jump-target')
            if (jumpHighlightRef.current) clearTimeout(jumpHighlightRef.current)
            jumpHighlightRef.current = setTimeout(() => row.classList.remove('chat-message-jump-target'), 1_500)
          } else messageInputRef.current?.focus({ preventScroll: true })
        }))
      }
      notifyWithAttention({ key, title: `${message.user.name} mentioned you`, body: message.content || 'New room chat mention',
        backgroundOnly: notifications.backgroundOnly,
        onClick: activate,
        onInApp: () => toast.info(`${message.user.name} mentioned you`, { id: key, description: message.content,
          action: { label: 'View', onClick: activate } }) })
    }
  }, [attentionTracker, attendingLive, cancelAnchor, hiddenIds, history.closeContext, historyLoading, historyRoomSlug, notifications, onNotificationActivate, realtimeMessages, roomMuted, roomName, user.id])
  useEffect(() => {
    const original = document.title.replace(/^\(\d+\) /, '')
    let ownedTitle = document.title
    const update = () => { ownedTitle = unreadMessageIds.length ? `(${unreadMessageIds.length}) ${original}` : original; document.title = ownedTitle }
    update()
    return () => { if (document.title === ownedTitle) document.title = original }
  }, [unreadMessageIds.length])
  useEffect(() => {
    const replyId = restoredReplyIdRef.current
    if (!replyId) return
    const original = allMessages.find((message) => message.id === replyId)
    if (original) {
      restoredReplyIdRef.current = undefined
      setReplyingTo(createReplySnapshot(original))
    }
  }, [allMessages])
  useEffect(() => {
    const replyId = restoredReplyIdRef.current
    if (!replyId || historyLoading) return
    let active = true
    const restore = async () => {
      try {
        const original = historySource ? await historySource.loadMessage(replyId) : null
        if (!active || restoredReplyIdRef.current !== replyId) return
        restoredReplyIdRef.current = undefined
        if (original) setReplyingTo(createReplySnapshot(original))
        else {
          draftSnapshotRef.current.draft.replyToId = undefined
          setReplyRestoreNotice('Reply unavailable. Draft text restored.')
        }
      } catch {
        if (!active || restoredReplyIdRef.current !== replyId) return
        restoredReplyIdRef.current = undefined
        draftSnapshotRef.current.draft.replyToId = undefined
        setReplyRestoreNotice('Could not restore reply. Draft text restored.')
      }
    }
    void restore()
    return () => { active = false }
  }, [client, historyLoading, historyRoomSlug, historySource, initialDraft])
  const typingNames = useMemo(() => {
    if (roomUsers.length > TYPING_ROOM_LIMIT) return []
    const typingIds = new Set(typingUserIds)
    return roomUsers
      .filter((roomUser) => roomUser.id !== user.id && typingIds.has(roomUser.id))
      .map((roomUser) => roomUser.name)
  }, [roomUsers, typingUserIds, user.id])
  const typingLabel = typingNames.length === 1
    ? `${typingNames[0]} is typing…`
    : typingNames.length === 2
      ? `${typingNames[0]} and ${typingNames[1]} are typing…`
      : typingNames.length > 2 ? 'Several people are typing…' : ''

  useImperativeHandle(ref, () => ({
    focusComposer: () => messageInputRef.current?.focus(),
  }), [])

  useEffect(() => {
    if (onMessage) {
      onMessage(allMessages)
    }
  }, [allMessages, onMessage])

  const clearUnread = useCallback(() => setUnreadMessageIds((current) => current.length ? [] : current), [])

  useEffect(() => {
    initializedScrollRef.current = false
    ignoreNextVisibleScrollRef.current = false
    previousMessageIdsRef.current = new Set()
    previousVisibilityRef.current = isVisible
    clearUnread()
  }, [clearUnread, roomName])

  useEffect(() => {
    onUnreadCountChange?.(unreadMessageIds.length)
  }, [onUnreadCountChange, unreadMessageIds.length])

  useEffect(() => {
    const currentIds = new Set(realtimeMessages.map((message) => message.id))
    const addedMessages = realtimeMessages.filter(
      (message) => !previousMessageIdsRef.current.has(message.id)
    )

    if (!initializedScrollRef.current && allMessages.length > 0) {
      initializedScrollRef.current = true
      if (attendingLive && isNearBottom) requestAnimationFrame(() => scrollToBottom('auto'))
    }
    if (addedMessages.length > 0) {
      // Only realtime arrivals can change unread/attention; older pages and reconnect hydration are baseline.
      const liveIds = new Set(realtimeMessages.map((message) => message.id))
      const arrivals = addedMessages.filter((message) => liveIds.has(message.id) && Date.parse(message.createdAt) >= joinedAt - 5_000)
      const newestMessage = arrivals.at(-1)
      if (arrivals.length > 0 && attendingLive && (isNearBottom || newestMessage?.user.id === user.id)) {
        requestAnimationFrame(() => scrollToBottom('auto'))
        clearUnread()
      } else {
        const receivedIds = arrivals
          .filter((message) => message.user.id !== user.id)
          .map((message) => message.id)
        if (receivedIds.length > 0) {
          setUnreadMessageIds((current) => [
            ...current,
            ...receivedIds.filter((messageId) => !current.includes(messageId)),
          ])
        }
      }
    }

    previousMessageIdsRef.current = currentIds
  }, [allMessages, attendingLive, clearUnread, isNearBottom, joinedAt, realtimeMessages, scrollToBottom, user.id])

  useEffect(() => {
    const becameVisible = isVisible && !previousVisibilityRef.current
    previousVisibilityRef.current = isVisible
    if (becameVisible) {
      ignoreNextVisibleScrollRef.current = true
      requestAnimationFrame(refreshPosition)
      return
    }
    if (ignoreNextVisibleScrollRef.current) {
      ignoreNextVisibleScrollRef.current = false
      return
    }
    if (!attendingLive || !isNearBottom) return
    clearUnread()
  }, [attendingLive, clearUnread, isNearBottom, isVisible, refreshPosition, scrollRevision])

  const stopTyping = useCallback(() => {
    if (typingIdleTimeoutRef.current) clearTimeout(typingIdleTimeoutRef.current)
    typingIdleTimeoutRef.current = null
    if (!typingActiveRef.current) return
    typingActiveRef.current = false
    void broadcastTyping(false)
  }, [broadcastTyping])

  const noteTyping = useCallback(() => {
    if (!isConnected||!canChat || roomUsers.length > TYPING_ROOM_LIMIT) return
    const now = Date.now()
    if (
      !typingActiveRef.current ||
      now - lastTypingBroadcastRef.current >= TYPING_BROADCAST_THROTTLE_MS
    ) {
      typingActiveRef.current = true
      lastTypingBroadcastRef.current = now
      void broadcastTyping(true)
    }
    if (typingIdleTimeoutRef.current) clearTimeout(typingIdleTimeoutRef.current)
    typingIdleTimeoutRef.current = setTimeout(stopTyping, TYPING_IDLE_MS)
  }, [broadcastTyping, isConnected, roomUsers.length, stopTyping,canChat])

  useEffect(() => {
    if (roomUsers.length > TYPING_ROOM_LIMIT || !isConnected) stopTyping()
  }, [isConnected, roomUsers.length, stopTyping])

  useEffect(() => () => stopTyping(), [stopTyping])

  const clearCommandDraft = useCallback(() => {
    draftRevisionRef.current++
    draftMessageRef.current = ''
    draftSnapshotRef.current.draft = { ...draftSnapshotRef.current.draft, text: '', mentions: [] }
    draftStore.save(draftSnapshotRef.current.draft)
    setDraftText(''); setHasDraft(false); setSelectedMentions([]); setMentionQuery(null); setDraftRestored(false)
    setCommandMenuDismissed(true)
    stopTyping()
  }, [draftStore, stopTyping])
  const executeCommand = useCallback((name: ChatCommandName, argumentsText = '') => {
    if(name==='poll'&&!canPoll){setComposerError('Poll creation is disabled for you in this room.');return}
    if ((name === 'queue' || name === 'mute') && argumentsText) {
      setComposerError(`Use /${name} without extra text.`); return
    }
    if (name === 'queue' && !onOpenQueue) { setComposerError('The queue is unavailable in this view.'); return }
    if (name === 'search' && !historyRoomSlug) { setComposerError('Room message search is unavailable in this view.'); return }
    if (name === 'search' && argumentsText && (argumentsText.length < 2 || argumentsText.length > 100)) {
      setComposerError('Enter 2–100 characters to search room messages.'); return
    }
    if (name === 'poll' && argumentsText.length > 200) { setComposerError('Keep the poll question to 200 characters.'); return }
    setComposerError('')
    clearCommandDraft()
    setShowEmoji(false); setShowGiphy(false)
    if (name === 'queue') onOpenQueue?.()
    else if (name === 'mute') {
      setRoomMuted(!roomMuted)
      toast.info(roomMuted ? 'Room notifications unmuted.' : 'Room notifications muted.')
      messageInputRef.current?.focus({ preventScroll: true })
    } else if (name === 'search') {
      setShowHistorySearch(true)
      setHistorySearchText(argumentsText)
      if (argumentsText) void history.search(argumentsText)
      requestAnimationFrame(() => historySearchInputRef.current?.focus({ preventScroll: true }))
    } else {
      pollComposerGenerationRef.current++
      setPollQuestion(argumentsText)
    }
  }, [clearCommandDraft, history.search, historyRoomSlug, onOpenQueue, roomMuted, setRoomMuted,canPoll])
  const handleSendMessage = useCallback((event: React.FormEvent) => {
    event.preventDefault()
    if (commandCandidates.length) {
      executeCommand(commandCandidates[activeCommandIndex] || commandCandidates[0]); return
    }
    const command = parseChatCommand(draftMessageRef.current)
    if (command) {
      if (command.name) executeCommand(command.name, command.arguments)
      else setComposerError('Unknown command. Use /queue, /mute, /search or /poll.')
      return
    }
    if(!canChat||cooldownRemaining){setComposerError(!canChat?restrictionMessage||'Chat is limited in this room.':`Wait ${cooldownRemaining} seconds before sending.`);return}
    if(capabilities?.links===false&&/https?:\/\/|www\./i.test(draftMessageRef.current)){setComposerError('Links are disabled for you in this room.');return}
    void sendText()
  }, [activeCommandIndex, commandCandidates, executeCommand, sendText,canChat,cooldownRemaining,restrictionMessage,capabilities?.links])
  const closePollComposer = useCallback(() => {
    pollComposerGenerationRef.current++
    setPollQuestion(null)
    requestAnimationFrame(() => messageInputRef.current?.focus({ preventScroll: true }))
  }, [])
  const handlePostPoll = useCallback(async (question: string, options: string[]) => {
    if(!canPoll||cooldownRemaining)return false
    const lifetime = lifetimeRef.current
    const generation = pollComposerGenerationRef.current
    const accepted = await sendPoll(question, options)
    if (!lifetime.active || generation !== pollComposerGenerationRef.current) return false
    if (accepted && !history.context) requestAnimationFrame(() => scrollToBottom('auto'))
    return accepted
  }, [history.context, lifetimeRef, scrollToBottom, sendPoll,canPoll,cooldownRemaining])
  const handlePollVote = useCallback(async (message: ChatMessage, optionIndex: number) => {
    const source = historySource
    if (!source?.votePoll || !isConnected||!canChat||message.removedAt || !message.poll || pendingPollVotesRef.current.has(message.id)) return
    const pending = pendingPollVotesRef.current
    const lifetime = lifetimeRef.current
    pending.add(message.id)
    setPollVoteStates((current) => ({ ...current, [message.id]: { pending: true } }))
    try {
      const event = await boundedOperation(() => source.votePoll!(message.id, optionIndex), { timeoutMs: SUBMISSION_TIMEOUT_MS })
      if (!lifetime.active) return
      applyPollVote(event)
      setPollVoteStates((current) => ({ ...current, [message.id]: { pending: false } }))
    } catch (error) {
      if (lifetime.active) setPollVoteStates((current) => ({ ...current, [message.id]: { pending: false, error: error instanceof Error ? error.message : 'Could not save vote. Try again.' } }))
    } finally { pending.delete(message.id) }
  }, [applyPollVote, historySource, isConnected, lifetimeRef,canChat])

  const chooseMention = useCallback((option: RoomMentionOption) => {
    if (!mentionQuery) return
    const inserted = insertMention(draftMessageRef.current, mentionQuery, option.mention)
    if (inserted.text.length > 500) return
    draftRevisionRef.current++
    draftMessageRef.current = inserted.text
    draftSnapshotRef.current.draft = { ...draftSnapshotRef.current.draft, text: inserted.text,
      mentions: [...selectedMentions.filter((mention) => mention.userId !== option.mention.userId), option.mention] }
    setDraftText(inserted.text)
    setDraftRestored(false)
    setHasDraft(Boolean(inserted.text.trim()))
    setSelectedMentions((current) => [
      ...current.filter((mention) => mention.userId !== option.mention.userId),
      option.mention,
    ])
    setMentionQuery(null)
    setActiveMentionIndex(0)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(inserted.caret, inserted.caret)
    })
  }, [mentionQuery, selectedMentions])

  const selectReply = useCallback((message: ChatMessage) => {
    draftRevisionRef.current++
    restoredReplyIdRef.current = undefined
    draftSnapshotRef.current.draft.replyToId = message.id
    setReplyingTo(createReplySnapshot({
      ...message,
      user: {
        ...message.user,
        isAppAdmin: message.user.isAppAdmin || liveAdminUserIds.has(message.user.id),
      },
    }))
    setShowEmoji(false)
    setShowGiphy(false)
    requestAnimationFrame(() => messageInputRef.current?.focus())
  }, [liveAdminUserIds])

  const markJumpTarget = useCallback((messageId: string) => {
    const messageElement = document.getElementById(`chat-message-${messageId}`)
    if (!messageElement) return false
    messageElement.scrollIntoView({ behavior: effectiveScrollBehavior('smooth', reducedMotion), block: 'center' })
    messageElement.focus({ preventScroll: true })
    document.querySelector('.chat-message-jump-target')?.classList.remove('chat-message-jump-target')
    messageElement.classList.add('chat-message-jump-target')
    if (jumpHighlightRef.current) clearTimeout(jumpHighlightRef.current)
    jumpHighlightRef.current = setTimeout(() => messageElement.classList.remove('chat-message-jump-target'), 1_500)
    return true
  }, [reducedMotion])
  const jumpToMessage = useCallback((messageId: string) => {
    cancelAnchor()
    if (markJumpTarget(messageId)) return
    if (!historyRoomSlug) { setComposerError('That message is not in the loaded history.'); return }
    liveScrollTopRef.current = containerRef.current?.scrollTop || 0
    pendingJumpRef.current = messageId
    void history.revealContext(messageId).then((found) => { if (!found) pendingJumpRef.current = null })
  }, [cancelAnchor, containerRef, history.revealContext, historyRoomSlug, markJumpTarget])
  useEffect(() => {
    const messageId = pendingJumpRef.current
    if (!messageId || !history.context) return
    requestAnimationFrame(() => { if (markJumpTarget(messageId)) pendingJumpRef.current = null })
  }, [history.context, markJumpTarget])
  useEffect(() => () => { if (jumpHighlightRef.current) clearTimeout(jumpHighlightRef.current) }, [])
  const returnToLive = useCallback(() => {
    cancelAnchor()
    history.closeContext()
    requestAnimationFrame(() => { if (containerRef.current) containerRef.current.scrollTop = liveScrollTopRef.current; refreshPosition() })
  }, [cancelAnchor, containerRef, history.closeContext, refreshPosition])

  const toggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    if (!isConnected||!canChat||message.removedAt) return
    const key = `${message.id}:${user.id}:${emoji}`
    if (pendingReactionsRef.current.has(key)) return
    pendingReactionsRef.current.add(key)

    const hasReacted = (message.reactions || []).some(
      (reaction) => reaction.userId === user.id && reaction.emoji === emoji
    )
    const action = hasReacted ? 'remove' as const : 'add' as const
    const lifetime = lifetimeRef.current

    try {
      const change = {
        id: crypto.randomUUID(),
        action,
        messageId: message.id,
        userId: user.id,
        emoji,
      }
      if (onPersistReaction) await onPersistReaction(change)
      else await persistReactionChange(client, change)
      if (!lifetime.active) return
      setComposerError('')
      await broadcastReaction({
        id: change.id,
        messageId: message.id,
        userId: user.id,
        emoji,
        action,
      })
    } catch {
      if (lifetime.active) setComposerError('Could not confirm reaction. Try again.')
    } finally {
      pendingReactionsRef.current.delete(key)
    }
  }, [broadcastReaction, client, isConnected, onPersistReaction, user.id,canChat])

  const handleReaction = useCallback((message: ChatMessage, emoji: string) => {
    void toggleReaction(message, emoji)
  }, [toggleReaction])

  const handleRetrySave = retrySave
  const handleRetrySend = useCallback((messageId: string) => { void retrySend(messageId) }, [retrySend])

  const uploadImage = async (file: File) => {
    if (!isConnected||!canMedia||cooldownRemaining || uploadingRef.current || sendingRef.current) return
    setComposerError('')
    const validationError = validateChatImage(file)
    if (validationError) return setComposerError(validationError)

    const lifetime = lifetimeRef.current
    const controller = new AbortController()
    const scope = `${user.id}:${roomName}`
    const isCurrent = () => lifetime.active && uploadScopeRef.current === scope
    uploadAbortRef.current = controller
    setPendingImage(file)
    uploadingRef.current = true
    setUploading(true)
    let storagePath = createChatStoragePath(user.id, historyRoomSlug || roomName, file)
    let registeredUpload=false,outboxOwnsUpload=false
    const cleanupRegisteredUpload=()=>{if(registeredUpload&&!outboxOwnsUpload&&historySource?.cleanupUpload)void boundedOperation(signal=>historySource.cleanupUpload!(storagePath,signal),{timeoutMs:CLEANUP_TIMEOUT_MS}).catch(()=>undefined)}
    try {
      if (!onResolveMediaUrl) throw new Error('Private chat image delivery is unavailable.')
      const uploaded=historySource?.uploadImage?await historySource.uploadImage(file,controller.signal):undefined
      if(uploaded){storagePath=uploaded.storagePath;registeredUpload=true}
      const mediaUrl = uploaded?.url||await prepareUploadedChatImage({
        clientFactory: (signal) => getScopedSupabaseClient(client, user.id, signal),
        file, storagePath, resolve: onResolveMediaUrl, signal: controller.signal,
      })
      if (!isCurrent() || controller.signal.aborted) return
      // Delivery owns the stable message identity after this point. Its existing
      // retry action handles unknown acknowledgements without uploading again.
      uploadingRef.current = false
      setUploading(false)
      const result = await sendMediaWithOwnership('image', mediaUrl, file.name, storagePath)
      outboxOwnsUpload=result.accepted
      if (!isCurrent()) return
      if (result.accepted) setPendingImage(null)
      else {
        setComposerError((current) => current || 'Image not sent. Retry the upload when chat is ready.')
        if(!uploaded)void boundedOperation(async (signal) => {
          const transport = await getScopedSupabaseClient(client, user.id, signal)
          signal.throwIfAborted()
          return transport.storage.from('chat-media').remove([storagePath])
        }, { timeoutMs: CLEANUP_TIMEOUT_MS }).catch(() => undefined)
      }
    } catch (error) {
      if (isCurrent()) setComposerError(controller.signal.aborted ? 'Upload cancelled. Your image and draft are kept.' : error instanceof Error ? error.message : 'Could not upload this image. Try again.')
    } finally {
      cleanupRegisteredUpload()
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null
      if (isCurrent()) { uploadingRef.current = false; setUploading(false) }
    }
  }

  const pasteMedia = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!isConnected||!canMedia||cooldownRemaining || uploadingRef.current || sendingRef.current) return
    const pastedMedia = readPastedChatMedia(event.clipboardData)
    if (!pastedMedia) return

    event.preventDefault()
    if (pastedMedia.kind === 'file') {
      await uploadImage(pastedMedia.file)
    } else {
      await sendMediaMessage(
        pastedMedia.media.type,
        pastedMedia.media.mediaUrl,
        pastedMedia.media.content
      )
    }
  }

  const loadGifs = useCallback(async (query = '') => {
    if (!giphyConfigured) return
    const requestId = ++giphyRequestRef.current
    const lifetime = lifetimeRef.current
    giphyAbortRef.current?.abort()
    const controller = new AbortController()
    giphyAbortRef.current = controller
    const normalizedQuery = query.trim()
    const cacheKey = normalizedQuery.toLocaleLowerCase()
    const cached = giphyCacheRef.current.get(cacheKey)
    if (cached) {
      setGifs(cached)
      setGifsLoading(false)
      return
    }

    setComposerError('')
    setGifsLoading(true)

    try {
      const { data } = await client.auth.getSession()
      if (!lifetime.active || requestId !== giphyRequestRef.current) return
      const results = await fetchGiphyGifs(normalizedQuery, data.session?.access_token, controller.signal)
      if (!lifetime.active || requestId !== giphyRequestRef.current) return
      giphyCacheRef.current.set(cacheKey, results)
      setGifs(results)
    } catch (error) {
      if (!lifetime.active || requestId !== giphyRequestRef.current) return
      setComposerError(error instanceof Error ? error.message : 'Could not load GIFs.')
      setGifs([])
    } finally {
      if (lifetime.active && requestId === giphyRequestRef.current) setGifsLoading(false)
    }
  }, [client, giphyConfigured])

  useEffect(() => {
    // Invalidate immediately, including cached results, the debounce window,
    // and closing the picker while a request is still in flight.
    giphyRequestRef.current += 1
    giphyAbortRef.current?.abort()
    if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
    giphyDebounceRef.current = null
    if (!showGiphy || !giphyConfigured) {
      setGifsLoading(false)
      return
    }

    const normalizedQuery = giphyQuery.trim()
    if (normalizedQuery.length === 1) {
      giphyRequestRef.current += 1
      setGifs([])
      setGifsLoading(false)
      return
    }
    if (!normalizedQuery) {
      void loadGifs()
    } else {
      setGifs([])
      setGifsLoading(true)
      giphyDebounceRef.current = setTimeout(
        () => void loadGifs(normalizedQuery),
        GIPHY_SEARCH_DEBOUNCE_MS
      )
    }
    return () => {
      giphyRequestRef.current += 1
      giphyAbortRef.current?.abort()
      if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
      giphyDebounceRef.current = null
    }
  }, [giphyConfigured, giphyQuery, loadGifs, showGiphy])

  const toggleGiphy = () => {
    setShowEmoji(false)
    setShowGiphy((current) => !current)
  }

  const closeHistorySearch = () => {
    setShowHistorySearch(false)
    history.clearSearch()
    historySearchButtonRef.current?.focus({ preventScroll: true })
  }
  const historyControls = (historyRoomSlug || notifications) ? (
    <div className={headerActionsContainer ? 'chat-header-tools' : 'chat-history-toolbar'}>
      {historyRoomSlug && <Button ref={historySearchButtonRef} type="button" variant="ghost" size="icon-sm" aria-label="Search room messages" title="Search room messages" aria-expanded={showHistorySearch} aria-controls={showHistorySearch ? historySearchId : undefined} onClick={() => { if (showHistorySearch) closeHistorySearch(); else setShowHistorySearch(true) }}><Search size={16} /></Button>}
      {notifications && <Button type="button" variant="ghost" size="icon-sm" aria-label={roomMuted ? 'Room muted' : 'Mute room'} aria-pressed={roomMuted} onClick={() => setRoomMuted(!roomMuted)} title={roomMuted ? 'Unmute room notifications' : 'Mute room notifications'}>{roomMuted ? <BellOff size={16} /> : <Bell size={16} />}</Button>}
    </div>
  ) : null
  const composerStatus = !canChat?restrictionMessage||'Chat is limited in this room.':cooldownRemaining?`Slow mode · ${cooldownRemaining}s`:uploading ? 'Uploading image…' : sending ? 'Sending…' : !isConnected ? 'Chat reconnecting · your draft stays here' : draftRestored ? 'Draft restored' : ''
  const openModeration = useCallback((kind: 'remove' | 'report', message: ChatMessage) => {
    setModerationTarget({ kind, message })
    setModerationReason('')
    setModerationError('')
  }, [])
  const openRemoveModeration = useCallback((message: ChatMessage) => openModeration('remove', message), [openModeration])
  const openReportModeration = useCallback((message: ChatMessage) => openModeration('report', message), [openModeration])
  const submitModeration = async () => {
    if (!moderationTarget || moderationPending) return
    const target = moderationTarget
    const action = target.kind === 'remove' ? onRemoveMessage : onReportMessage
    if (!action || (target.kind === 'remove' && (
      capabilities?.chatParticipants === false || (canRemoveMessage && !canRemoveMessage(target.message))
    ))) {
      setModerationError(target.kind === 'remove' ? 'You can no longer remove this message.' : 'Reporting is unavailable.')
      return
    }
    setModerationPending(true)
    setModerationError('')
    try {
      await action(target.message, moderationReason.trim())
      if (target.kind === 'remove') applyRemoval({ messageId: target.message.id, removedAt: new Date().toISOString() })
      setModerationTarget(null)
    } catch (error) {
      setModerationError(error instanceof Error ? error.message : 'Could not save. Try again.')
    } finally {
      setModerationPending(false)
    }
  }

  return (
    <div data-chat-surface data-chat-visible={isVisible} className="relative flex flex-col h-full w-full bg-background text-foreground antialiased">
      {headerActionsContainer ? createPortal(historyControls, headerActionsContainer) : historyControls}
      {showHistorySearch && <section id={historySearchId} className="chat-history-search" aria-label="Search room history" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeHistorySearch() } }}>
        <form onSubmit={(event) => { event.preventDefault(); void history.search(historySearchText) }}>
          <Input ref={historySearchInputRef} aria-label="Search all saved room messages" value={historySearchText} maxLength={100} placeholder="Search message text" onChange={(event) => setHistorySearchText(event.target.value)} />
          <Button size="sm" type="submit" disabled={history.searchLoading || historySearchText.trim().length < 2}>Search</Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Close room message search" onClick={closeHistorySearch}><X size={15} /></Button>
        </form>
        {history.searchLoading && <p role="status">Searching saved room messages…</p>}
        {history.searchError && <p role="alert">{history.searchError}</p>}
        {!history.searchLoading && history.searchTerm && !history.searchError && history.searchResults.length === 0 && <p>No saved messages match “{history.searchTerm}”.</p>}
        <div className="chat-history-results">{applyRemovalEvents([...history.searchResults].reverse(),removalEvents).filter(message=>!message.removedAt).map((message) => <button key={message.id} type="button" onClick={() => jumpToMessage(message.id)} aria-label={`View message from ${message.user.name}: ${getVisibleMessagePreview(message, hiddenIds)}`}><strong>{message.user.name}</strong><time>{new Date(message.createdAt).toLocaleString()}</time><span>{getVisibleMessagePreview(message, hiddenIds)}</span></button>)}</div>
        {history.searchHasMore && <Button variant="ghost" size="sm" disabled={history.searchLoading} onClick={() => void history.search(history.searchTerm, true)}>More search results</Button>}
      </section>}
      {history.context && <div className="chat-context-banner"><span>Earlier messages</span><Button variant="ghost" size="sm" onClick={returnToLive}>Back to live messages</Button></div>}
      {/* Messages */}
      <div ref={containerRef} className="chat-message-scroll flex-1 overflow-y-auto p-4 space-y-4">
        {(history.context ? history.context.hasOlder : history.hasOlder) && <div className="chat-history-pagination"><Button variant="ghost" size="sm" disabled={history.loadingOlder || history.contextLoading || historyLoading} onClick={() => {
          const restore = preserveAnchor()
          void (history.context ? history.extendContext('older') : history.loadOlder()).finally(restore)
        }}>{history.loadingOlder ? 'Loading older messages…' : 'Load older messages'}</Button></div>}
        {history.contextLoading && <p role="status">Loading message context…</p>}
        {history.historyError && <p role="alert" className="chat-history-error">{history.historyError}</p>}
        {visibleMessages.length === 0 && !historyLoading && !historyUnavailable && !history.historyError ? (
          <div className="text-center text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : null}
        <ChatMessageList
          messages={visibleMessages}
          hiddenIds={hiddenIds}
          onHiddenChange={handleHiddenChange}
          onResolveMediaUrl={onResolveMediaUrl}
          currentUserId={user.id}
          liveAdminUserIds={liveAdminUserIds}
          unreadMessageId={history.context ? undefined : unreadMessageIds[0]}
          onOpenProfile={onOpenProfile}
          onReply={selectReply}
          onReact={handleReaction}
          onJumpToMessage={jumpToMessage}
          saveStates={saveStates}
          onRetrySave={handleRetrySave}
          onRetrySend={handleRetrySend}
          onVotePoll={handlePollVote}
          pollVoteStates={pollVoteStates}
          pollVotingEnabled={isConnected&&canChat && Boolean(historySource?.votePoll)}
          participationDisabled={!canChat}
          onRemove={onRemoveMessage && capabilities?.chatParticipants !== false ? openRemoveModeration : undefined}
          onReport={onReportMessage ? openReportModeration : undefined}
          canRemoveMessage={canRemoveMessage}
        />
        {history.context?.hasNewer && <div className="chat-history-pagination"><Button variant="ghost" size="sm" disabled={history.contextLoading} onClick={() => void history.extendContext('newer')}>Load newer messages</Button></div>}
      </div>

      {(!isNearBottom || unreadMessageIds.length > 0) && (
        <button
          type="button"
          className="chat-scroll-button"
          onClick={() => {
            scrollToBottom()
            clearUnread()
          }}
        >
          <span>{unreadMessageIds.length > 0 ? `${unreadMessageIds.length} new` : 'Jump to latest'}</span>
          <ArrowDown className="size-4" />
        </button>
      )}

      {(showEmoji || showGiphy) && (
        <div className="chat-picker-popover" style={{ height: mediaPickerBounds.height, '--chat-picker-body-height': `${Math.max(0, mediaPickerBounds.height - 64)}px` } as CSSProperties} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setShowEmoji(false); setShowGiphy(false); messageInputRef.current?.focus({ preventScroll: true }) } }}>
          <div className="chat-picker-header">
          <div className="chat-picker-tabs" role="tablist" aria-label="Message media" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !giphyConfigured) return
            event.preventDefault()
            const emoji = event.key === 'End' || (event.key !== 'Home' && !showEmoji)
            setShowEmoji(emoji); setShowGiphy(!emoji)
            document.getElementById(`${mediaPanelId}-${emoji ? 'emoji' : 'gif'}`)?.focus()
          }}>
            <button
              type="button"
              id={`${mediaPanelId}-gif`}
              role="tab"
              aria-selected={showGiphy}
              tabIndex={showGiphy ? 0 : -1}
              aria-controls={mediaPanelId}
              className={showGiphy ? 'active' : undefined}
              disabled={!giphyConfigured}
              onClick={() => {
                setShowEmoji(false)
                setShowGiphy(true)
              }}
            >
              GIFs
            </button>
            <button
              type="button"
              id={`${mediaPanelId}-emoji`}
              role="tab"
              aria-selected={showEmoji}
              tabIndex={showEmoji ? 0 : -1}
              aria-controls={mediaPanelId}
              className={showEmoji ? 'active' : undefined}
              onClick={() => {
                setShowGiphy(false)
                setShowEmoji(true)
              }}
            >
              Emoji
            </button>
          </div>
            <button
              type="button"
              className="chat-picker-close"
              aria-label="Close media picker"
              onClick={() => { setShowEmoji(false); setShowGiphy(false); messageInputRef.current?.focus({ preventScroll: true }) }}
            >
              <X size={15} />
            </button>
          </div>
          {showEmoji ? (
            <div id={mediaPanelId} role="tabpanel" aria-labelledby={`${mediaPanelId}-emoji`} className="chat-emoji-panel">
              <Suspense fallback={<div className="chat-picker-loading">Loading emoji…</div>}>
                <EmojiPicker
                  theme={(resolvedTheme === 'light' ? 'light' : 'dark') as Theme}
                  width="100%"
                  height={Math.max(180, mediaPickerBounds.height - 64)}
                  lazyLoadEmojis
                  emojiStyle={chatPickerEmojiStyle}
                  defaultSkinTone={skinTone}
                  previewConfig={{ showPreview: false }}
                  searchPlaceholder="Find the perfect emoji"
                  onSkinToneChange={(selectedSkinTone) => {
                    setSkinTone(selectedSkinTone)
                    saveEmojiSkinTone(selectedSkinTone)
                  }}
                  onEmojiClick={(emoji) => {
                    const inserted = insertComposerText(draftMessageRef.current, emoji.emoji, selectionRef.current.start, selectionRef.current.end, selectedMentions)
                    if (!inserted) return
                    draftRevisionRef.current++
                    draftMessageRef.current = inserted.text
                    draftSnapshotRef.current.draft = { ...draftSnapshotRef.current.draft, text: inserted.text, mentions: inserted.mentions }
                    selectionRef.current = { start: inserted.caret, end: inserted.caret }
                    setSelectedMentions(inserted.mentions)
                    setDraftText(inserted.text)
                    setDraftRestored(false)
                    setHasDraft(Boolean(inserted.text.trim()))
                    noteTyping()
                    requestAnimationFrame(() => {
                      messageInputRef.current?.focus()
                      messageInputRef.current?.setSelectionRange(inserted.caret, inserted.caret)
                    })
                  }}
                />
              </Suspense>
            </div>
          ) : (
            <div id={mediaPanelId} role="tabpanel" aria-labelledby={`${mediaPanelId}-gif`} className="chat-gif-panel">
              <form
                className="chat-gif-search"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
                  giphyDebounceRef.current = null
                  void loadGifs(giphyQuery)
                }}
              >
                <Search size={16} aria-hidden="true" />
                <Input
                  value={giphyQuery}
                  onChange={(event) => setGiphyQuery(event.target.value)}
                  placeholder="Search GIFs"
                  maxLength={50}
                />
                {giphyQuery && (
                  <button type="button" aria-label="Clear GIF search" onClick={() => setGiphyQuery('')}>
                    <X size={14} />
                  </button>
                )}
                <button type="submit" className="sr-only">Search GIFs</button>
              </form>
              {gifsLoading ? (
                <div className="chat-gif-status">Loading GIFs…</div>
              ) : giphyQuery.trim().length === 1 ? (
                <div className="chat-gif-status">Type one more character to search.</div>
              ) : gifs.length === 0 ? (
                <div className="chat-gif-status">No GIFs found.</div>
              ) : (
                <div className="chat-gif-grid">
                  {[0, 1].map((column) => (
                    <div key={column}>
                      {gifs.filter((_, index) => index % 2 === column).map((gif) => (
                        <button
                          type="button"
                          key={gif.id}
                          className="chat-gif-tile"
                          onClick={() => {
                            const lifetime = lifetimeRef.current
                            void sendMediaMessage('gif', gif.url, gif.title || 'GIPHY GIF').then((sent) => {
                              if (sent && lifetime.active) setShowGiphy(false)
                            })
                          }}
                        >
                          <img referrerPolicy="no-referrer" src={approvedImageUrl(gif.preview)} alt={gif.title} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <p className="chat-gif-footer">Powered by GIPHY</p>
            </div>
          )}
        </div>
      )}

      {composerError && <p role="alert" className="px-4 pt-2 text-sm text-destructive">{composerError}</p>}
      {replyRestoreNotice && <p className="chat-reply-restore-notice">{replyRestoreNotice}</p>}
      {pollQuestion !== null && <ChatPollComposer key={pollComposerGenerationRef.current} initialQuestion={pollQuestion} onSubmit={handlePostPoll} onClose={closePollComposer} disabled={!isConnected||!canPoll||Boolean(cooldownRemaining) || sending || uploading} />}
      <form
        ref={composerRef}
        onSubmit={handleSendMessage}
        className={cn('chat-composer', { 'chat-composer-replying': Boolean(replyingTo) })}
        autoComplete="off"
      >
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={CHAT_IMAGE_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadImage(file)
            event.currentTarget.value = ''
          }}
        />
        {pendingImage && <div className="chat-pending-image">
          <span>{pendingImage.name}</span>
          {uploading ? <Button type="button" variant="ghost" size="sm" onClick={() => uploadAbortRef.current?.abort()}>Cancel upload</Button> : <>
            <Button type="button" variant="ghost" size="sm" disabled={!isConnected || sending} onClick={() => void uploadImage(pendingImage)}>Retry upload</Button>
            <Button type="button" variant="ghost" size="sm" aria-label="Remove attached image" onClick={() => setPendingImage(null)}><X size={14} /></Button>
          </>}
        </div>}
        <div className="chat-typing-indicator" aria-live="polite" aria-atomic="true">
          {typingLabel && <><i /><i /><i /><span>{typingLabel}</span></>}
        </div>
        {replyingTo && (
          <div className="chat-reply-composer">
            <Reply className="size-3.5" />
            <div>
              <span>
                Replying to <strong>@{replyingTo.user.name}</strong>
                {(replyingTo.user.isAppAdmin || liveAdminUserIds.has(replyingTo.user.id)) && <DevFlair className="chat-dev-flair" />}
              </span>
              <small><PlatformEmojiText text={getVisibleMessagePreview(replyingTo, hiddenIds)} /></small>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel reply"
              onClick={() => { draftRevisionRef.current++; restoredReplyIdRef.current = undefined; draftSnapshotRef.current.draft.replyToId = undefined; setReplyingTo(null) }}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="chat-mention-picker" id={mentionListId} role="listbox" aria-label="Tag a listener">
            <div className="chat-mention-picker-heading"><strong>Tag a listener</strong></div>
            {mentionCandidates.map((option, index) => (
              <button
                id={`${mentionListId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeMentionIndex}
                className={index === activeMentionIndex ? 'active' : undefined}
                key={option.user.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveMentionIndex(index)}
                onClick={() => chooseMention(option)}
              >
                <Avatar user={option.user} size={34} />
                <span><strong>{option.user.name}</strong><small>@{option.mention.handle}</small></span>
              </button>
            ))}
          </div>
        )}
        {commandCandidates.length > 0 && <div id={commandListId} className="chat-command-picker" role="listbox" aria-label="Chat commands">
          {commandCandidates.map((name, index) => <button
            id={`${commandListId}-${name}`} key={name} type="button" role="option"
            aria-selected={index === activeCommandIndex} className={index === activeCommandIndex ? 'active' : undefined}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveCommandIndex(index)}
            onClick={() => executeCommand(name)}
          ><code>/{name}</code><span>{name === 'queue' ? 'Open queue' : name === 'mute' ? roomMuted ? 'Unmute room notifications' : 'Mute room notifications' : name === 'search' ? 'Search room messages' : 'Create poll'}</span></button>)}
        </div>}
        <InputGroup className="chat-composer-bar">
          <Button
            className="chat-composer-add"
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected||!canMedia||Boolean(cooldownRemaining) || uploading || sending}
            aria-label="Upload image"
            title="Upload image"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-5" />
          </Button>
          <InputGroupTextarea
            ref={messageInputRef}
            className="chat-composer-input"
            rows={1}
            value={draftText}
            aria-label="Message room chat"
            aria-describedby={composerHintId}
            autoComplete="off"
            autoCorrect="off"
            aria-autocomplete="list"
            aria-controls={commandCandidates.length ? commandListId : mentionQuery && mentionCandidates.length ? mentionListId : undefined}
            aria-activedescendant={commandCandidates.length ? `${commandListId}-${commandCandidates[activeCommandIndex] || commandCandidates[0]}` : mentionQuery && mentionCandidates.length ? `${mentionListId}-${activeMentionIndex}` : undefined}
            data-form-type="other"
            maxLength={500}
            onSelect={(event) => { selectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }}
            onChange={(event) => {
              selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd }
              const nextMessage = event.target.value
              draftMessageRef.current = nextMessage
              draftRevisionRef.current++
              draftSnapshotRef.current.draft.text = nextMessage
              draftSnapshotRef.current.draft.mentions = activeMentions(nextMessage, selectedMentions)
              setDraftText(nextMessage)
              setCommandMenuDismissed(false)
              setActiveCommandIndex(0)
              setDraftRestored(false)
              const nextHasDraft = Boolean(nextMessage.trim())
              setHasDraft((current) => current === nextHasDraft ? current : nextHasDraft)
              setSelectedMentions((current) => current.length > 0
                ? activeMentions(nextMessage, current)
                : current)
              setMentionQuery(findMentionQuery(nextMessage, event.target.selectionStart))
              setActiveMentionIndex(0)
              if (nextMessage.trim()) noteTyping()
              else stopTyping()
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return
              if (event.key === 'Enter' && !event.shiftKey && event.repeat) { event.preventDefault(); return }
              if (commandCandidates.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setActiveCommandIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + commandCandidates.length) % commandCandidates.length)
              } else if (commandCandidates.length && !event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) {
                event.preventDefault()
                executeCommand(commandCandidates[activeCommandIndex] || commandCandidates[0])
              } else if (mentionQuery && mentionCandidates.length > 0 && event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveMentionIndex((current) => (current + 1) % mentionCandidates.length)
              } else if (mentionQuery && mentionCandidates.length > 0 && event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length)
              } else if (mentionQuery && mentionCandidates.length > 0 && !event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) {
                event.preventDefault()
                chooseMention(mentionCandidates[activeMentionIndex] || mentionCandidates[0])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setMentionQuery(null)
                setCommandMenuDismissed(true)
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onClick={(event) => setMentionQuery(findMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart))}
            onBlur={() => {
              setMentionQuery(null)
              setCommandMenuDismissed(true)
              stopTyping()
            }}
            onPaste={(event) => void pasteMedia(event)}
            placeholder="Message the room, or / for commands"
          />
          <Button
            className="chat-composer-gif"
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected||!canMedia||Boolean(cooldownRemaining) || !giphyConfigured || uploading || sending}
            aria-label={giphyConfigured ? 'Add GIF' : 'GIFs unavailable'}
            title={giphyConfigured ? 'Add GIF' : 'GIFs are unavailable in this room'}
            onClick={toggleGiphy}
          >
            <span>GIF</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected}
            aria-label="Add emoji"
            title="Add emoji"
            onPointerDown={() => { if (messageInputRef.current) selectionRef.current = { start: messageInputRef.current.selectionStart, end: messageInputRef.current.selectionEnd } }}
            onClick={() => { setShowGiphy(false); setShowEmoji((current) => !current) }}
          >
            <Smile className="size-[18px]" />
          </Button>
          <Button
            className="chat-send-button"
            type="submit"
            size="icon"
            disabled={(!isConnected && !commandDraft)||(!commandDraft&&(!canChat||Boolean(cooldownRemaining))) || uploading || sending || !hasDraft}
            aria-label={commandDraft ? 'Run chat command' : sending ? 'Sending message' : 'Send message'}
            title={commandDraft ? 'Run chat command (Enter)' : 'Send message (Enter)'}
          >
            <Send className="size-4" />
          </Button>
        </InputGroup>
        <span id={composerHintId} className="sr-only">Enter to send. Shift+Enter for a new line. Type / for commands. Maximum 500 characters.</span>
        {(composerStatus || draftText.length >= 450) && <div className="chat-composer-hint">
          <span role="status">{composerStatus}</span>
          {draftText.length >= 450 && <span>{draftText.length}/500</span>}
        </div>}
      </form>
      <Dialog open={Boolean(moderationTarget)} onOpenChange={open=>{if(!open&&!moderationPending)setModerationTarget(null)}}><DialogContent><DialogHeader><DialogTitle>{moderationTarget?.kind==='remove'?'Remove message':'Report message'}</DialogTitle></DialogHeader><form className="grid gap-4" onSubmit={event=>{event.preventDefault();void submitModeration()}}><div className="grid gap-2"><Label htmlFor="chat-moderation-reason">Reason{moderationTarget?.kind==='remove'?' (optional)':''}</Label><Input id="chat-moderation-reason" maxLength={500} value={moderationReason} disabled={moderationPending} required={moderationTarget?.kind==='report'} onChange={event=>setModerationReason(event.target.value)}/></div>{moderationError&&<p role="alert">{moderationError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={moderationPending} onClick={()=>setModerationTarget(null)}>Cancel</Button><Button type="submit" variant={moderationTarget?.kind==='remove'?'destructive':'default'} disabled={moderationPending||moderationTarget?.kind==='report'&&!moderationReason.trim()}>{moderationPending?'Saving…':moderationTarget?.kind==='remove'?'Remove':'Report'}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>
  )
})
