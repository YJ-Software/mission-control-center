import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The About tab renders its feature cards by pairing the i18n `features` array
 * with a FEATURE_ICONS array positionally. Adding a feature without adding an
 * icon doesn't break anything visibly — the extra cards just fall back to the
 * generic info glyph — so it goes unnoticed.
 */

const LOCALES = ['zh-TW', 'zh-CN', 'en'] as const

function about(locale: string) {
  return JSON.parse(readFileSync(join('messages', `${locale}.json`), 'utf8'))
    .morningReport.about as {
      features: { title: string; body: string }[]
      pipeline: { label: string; desc: string }[]
    }
}

function iconCount(): number {
  const src = readFileSync(
    join('src', 'components', 'morning-report', 'morning-report-about-panel.tsx'),
    'utf8',
  )
  const block = src.match(/const FEATURE_ICONS = \[([\s\S]*?)\]/)
  if (!block) throw new Error('FEATURE_ICONS not found')
  return block[1].split(',').map((s) => s.trim()).filter(Boolean).length
}

describe('morning report About tab', () => {
  it('has an icon for every feature', () => {
    expect(iconCount()).toBe(about('zh-TW').features.length)
  })

  it('describes the same features in every locale', () => {
    // A locale left behind renders a shorter list rather than an error.
    const counts = LOCALES.map((l) => about(l).features.length)
    expect(new Set(counts).size).toBe(1)
  })

  it('has the same pipeline steps in every locale', () => {
    const counts = LOCALES.map((l) => about(l).pipeline.length)
    expect(new Set(counts).size).toBe(1)
  })

  it('leaves no feature or step without text', () => {
    for (const l of LOCALES) {
      const a = about(l)
      for (const f of a.features) {
        expect(f.title?.trim(), `${l} feature title`).toBeTruthy()
        expect(f.body?.trim(), `${l} feature body`).toBeTruthy()
      }
      for (const s of a.pipeline) {
        expect(s.label?.trim(), `${l} step label`).toBeTruthy()
        expect(s.desc?.trim(), `${l} step desc`).toBeTruthy()
      }
    }
  })
})
