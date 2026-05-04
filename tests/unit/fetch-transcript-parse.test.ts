import { describe, it, expect } from 'vitest'
import { extractVideoId, sanitizeFilename } from '../../src/lib/second-brain/skills/templates/youtube-transcript/scripts/fetch-transcript.mjs'

describe('extractVideoId', () => {
  it('parses youtu.be short form', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses youtube.com watch form', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5')).toBe('dQw4w9WgXcQ')
  })
  it('parses embed form', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses shorts form', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('accepts bare video id', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('throws on junk', () => {
    expect(() => extractVideoId('not a url')).toThrow(/Cannot extract/)
  })
})

describe('sanitizeFilename', () => {
  it('strips path separators and invalid chars', () => {
    expect(sanitizeFilename('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i')
  })
  it('collapses whitespace and trims', () => {
    expect(sanitizeFilename('  hello   world  ')).toBe('hello world')
  })
  it('caps at 180 chars', () => {
    expect(sanitizeFilename('x'.repeat(500)).length).toBe(180)
  })
})
