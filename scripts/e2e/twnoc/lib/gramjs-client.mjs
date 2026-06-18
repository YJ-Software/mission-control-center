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
 * DM `botUsername` with `text`, then return the bot's reply (text only) received
 * within `timeoutMs`. Returns the NEWEST incoming reply (so a re-sent `/start`
 * yields the latest pairing code).
 *
 * A freshly-deployed bot can miss the very first message while its polling
 * ingress is still starting up (the Phase-5 race we hit: bot "starting provider"
 * lands right as the test DMs `/start`). To make this robust we re-send `text`
 * every `resendEveryMs` until a reply arrives — bots answer reliably once
 * polling has settled. Throws on timeout.
 */
export async function dmBotAndAwaitReply(
  client,
  { botUsername, text, timeoutMs = 120_000, resendEveryMs = 20_000 },
) {
  await client.connect()
  const lastIdBefore = await getLastMessageId(client, botUsername)
  await client.sendMessage(botUsername, { message: text })

  const start = Date.now()
  let lastSend = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1_500))
    const messages = await client.getMessages(botUsername, { limit: 5 })
    const replies = messages
      .filter(m => m.id > lastIdBefore && !m.out && m.message)
      .sort((a, b) => b.id - a.id)
    if (replies.length) return replies[0].message
    // Re-send if the bot hasn't answered yet — covers the polling-startup race.
    if (resendEveryMs && Date.now() - lastSend >= resendEveryMs) {
      lastSend = Date.now()
      await client.sendMessage(botUsername, { message: text })
    }
  }
  throw new Error(`No reply from ${botUsername} within ${timeoutMs}ms`)
}

async function getLastMessageId(client, username) {
  const msgs = await client.getMessages(username, { limit: 1 })
  return msgs[0]?.id ?? 0
}
