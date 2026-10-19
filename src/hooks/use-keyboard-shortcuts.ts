import { useEffect, useRef } from 'react'

export interface KeyboardShortcut {
  id: string
  label: string
  key: string
  enabled?: boolean
  modifiers?: Partial<Record<'alt' | 'ctrl' | 'meta' | 'shift', boolean>>
  run: () => void
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tagName = element.tagName?.toLocaleLowerCase()
  return Boolean(
    element.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

export function matchesKeyboardShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  shortcut: KeyboardShortcut
): boolean {
  const modifiers = shortcut.modifiers || {}
  return event.key.toLocaleLowerCase() === shortcut.key.toLocaleLowerCase() &&
    event.altKey === Boolean(modifiers.alt) &&
    event.ctrlKey === Boolean(modifiers.ctrl) &&
    event.metaKey === Boolean(modifiers.meta) &&
    (modifiers.shift === undefined || event.shiftKey === modifiers.shift)
}

function dialogOwnsFocus(): boolean {
  const activeElement = document.activeElement as HTMLElement | null
  return Boolean(activeElement?.closest('[role="dialog"], dialog[open]'))
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isEditableShortcutTarget(event.target) ||
        dialogOwnsFocus()
      ) return

      const shortcut = shortcutsRef.current.find((candidate) =>
        candidate.enabled !== false && matchesKeyboardShortcut(event, candidate)
      )
      if (!shortcut) return
      event.preventDefault()
      shortcut.run()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
