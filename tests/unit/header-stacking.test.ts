import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Two stacking invariants that are invisible until someone opens the
 * notification bell on a page that happens to have a card under it.
 *
 * `<header>` carries `backdrop-blur`, and an element with a backdrop-filter
 * becomes (a) its own stacking context and (b) the containing block for any
 * `position: fixed` descendant. `.cyber-card` also sets position:relative +
 * backdrop-filter, so every content card is a stacking context as well. With
 * the header at z-index auto, header and cards rank as peers and the cards —
 * later in the DOM — paint over anything inside the header, including the
 * dropdown's own z-50.
 *
 * Neither of these reads as load-bearing at the call site, which is exactly
 * why they need a test rather than a comment alone.
 */

function read(...parts: string[]) {
  return readFileSync(join('src', 'components', 'layout', ...parts), 'utf8')
}

/** z-index of the topmost overlay layer (Sheet / Dialog / AlertDialog). */
const OVERLAY_Z = 50

describe('header stacking context', () => {
  const src = read('header.tsx')
  const openingTag = src.match(/<header\s+className="([^"]+)"/)

  it('renders a <header> with a className', () => {
    expect(openingTag).not.toBeNull()
  })

  it('sets an explicit z-index, because backdrop-blur makes it a stacking context', () => {
    const cls = openingTag![1]
    expect(cls).toMatch(/\bbackdrop-blur\b/)

    const z = cls.match(/\bz-(\d+)\b/)
    expect(
      z,
      'header needs an explicit z-index or page cards will paint over the notification dropdown',
    ).not.toBeNull()
    expect(Number(z![1])).toBeGreaterThan(0)
  })

  it('stays below the overlay layer so dialogs and the mobile drawer still win', () => {
    const z = Number(openingTag![1].match(/\bz-(\d+)\b/)![1])
    expect(z).toBeLessThan(OVERLAY_Z)
  })
})

describe('notification toasts', () => {
  const src = read('notification-center.tsx')

  it('portals the toast layer out of the header', () => {
    expect(src).toMatch(/createPortal\(/)
    expect(src).toMatch(/document\.body/)
  })

  it('keeps the fixed toast container inside that portal', () => {
    // Everything from `createPortal(` to `document.body` is the portalled tree.
    const portalled = src.slice(src.indexOf('createPortal('), src.indexOf('document.body'))
    expect(
      portalled,
      'the fixed toast container must be portalled; inside <header> its backdrop-filter ' +
        'becomes the containing block and bottom-4 resolves against the 48px header',
    ).toMatch(/className="fixed bottom-4 right-4/)
  })

  it('guards the portal behind a mount flag so SSR does not touch document', () => {
    expect(src).toMatch(/\{mounted && createPortal\(/)
  })
})
