import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'

// The original code block we want to replace (nlm's cdp.py)
const PATCH_SEARCH = `    # Check if Chrome is running with debugging
    # First, try to find an existing instance on any port in our range
    reused_existing = False
    existing_port, debugger_url = None, None
    if not clear_profile:
        existing_port, debugger_url = find_existing_nlm_chrome(profile_name=profile_name)

    if existing_port:
        port = existing_port
        reused_existing = True

    if not debugger_url and auto_launch:`

const PATCH_REPLACE = `    # Check if Chrome is running with debugging
    # First, try the requested port directly (e.g. externally managed Chrome on 9222)
    reused_existing = False
    debugger_url = get_debugger_url(port)
    if debugger_url:
        reused_existing = True

    # If not found, try to find an existing NLM-launched instance via port map
    if not debugger_url and not clear_profile:
        existing_port, debugger_url = find_existing_nlm_chrome(profile_name=profile_name)
        if existing_port:
            port = existing_port
            reused_existing = True

    if not debugger_url and auto_launch:`

/** Locate nlm's cdp.py inside the uv tool install dir. */
export function findCdpPyPath(): string | null {
  // Method 1: Resolve nlm binary symlink to find uv tool install dir
  try {
    const nlmPath = execFileSync('which', ['nlm'], { encoding: 'utf-8', timeout: 5000 }).trim()
    if (nlmPath) {
      const realPath = realpathSync(nlmPath)
      // realPath: .../uv/tools/notebooklm-mcp-cli/bin/nlm
      const toolDir = join(realPath, '..', '..')  // .../notebooklm-mcp-cli/
      const libDir = join(toolDir, 'lib')
      if (existsSync(libDir)) {
        const pythonDirs = readdirSync(libDir).filter((d: string) => d.startsWith('python'))
        for (const pyDir of pythonDirs) {
          const candidate = join(libDir, pyDir, 'site-packages', 'notebooklm_tools', 'utils', 'cdp.py')
          if (existsSync(candidate)) return candidate
          // Also check older package name
          const candidate2 = join(libDir, pyDir, 'site-packages', 'nlm', 'utils', 'cdp.py')
          if (existsSync(candidate2)) return candidate2
        }
      }
    }
  } catch { /* continue to fallback */ }

  // Method 2: Check common uv tool paths directly
  const home = homedir()
  const baseDirs = [
    join(home, '.local/share/uv/tools/notebooklm-mcp-cli'),
    join(home, '.local/share/uv/tools/notebooklm-cli'),
  ]

  for (const base of baseDirs) {
    if (!existsSync(base)) continue
    const libDir = join(base, 'lib')
    if (!existsSync(libDir)) continue
    try {
      const pythonDirs = readdirSync(libDir).filter((d: string) => d.startsWith('python'))
      for (const pyDir of pythonDirs) {
        const candidate = join(libDir, pyDir, 'site-packages', 'notebooklm_tools', 'utils', 'cdp.py')
        if (existsSync(candidate)) return candidate
      }
    } catch { /* continue */ }
  }
  return null
}

export function isCdpPatched(cdpPath: string): boolean {
  try {
    return readFileSync(cdpPath, 'utf-8').includes('try the requested port directly')
  } catch {
    return false
  }
}

/** Upstream nlm now natively scans CDP_PORT_RANGE via
 *  find_any_existing_cdp_browser(), so our patch is not needed at all. */
export function isCdpPatchNotNeeded(cdpPath: string): boolean {
  try {
    return readFileSync(cdpPath, 'utf-8').includes('find_any_existing_cdp_browser')
  } catch {
    return false
  }
}

export function applyCdpPatch(cdpPath: string): { ok: boolean; message: string } {
  try {
    let content = readFileSync(cdpPath, 'utf-8')

    if (content.includes('try the requested port directly')) {
      return { ok: true, message: 'Already patched' }
    }

    // Upstream notebooklm-mcp-cli added find_any_existing_cdp_browser() which scans
    // CDP_PORT_RANGE (9222..9232) and picks up externally-managed Chrome natively.
    // If that function is present, the patch is no longer needed.
    if (content.includes('find_any_existing_cdp_browser')) {
      return { ok: true, message: 'Upstream supports external CDP natively; no patch needed' }
    }

    if (!content.includes(PATCH_SEARCH)) {
      return { ok: false, message: 'Cannot find patch target in cdp.py — version may be incompatible' }
    }

    content = content.replace(PATCH_SEARCH, PATCH_REPLACE)
    writeFileSync(cdpPath, content, 'utf-8')
    return { ok: true, message: 'Patch applied successfully' }
  } catch (err) {
    return { ok: false, message: `Patch failed: ${err}` }
  }
}
