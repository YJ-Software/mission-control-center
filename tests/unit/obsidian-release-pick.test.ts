import { describe, expect, it } from 'vitest'
import { pickObsidianDesktopDeb } from '@/lib/second-brain/obsidian/installer'

// Obsidian publishes mobile builds into the same GitHub repo as desktop ones,
// so `/releases/latest` can point at an APK-only release. On 2026-08-31 it did:
//
//   v1.13.8  assets: Obsidian-1.13.8.apk          ← latest, no desktop asset
//   v1.13.7  assets: ... obsidian_1.13.7_amd64.deb
//
// The installer derived the version from /releases/latest and then built
// `obsidian_<version>_amd64.deb` by hand, so it requested a 1.13.8 .deb that
// does not exist → HTTP 404 → `wget` exit 8 → install failed, and the E2E spec
// sat on the "安裝完成！" locator until its 18-minute timeout. Reproduced twice
// on the throwaway VPS; unrelated to the OpenClaw version.
//
// The fix picks the newest release that actually ships an amd64 .deb and uses
// that asset's own URL rather than reconstructing a filename.

const apkOnly = {
  tag_name: 'v1.13.8',
  assets: [{ name: 'Obsidian-1.13.8.apk', browser_download_url: 'https://x/apk' }],
}
const desktop = {
  tag_name: 'v1.13.7',
  assets: [
    { name: 'Obsidian-1.13.7-arm64.AppImage', browser_download_url: 'https://x/appimage' },
    { name: 'Obsidian-1.13.7.apk', browser_download_url: 'https://x/apk7' },
    {
      name: 'obsidian_1.13.7_amd64.deb',
      browser_download_url:
        'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.7/obsidian_1.13.7_amd64.deb',
    },
  ],
}

describe('pickObsidianDesktopDeb', () => {
  it('skips an APK-only latest release and takes the newest desktop one', () => {
    const got = pickObsidianDesktopDeb([apkOnly, desktop])
    expect(got).toEqual({
      version: '1.13.7',
      url: 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.7/obsidian_1.13.7_amd64.deb',
    })
  })

  it('uses the asset URL as published rather than rebuilding the filename', () => {
    const renamed = {
      tag_name: 'v2.0.0',
      assets: [
        { name: 'obsidian_2.0.0-1_amd64.deb', browser_download_url: 'https://x/renamed.deb' },
      ],
    }
    expect(pickObsidianDesktopDeb([renamed])?.url).toBe('https://x/renamed.deb')
  })

  it('ignores arm64 debs on this amd64-only install path', () => {
    const armOnly = {
      tag_name: 'v1.9.9',
      assets: [{ name: 'obsidian_1.9.9_arm64.deb', browser_download_url: 'https://x/arm.deb' }],
    }
    expect(pickObsidianDesktopDeb([armOnly])).toBeNull()
  })

  it('skips prereleases', () => {
    const pre = { tag_name: 'v1.14.0', prerelease: true, assets: desktop.assets }
    expect(pickObsidianDesktopDeb([pre, desktop])?.version).toBe('1.13.7')
  })

  it('returns null instead of throwing on junk', () => {
    expect(pickObsidianDesktopDeb(undefined)).toBeNull()
    expect(pickObsidianDesktopDeb([])).toBeNull()
    expect(pickObsidianDesktopDeb([{ tag_name: 'v1', assets: 'nope' }])).toBeNull()
    expect(pickObsidianDesktopDeb([apkOnly])).toBeNull()
  })
})
