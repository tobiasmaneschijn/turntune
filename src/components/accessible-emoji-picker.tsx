import { useTranslation } from 'react-i18next'
import { useId, useMemo, useState } from 'react'
import EmojiPicker, { Categories, Emoji, type EmojiClickData, type Props, type SkinTones } from 'emoji-picker-react'
import type { EmojiData } from 'emoji-picker-react/dist/types/exposedTypes'
import emojiData from 'emoji-picker-react/dist/data/emojis.json'

const tones = [
  ['neutral', 'toneDefault'], ['1f3fb', 'toneLight'], ['1f3fc', 'toneMediumLight'],
  ['1f3fd', 'toneMedium'], ['1f3fe', 'toneMediumDark'], ['1f3ff', 'toneDark'],
]
const emojis = Object.values((emojiData as EmojiData).emojis).flat()

/** The library's search references a status node that is absent before typing.
 * Use its supported searchDisabled option and a stable, native search/result relationship.
 */
export default function AccessibleEmojiPicker(props: Props) {
  const { t, i18n } = useTranslation('chat')
  const [query, setQuery] = useState('')
  const resultsId = useId()
  const term = query.trim().toLocaleLowerCase(i18n.resolvedLanguage)
  const results = useMemo(() => term ? emojis.filter((emoji) => emoji.n.some((name) => name.toLocaleLowerCase(i18n.resolvedLanguage).includes(term))) : [], [term, i18n.resolvedLanguage])
  const categories = Object.values(Categories).map((category) => ({ category, name: t(`category.${category}`) }))
  const tone = props.defaultSkinTone || 'neutral'
  const height = typeof props.height === 'number' ? Math.max(100, props.height - 48) : props.height
  return <div className="chat-accessible-emoji-picker">
    <div className="chat-emoji-search-row">
      <input type="search" aria-label={t('searchEmoji')} aria-controls={resultsId} placeholder={props.searchPlaceholder || t('searchEmoji')} autoFocus={props.autoFocusSearch !== false} value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label={t('emojiSkinTone')} value={tone} onChange={(event) => props.onSkinToneChange?.(event.target.value as SkinTones)}>
        {tones.map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}
      </select>
    </div>
    <div id={resultsId}>
      {term ? <>
        <p className="sr-only" role="status">{t('emojiFound', { count: results.length })}</p>
        {results.length ? <div className="chat-emoji-results" style={{ maxHeight: height }}>
          {results.map((item) => {
            const unified = tone === 'neutral' ? item.u : item.v?.find((variation) => variation.includes(tone)) || item.u
            const label = item.n[item.n.length - 1]
            return <button className="epr-emoji" key={item.u} type="button" aria-label={label} onClick={(event) => {
              const data: EmojiClickData = {
                emoji: String.fromCodePoint(...unified.split('-').map((part) => parseInt(part, 16))),
                unified, unifiedWithoutSkinTone: item.u, names: item.n,
                activeSkinTone: tone as SkinTones, isCustom: false,
                imageUrl: '', getImageUrl: () => '',
              }
              props.onEmojiClick?.(data, event.nativeEvent)
            }}><Emoji unified={unified} emojiStyle={props.emojiStyle} size={28} /></button>
          })}
        </div> : <p className="chat-emoji-empty">{t('noEmoji')}</p>}
      </> : <EmojiPicker {...props} categories={categories} height={height} autoFocusSearch={false} searchDisabled skinTonesDisabled previewConfig={{ showPreview: false }} />}
    </div>
  </div>
}
