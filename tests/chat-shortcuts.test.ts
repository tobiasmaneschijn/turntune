import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isEditableShortcutTarget,
  matchesKeyboardShortcut,
  type KeyboardShortcut,
} from '../src/hooks/use-keyboard-shortcuts.js'

const focusChat: KeyboardShortcut = {
  id: 'focus-chat',
  label: 'Focus room chat',
  key: '/',
  run: () => undefined,
}

test('matches the unmodified chat shortcut and rejects modified variants', () => {
  assert.equal(matchesKeyboardShortcut({ key: '/', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, focusChat), true)
  assert.equal(matchesKeyboardShortcut({ key: '/', altKey: false, ctrlKey: false, metaKey: false, shiftKey: true }, focusChat), true)
  assert.equal(matchesKeyboardShortcut({ key: '/', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false }, focusChat), false)
})

test('recognizes editable shortcut targets without requiring browser globals', () => {
  assert.equal(isEditableShortcutTarget({ tagName: 'INPUT' } as unknown as EventTarget), true)
  assert.equal(isEditableShortcutTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true)
  assert.equal(isEditableShortcutTarget({ tagName: 'BUTTON' } as unknown as EventTarget), false)
})
