import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateChatPickerBounds } from '../src/hooks/use-chat-picker-bounds'

test('media and reaction geometry respect the actual pane, composer and visual viewport', () => {
  for (const height of [600, 390, 380]) {
    const viewport = { left: 0, top: 0, width: 390, height }
    const surface = { left: 8, right: 382, top: 80, bottom: height - 8, width: 374 }
    const anchor = { ...surface, top: height - 130, bottom: height - 105 }
    for (const placement of ['composer', 'message'] as const) {
      const bounds = calculateChatPickerBounds(surface, height - 90, anchor, viewport, placement)
      assert.ok(bounds.top >= 88); assert.ok(bounds.top + bounds.height <= height - 98)
      assert.ok(bounds.left >= 8); assert.ok(bounds.left + bounds.width <= 382)
    }
  }
})
