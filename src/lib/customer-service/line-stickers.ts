/**
 * Curated list of LINE sticker packs that any LINE Messaging API bot
 * can send for free. Source:
 *   https://developers.line.biz/en/docs/messaging-api/sticker-list/
 *
 * Operators pick from these via the sticker picker in the conversation
 * composer. We render thumbnails by URL pattern:
 *   https://stickershop.line-scdn.net/stickershop/v1/sticker/{stickerId}/android/sticker.png
 *
 * Use the `/android/` path (not `/iPhone/`): the iPhone variant of older
 * packs (e.g. 446) is encoded as Apple's CgBI extended PNG, which Chrome
 * and Firefox refuse to decode — the picker would show only broken-image
 * placeholders. The android variant is a standard PNG and works for
 * every pack.
 *
 * Adding more packs is just appending here. The LINE list is sparsely
 * numbered (some package IDs skip), so we keep explicit ranges per pack
 * rather than computing them.
 */

function range(from: number, to: number): string[] {
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push(String(i))
  return out
}

export interface StickerPack {
  packageId: string
  name: string
  stickerIds: string[]
}

export const STICKER_PACKS: StickerPack[] = [
  { packageId: '446', name: 'LINE Friends', stickerIds: range(1988, 2027) },
  { packageId: '789', name: 'LINE Friends 2', stickerIds: range(10855, 10876) },
  { packageId: '11537', name: 'Brown & Cony', stickerIds: range(52002734, 52002773) },
  { packageId: '11538', name: 'Choco & Sally', stickerIds: range(52002735, 52002773) },
  { packageId: '11539', name: 'James & Edward', stickerIds: range(52114110, 52114149) },
]

export function stickerImageUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(stickerId)}/android/sticker.png`
}
