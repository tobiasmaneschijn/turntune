import assert from 'node:assert/strict'
import test from 'node:test'

import { validateChatImage, createChatStoragePath, CHAT_IMAGE_MAX_BYTES } from '../../../src/features/chat/media.js'

test('Upload images with validated types and safe filenames', () => {
  assert.match(validateChatImage(new File(['svg'], 'photo.svg', { type: 'image/svg+xml' })) || '', /JPEG, PNG, WebP, or GIF/)
  assert.match(validateChatImage({ type: 'image/png', size: CHAT_IMAGE_MAX_BYTES + 1 } as File) || '', /6 MB/)
  assert.equal(validateChatImage(new File(['png'], 'photo.png', { type: 'image/png' })), null)
  const path = createChatStoragePath('listener', 'soundspin:room', new File(['png'], 'image.html', { type: 'image/png' }))
  assert.match(path, /^listener\/soundspin-room\/[\w-]+\.png$/)
})
