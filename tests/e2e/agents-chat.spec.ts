import { test } from './fixtures/login'
import { sendChatAndExpectReply } from './utils/chat-turn'

test('chat: send a message and receive a reply', async ({ loggedInPage: page, baseURL }) => {
  // Strict failure detection (error state + failure text) lives in the helper.
  await sendChatAndExpectReply(page, baseURL!, '回我一個 OK')
})
