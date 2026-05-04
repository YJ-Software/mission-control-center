import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'child_process'
import { resolveOpencliExtensionAssetUrl } from '@/lib/browser/installer'

const mockExec = execFileSync as unknown as ReturnType<typeof vi.fn>

describe('resolveOpencliExtensionAssetUrl', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  it('returns the versioned asset url from the latest release', () => {
    // Upstream renamed opencli-extension.zip → opencli-extension-v1.0.0.zip,
    // which broke the old hardcoded URL. Verify the resolver picks the
    // versioned asset via the releases API.
    mockExec.mockReturnValueOnce(JSON.stringify({
      tag_name: 'v1.7.3',
      assets: [
        { name: 'other-artifact.tar.gz', browser_download_url: 'https://example.com/other.tar.gz' },
        { name: 'opencli-extension-v1.0.0.zip', browser_download_url: 'https://example.com/opencli-extension-v1.0.0.zip' },
      ],
    }))

    expect(resolveOpencliExtensionAssetUrl()).toBe(
      'https://example.com/opencli-extension-v1.0.0.zip',
    )
  })

  it('still finds the unversioned asset name for backward compatibility', () => {
    mockExec.mockReturnValueOnce(JSON.stringify({
      assets: [
        { name: 'opencli-extension.zip', browser_download_url: 'https://example.com/legacy.zip' },
      ],
    }))
    expect(resolveOpencliExtensionAssetUrl()).toBe('https://example.com/legacy.zip')
  })

  it('throws when no matching asset is present', () => {
    mockExec.mockReturnValueOnce(JSON.stringify({
      assets: [
        { name: 'README.md', browser_download_url: 'https://example.com/README.md' },
      ],
    }))
    expect(() => resolveOpencliExtensionAssetUrl()).toThrow(/No opencli-extension/)
  })
})
