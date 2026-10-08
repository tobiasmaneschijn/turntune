import assert from 'node:assert/strict'
import test from 'node:test'
import { chatCommandSuggestions, parseChatCommand } from '../src/chat/commands'

test('commands match complete names and keep search/poll arguments intact', () => {
  assert.deepEqual(parseChatCommand(' /SEARCH tonight  '), { name: 'search', arguments: 'tonight' })
  assert.deepEqual(parseChatCommand('/poll What next?'), { name: 'poll', arguments: 'What next?' })
  assert.deepEqual(parseChatCommand('/queue'), { name: 'queue', arguments: '' })
  assert.deepEqual(parseChatCommand('/mute music'), { name: 'mute', arguments: 'music' })
})

test('ordinary messages stay text while unknown or partial slash commands remain local', () => {
  assert.equal(parseChatCommand('Listen to /queue'), null)
  assert.equal(parseChatCommand('https://example.com/search'), null)
  assert.equal(parseChatCommand('//queue'), null)
  assert.deepEqual(parseChatCommand('/qu'), { name: null, arguments: '' })
  assert.deepEqual(parseChatCommand('/unknown secret'), { name: null, arguments: 'secret' })
})

test('suggestions filter the first command token without intercepting search queries', () => {
  assert.deepEqual(chatCommandSuggestions('/'), ['queue', 'mute', 'search', 'poll'])
  assert.deepEqual(chatCommandSuggestions('/Q'), ['queue'])
  assert.deepEqual(chatCommandSuggestions('/search'), ['search'])
  assert.deepEqual(chatCommandSuggestions('/search query'), [])
  assert.deepEqual(chatCommandSuggestions('text /'), [])
})
