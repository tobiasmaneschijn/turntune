import twemoji from '@twemoji/api'
import { useLayoutEffect, useRef } from 'react'
import type { EmojiStyle, SkinTones } from 'emoji-picker-react'

const SKIN_TONE_STORAGE_KEY = 'soundspin:emoji-skin-tone'
const VALID_SKIN_TONES = new Set<SkinTones>([
  'neutral' as SkinTones,
  '1f3fb' as SkinTones,
  '1f3fc' as SkinTones,
  '1f3fd' as SkinTones,
  '1f3fe' as SkinTones,
  '1f3ff' as SkinTones,
])

/** Apple platforms have complete native emoji; other desktop platforms use Twemoji. */
export const usesNativeAppleEmoji = typeof navigator !== 'undefined'
  && /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent)

export const chatPickerEmojiStyle = (usesNativeAppleEmoji ? 'native' : 'twitter') as EmojiStyle

export const readEmojiSkinTone = (): SkinTones => {
  if (typeof window === 'undefined') return 'neutral' as SkinTones

  try {
    const storedTone = window.localStorage.getItem(SKIN_TONE_STORAGE_KEY) as SkinTones | null
    return storedTone && VALID_SKIN_TONES.has(storedTone) ? storedTone : 'neutral' as SkinTones
  } catch {
    return 'neutral' as SkinTones
  }
}

export const saveEmojiSkinTone = (skinTone: SkinTones) => {
  try {
    window.localStorage.setItem(SKIN_TONE_STORAGE_KEY, skinTone)
  } catch {
    // Emoji selection still works if browser storage is unavailable.
  }
}

interface PlatformEmojiTextProps {
  text: string
  className?: string
}

/**
 * Renders Unicode text natively on Apple devices and with Twemoji everywhere
 * else. Message data remains plain Unicode, so it stays searchable and portable.
 */
export const PlatformEmojiText = ({ text, className }: PlatformEmojiTextProps) => {
  const elementRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || usesNativeAppleEmoji) return

    // React owns the wrapper; Twemoji only replaces emoji inside its text nodes.
    element.textContent = text
    twemoji.parse(element, {
      base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/',
      className: 'chat-platform-emoji-image',
      ext: '.svg',
      folder: 'svg',
    })
  }, [text])

  return <span ref={elementRef} className={className}>{text}</span>
}
