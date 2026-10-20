import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Heart, LoaderCircle, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProviderIcon } from '@/features/music/components/ProviderIcon'
import { createChatLinkPreviewLoader, type ChatLinkPreview, type ChatLinkPreviewLoader } from '../link-previews'
import { isChatLinkPreview } from '../../../../shared/chat-link-preview'
import '@/styles/chat-link-preview.css'

interface Props {
  url: string
  roomSlug: string
  accessToken: string
  loadPreview?: ChatLinkPreviewLoader
  onAddToQueue?: (url: string) => void | Promise<void>
  onSave?: (url: string) => void | Promise<void>
}
type ActionState = 'idle' | 'pending' | 'done'

/** Load only cards near the visible conversation; room/account changes cancel old work. */
export function ChatLinkPreviewCard({ url, roomSlug, accessToken, loadPreview, onAddToQueue, onSave }: Props) {
  const { t } = useTranslation('chat')
  const slotRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<{ url: string; load: ChatLinkPreviewLoader; value: ChatLinkPreview | null } | null>(null)
  const [hidden, setHidden] = useState(false)
  const [queueState, setQueueState] = useState<ActionState>('idle')
  const [saveState, setSaveState] = useState<ActionState>('idle')
  const [error, setError] = useState('')
  const actionLifetime = useRef({ active: true })
  const load = useMemo(() => loadPreview || createChatLinkPreviewLoader(accessToken, roomSlug), [accessToken, roomSlug, loadPreview])
  const preview = result?.load === load && result.url === url ? result.value : null
  useEffect(() => {
    const lifetime = { active: true }
    actionLifetime.current = lifetime
    setHidden(false); setResult(null); setQueueState('idle'); setSaveState('idle'); setError('')
    return () => { lifetime.active = false }
  }, [url, load])
  useEffect(() => {
    const anchor = slotRef.current
    if (!anchor || hidden) return
    const controller = new AbortController()
    let requested = false
    const request = () => {
      if (requested) return
      requested = true
      void load(url, controller.signal).then(value => {
        if (!controller.signal.aborted) setResult({ url, load, value: isChatLinkPreview(value) ? value : null })
      }).catch(() => { /* The original text link remains usable. */ })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); request() }
    }, { rootMargin: '160px' })
    if (observer) observer.observe(anchor)
    else request()
    return () => { controller.abort(); observer?.disconnect() }
  }, [hidden, load, url])
  if (hidden) return null

  const act = async (action: ((value: string) => void | Promise<void>) | undefined, setState: (state: ActionState) => void) => {
    if (!action || !preview) return
    const lifetime = actionLifetime.current
    setState('pending'); setError('')
    try { await action(preview.url); if (lifetime.active) setState('done') }
    catch (failure) {
      if (!lifetime.active) return
      setState('idle')
      setError(failure instanceof Error && failure.message.length <= 200 ? failure.message : t('linkActionFailed'))
    }
  }
  return <div ref={slotRef} className="chat-link-preview-slot">
    {preview && <article className="chat-link-preview" aria-label={t('linkPreview')}>
      <Button variant="ghost" size="icon-xs" className="chat-link-preview-hide" aria-label={t('hideLinkPreview')} onClick={() => setHidden(true)}><X size={14} /></Button>
      <a className="chat-link-preview-main" href={preview.url} target="_blank" rel="noopener noreferrer">
        {preview.image && <img src={preview.image} alt="" className={preview.musicProvider ? 'chat-link-preview-cover' : undefined} />}
        <span className="chat-link-preview-copy">
          <span className="chat-link-preview-site">{preview.musicProvider && <ProviderIcon provider={preview.musicProvider} size={14} />}{new URL(preview.url).hostname.replace(/^www\./, '')}</span>
          <strong>{preview.title}</strong>
          {preview.description && <span className="chat-link-preview-description">{preview.description}</span>}
        </span>
      </a>
      {preview.musicProvider && (onAddToQueue || onSave) && <div className="chat-link-preview-actions">
        {onAddToQueue && <Button variant="ghost" size="sm" disabled={queueState !== 'idle'} aria-busy={queueState === 'pending'} onClick={() => void act(onAddToQueue, setQueueState)}>
          {queueState === 'pending' ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : queueState === 'done' ? <Check size={14} /> : <Plus size={14} />}{t(queueState === 'done' ? 'addedLinkToQueue' : 'addLinkToQueue')}
        </Button>}
        {onSave && <Button variant="ghost" size="sm" disabled={saveState !== 'idle'} aria-busy={saveState === 'pending'} onClick={() => void act(onSave, setSaveState)}>
          {saveState === 'pending' ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : saveState === 'done' ? <Check size={14} /> : <Heart size={14} />}{t(saveState === 'done' ? 'savedMusicLink' : 'saveMusicLink')}
        </Button>}
      </div>}
      {error && <p className="chat-link-preview-error" role="alert">{error}</p>}
    </article>}
  </div>
}
