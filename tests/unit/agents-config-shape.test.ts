import { describe, expect, it } from 'vitest'
import {
  agentsToList,
  applyAgentOverride,
  detectAgentsShape,
} from '@/lib/openclaw/models-config'

// OpenClaw 2026.8.1 replaced the per-agent config array `agents.list[]` with a
// keyed map `agents.entries{}`. MCC read the old path, and its only tolerance
// was for stderr containing "not found" — 2026.8.1 says "Unknown config path:
// agents.list" instead, so getAgentsList() threw, /api/openclaw/models/overrides
// returned {error}, and the Models tab (which maps over the array) crashed into
// the "This page couldn't load" boundary. Verified on a throwaway VPS
// 2026-08-31 against OpenClaw 2026.8.1.
//
// These tests pin both shapes, and — the part that would silently destroy user
// config — that writing an override preserves every other key on the entry.

describe('detectAgentsShape', () => {
  it('detects the 2026.8.1 keyed-map shape', () => {
    expect(detectAgentsShape({ entries: { main: {} } })).toBe('entries')
  })

  it('detects the legacy array shape', () => {
    expect(detectAgentsShape({ list: [{ id: 'main' }] })).toBe('list')
  })

  // A fresh pre-2026.8.1 openclaw.json has neither; legacy write path is the
  // safe default there because those builds have no agents.entries at all.
  it('falls back to the legacy shape when neither is present', () => {
    expect(detectAgentsShape({})).toBe('list')
    expect(detectAgentsShape(undefined)).toBe('list')
  })
})

describe('agentsToList', () => {
  it('flattens the keyed-map shape', () => {
    const out = agentsToList({
      entries: { main: { model: { primary: 'kimi/kimi-code' } }, research: {} },
    })
    expect(out).toEqual([
      { id: 'main', model: { primary: 'kimi/kimi-code' } },
      { id: 'research', model: undefined },
    ])
  })

  it('reads the legacy array shape', () => {
    const out = agentsToList({ list: [{ id: 'main', model: { primary: 'a/b' } }] })
    expect(out).toEqual([{ id: 'main', model: { primary: 'a/b' } }])
  })

  it('drops entries with unsafe ids', () => {
    const out = agentsToList({ entries: { 'bad id!': {}, ok: {} } })
    expect(out.map((e) => e.id)).toEqual(['ok'])
  })

  it('survives junk', () => {
    expect(agentsToList(undefined)).toEqual([])
    expect(agentsToList({ entries: 'nope' })).toEqual([])
    expect(agentsToList({ list: 'nope' })).toEqual([])
  })
})

describe('applyAgentOverride', () => {
  it('writes into agents.entries on the new shape', () => {
    const res = applyAgentOverride(
      { entries: { main: {} } },
      'main',
      { primary: 'kimi/kimi-code' },
    )
    expect(res.path).toBe('agents.entries')
    expect(res.value).toEqual({ main: { model: { primary: 'kimi/kimi-code' } } })
  })

  // The dangerous one: entries carry more than `model`. Rewriting the map from
  // our reduced {id, model} view would silently delete the rest of the agent's
  // configuration.
  it('preserves other keys on the entry it touches', () => {
    const res = applyAgentOverride(
      { entries: { main: { prompt: 'hi', tools: ['a'] } } },
      'main',
      { primary: 'x/y' },
    )
    expect(res.value).toEqual({
      main: { prompt: 'hi', tools: ['a'], model: { primary: 'x/y' } },
    })
  })

  it('preserves sibling agents', () => {
    const res = applyAgentOverride(
      { entries: { main: {}, research: { prompt: 'keep me' } } },
      'main',
      { primary: 'x/y' },
    )
    expect((res.value as Record<string, unknown>).research).toEqual({ prompt: 'keep me' })
  })

  it('creates the entry when the agent is new', () => {
    const res = applyAgentOverride({ entries: {} }, 'fresh', { primary: 'x/y' })
    expect(res.value).toEqual({ fresh: { model: { primary: 'x/y' } } })
  })

  it('clears the override without dropping the entry', () => {
    const res = applyAgentOverride(
      { entries: { main: { prompt: 'hi', model: { primary: 'x/y' } } } },
      'main',
      undefined,
    )
    expect(res.value).toEqual({ main: { prompt: 'hi' } })
  })

  it('writes into agents.list on the legacy shape, preserving other fields', () => {
    const res = applyAgentOverride(
      { list: [{ id: 'main', prompt: 'hi' }, { id: 'other' }] },
      'main',
      { primary: 'x/y' },
    )
    expect(res.path).toBe('agents.list')
    expect(res.value).toEqual([
      { id: 'main', prompt: 'hi', model: { primary: 'x/y' } },
      { id: 'other' },
    ])
  })

  it('appends to the legacy array when the agent is absent', () => {
    const res = applyAgentOverride({ list: [] }, 'main', { primary: 'x/y' })
    expect(res.value).toEqual([{ id: 'main', model: { primary: 'x/y' } }])
  })

  it('rejects unsafe agent ids', () => {
    expect(() => applyAgentOverride({ entries: {} }, 'bad id!', { primary: 'x/y' })).toThrow()
  })
})
