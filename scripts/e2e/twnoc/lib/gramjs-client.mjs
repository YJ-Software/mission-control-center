import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'

export function makeClient({ apiId, apiHash, session }) {
  return new TelegramClient(
    new StringSession(session ?? ''),
    Number(apiId),
    apiHash,
    { connectionRetries: 5 }
  )
}

/**
 * DM `botUsername` with `text`, then return the bot's first reply (text only)
 * received within `timeoutMs`. Throws on timeout.
 */
export async function dmBotAndAwaitReply(client, { botUsername, text, timeoutMs = 30_000 }) {
  await client.connect()
  const lastIdBefore = await getLastMessageId(client, botUsername)
  await client.sendMessage(botUsername, { message: text })

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1_500))
    const messages = await client.getMessages(botUsername, { limit: 5 })
    for (const m of messages) {
      if (m.id <= lastIdBefore) continue
      if (m.out) continue
      if (m.message) return m.message
    }
  }
  throw new Error(`No reply from ${botUsername} within ${timeoutMs}ms`)
}

async function getLastMessageId(client, username) {
  const msgs = await client.getMessages(username, { limit: 1 })
  return msgs[0]?.id ?? 0
}
