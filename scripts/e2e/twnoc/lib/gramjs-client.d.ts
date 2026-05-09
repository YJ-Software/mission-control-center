import type { TelegramClient } from 'telegram'

export interface MakeClientInput {
  apiId: string | number
  apiHash: string
  session?: string
}

export function makeClient(input: MakeClientInput): TelegramClient

export interface DmBotInput {
  botUsername: string
  text: string
  timeoutMs?: number
}

export function dmBotAndAwaitReply(client: TelegramClient, input: DmBotInput): Promise<string>
