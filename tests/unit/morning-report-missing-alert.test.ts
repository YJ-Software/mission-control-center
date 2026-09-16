import { describe, expect, it } from 'vitest'
import { buildMissingTopicMessageArgs } from '@/lib/morning-report/finalize'

// The missing-topic alert used `openclaw announce`, a command OpenClaw does not
// have. Every delivery failed with "OpenClaw does not know the command" while
// the dashboard bell kept recording the alerts, so four days of a missing
// morning-report section went unnoticed. Delivery now uses `message send` with
// the report's own configured channel and chat id.

describe('buildMissingTopicMessageArgs', () => {
  it('builds an openclaw message send invocation', () => {
    expect(buildMissingTopicMessageArgs('telegram', '1005601933', '⚠️ 晨報有 1 個主題未產出')).toEqual([
      'message', 'send', '--channel', 'telegram', '--target', '1005601933', '--message', '⚠️ 晨報有 1 個主題未產出',
    ])
  })

  it('does not use the removed announce command', () => {
    expect(buildMissingTopicMessageArgs('telegram', '1', 'x')).not.toContain('announce')
  })

  it('returns null when no delivery target is configured', () => {
    expect(buildMissingTopicMessageArgs(undefined, '1', 'x')).toBeNull()
    expect(buildMissingTopicMessageArgs('telegram', undefined, 'x')).toBeNull()
    expect(buildMissingTopicMessageArgs('  ', ' ', 'x')).toBeNull()
  })

  it('trims stray whitespace from config values', () => {
    expect(buildMissingTopicMessageArgs(' telegram ', ' 1005601933 ', 'x')?.slice(0, 6)).toEqual([
      'message', 'send', '--channel', 'telegram', '--target', '1005601933',
    ])
  })
})
