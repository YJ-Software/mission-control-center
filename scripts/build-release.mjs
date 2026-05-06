#!/usr/bin/env node
/**
 * Release build pipeline.
 *
 * Produces a self-contained `.next/standalone/` tree (no `npm install` needed
 * on the customer box) and packages it as `dist/mission-control-v<ver>-<arch>.tar.gz`.
 *
 * Steps:
 *   1. Run `next build` with BUILD_STANDALONE=1 so Next.js emits
 *      `.next/standalone/` with its traced `node_modules/` subset.
 *   2. esbuild-bundle our custom `server.ts` into `.next/standalone/server.js`,
 *      overwriting the Next.js default server entry. `--packages=external`
 *      keeps bare imports unbundled so they resolve from the traced modules.
 *   3. Copy static + public + messages into the standalone tree.
 *   4. Tarball the result.
 *
 * Run via `npm run build:release`.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { tmpdir } from 'node:os'

// NODE_MODULE_VERSION (ABI) targets bundled into every release tarball so the
// same artifact runs on multiple Node majors without per-host recompile.
// Each entry maps a Node major to its NMV; better-sqlite3's prebuilt asset
// naming is `node-v<NMV>-linux-x64`. Update when bumping/dropping support.
const NATIVE_NMV_TARGETS = [
  { node: 22, nmv: 127 },
  { node: 23, nmv: 131 },
  { node: 24, nmv: 137 },
  { node: 25, nmv: 141 },
]

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const STANDALONE = join(ROOT, '.next', 'standalone')
const NEXT_STATIC = join(ROOT, '.next', 'static')
const DIST = join(ROOT, 'dist')

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts })
}

function readPkgVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  return pkg.version || '0.0.0'
}

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

function archTag() {
  const arch = process.arch === 'x64' ? 'x64' : process.arch
  const platform = process.platform === 'linux' ? 'linux' : process.platform
  return `${platform}-${arch}`
}

async function main() {
  const version = readPkgVersion()
  const commit = gitShortSha()
  const buildTime = new Date().toISOString()
  const tag = archTag()
  const tarballName = `mission-control-v${version}-${tag}.tar.gz`

  console.log(`Mission Control release build`)
  console.log(`  version:   ${version}`)
  console.log(`  commit:    ${commit || '(no git)'}`)
  console.log(`  buildTime: ${buildTime}`)
  console.log(`  target:    ${tag}`)

  // Clean previous build
  rmSync(join(ROOT, '.next'), { recursive: true, force: true })

  // 1. Next.js build with standalone output
  run('npx', ['next', 'build'], {
    env: {
      ...process.env,
      BUILD_STANDALONE: '1',
      NEXT_PUBLIC_GIT_COMMIT: commit,
      NEXT_PUBLIC_BUILD_TIME: buildTime,
    },
  })

  if (!existsSync(STANDALONE)) {
    throw new Error(
      `.next/standalone not found — check next.config output: 'standalone' gate`,
    )
  }

  // 2. Compile custom server.ts → .next/standalone/server.js
  //    Bundles pure-JS deps into the output; only externalizes things that
  //    MUST resolve at runtime (Next.js framework + native modules).
  //    Next.js's auto-traced node_modules covers next + API-route deps,
  //    but does NOT trace custom server deps like `ws` / `drizzle-orm` —
  //    bundling sidesteps that gap.
  const esbuildBin = join(ROOT, 'node_modules', '.bin', 'esbuild')
  run(esbuildBin, [
    join(ROOT, 'server.ts'),
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    '--external:next',
    '--external:next/*',
    '--external:better-sqlite3',
    '--external:node-pty',
    `--outfile=${join(STANDALONE, 'server.js')}`,
  ])

  // Ensure native/runtime-only deps that Next.js's NFT tracing misses are
  // present in standalone's node_modules. These are used only by our custom
  // server.ts (not by API routes) so NFT doesn't see the import graph.
  const mustCopyDeps = ['node-pty']
  for (const dep of mustCopyDeps) {
    const src = join(ROOT, 'node_modules', dep)
    const dst = join(STANDALONE, 'node_modules', dep)
    if (!existsSync(src)) continue
    if (existsSync(dst)) continue
    console.log(`\n$ cp -r node_modules/${dep} standalone/node_modules/`)
    cpSync(src, dst, { recursive: true })
  }

  // Strip node-pty prebuilds for other platforms — they ship 50MB+ of
  // darwin/win32 binaries that a linux-x64 tarball will never touch.
  // The linux binary lives in build/Release/pty.node (built from source
  // during `npm install`), so it's unaffected. node-pty uses N-API so its
  // single binary is ABI-stable across all supported Node majors.
  const nodePtyDst = join(STANDALONE, 'node_modules', 'node-pty')
  if (existsSync(nodePtyDst)) {
    for (const junk of ['prebuilds', 'src', 'deps', 'third_party', 'node-addon-api', 'binding.gyp', 'scripts']) {
      const p = join(nodePtyDst, junk)
      if (existsSync(p)) rmSync(p, { recursive: true, force: true })
    }
  }

  // Bundle better-sqlite3 prebuilts for every supported Node ABI so the same
  // tarball runs whether the customer's Node is 22, 23, 24, or 25. Without
  // this, the binary compiled at build time only matches the build host's
  // Node major and crashes the dashboard on any other major.
  bundleCrossVersionSqliteBindings(STANDALONE)

  // 3. Copy static assets that Next.js doesn't auto-copy in standalone mode
  if (existsSync(NEXT_STATIC)) {
    cpSync(NEXT_STATIC, join(STANDALONE, '.next', 'static'), { recursive: true })
  }
  if (existsSync(join(ROOT, 'public'))) {
    cpSync(join(ROOT, 'public'), join(STANDALONE, 'public'), { recursive: true })
  }
  if (existsSync(join(ROOT, 'messages'))) {
    cpSync(join(ROOT, 'messages'), join(STANDALONE, 'messages'), { recursive: true })
  }

  // Bake version metadata so the running server has it even without .git
  writeFileSync(
    join(STANDALONE, 'version.json'),
    JSON.stringify({ version, commit, buildTime }, null, 2),
  )

  // Ship the deploy/release scripts inside the tarball at ./install/ so the
  // installed tree keeps its own upgrade.sh available for the next upgrade.
  const releaseDeployDir = join(ROOT, 'deploy', 'release')
  if (existsSync(releaseDeployDir)) {
    cpSync(releaseDeployDir, join(STANDALONE, 'install'), { recursive: true })
  }

  // Strip things Next.js's NFT tracing over-copied from the repo root.
  // The standalone tree must NOT ship: user runtime data, source, docs,
  // tests, build configs, etc. Only node_modules + .next + server.js + the
  // runtime assets below are needed.
  const stripEntries = [
    '.env',            // any leaked env files
    '.env.local',      // SECURITY: contains AUTH_PASSWORD, AUTH_SECRET
    '.env.production',
    '.env.development',
    '.env.e2e.local',
    '.git',
    '.gitignore',
    'data',            // runtime sqlite + morning-report output (possibly huge)
    'dist',            // previous release tarballs
    'docs',
    'tests',
    'playwright-report',
    'src',             // compiled into .next/ already
    'deploy',
    'scripts',
    'server.ts',
    'server.tsconfig.json',
    'tsconfig.json',
    'tsconfig.tsbuildinfo',
    'playwright.config.ts',
    'vitest.config.ts',
    'postcss.config.js',
    'tailwind.config.ts',
    'next.config.ts',
    'package-lock.json',
    'CLAUDE.md',
    'README.md',
    'test-get.js',
    'test-put.js',
    'test-put2.js',
  ]
  for (const name of stripEntries) {
    const p = join(STANDALONE, name)
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  }

  // Ship the MCP server sources at ./deploy/mcp/ — the customer-service
  // install wizard (mem0-setup.ts, handoff-config.ts) resolves them relative
  // to process.cwd() and runs `uv sync` against them at install time. Copied
  // AFTER the strip step so the 'deploy' entry above doesn't nuke it.
  const mcpSourceDir = join(ROOT, 'deploy', 'mcp')
  if (existsSync(mcpSourceDir)) {
    cpSync(mcpSourceDir, join(STANDALONE, 'deploy', 'mcp'), { recursive: true })
  }

  // 4. Tarball
  mkdirSync(DIST, { recursive: true })
  const tarballPath = join(DIST, tarballName)
  run('tar', ['czf', tarballPath, '-C', STANDALONE, '.'])

  // Copy install.sh + upgrade.sh + service template alongside the tarball so
  // customers can bootstrap without having to extract first to get the script.
  if (existsSync(releaseDeployDir)) {
    for (const f of ['install.sh', 'upgrade.sh', 'mission-control.service.tmpl']) {
      const src = join(releaseDeployDir, f)
      if (existsSync(src)) cpSync(src, join(DIST, f))
    }
  }

  const sizeMb = (execFileSync('du', ['-sm', tarballPath]).toString().split('\t')[0] || '?').trim()
  console.log(`\n✓ Built ${tarballName} (${sizeMb} MB)`)
  console.log(`  → ${tarballPath}`)
  console.log(`\nInstall on target box:`)
  console.log(`  mkdir -p ~/mission-control && tar xzf ${tarballName} -C ~/mission-control`)
  console.log(`  cd ~/mission-control && HOST=0.0.0.0 PORT=3737 node server.js`)

  // Sanity: warn if native modules are missing for the target platform
  const targetArchNote = `${os.platform()}-${os.arch()}`
  const supportedNodes = NATIVE_NMV_TARGETS.map((t) => t.node).join('/')
  console.log(
    `\nNative modules: ${targetArchNote}; better-sqlite3 bundles ABIs for Node ${supportedNodes}; node-pty is N-API (any Node).`,
  )
}

function bundleCrossVersionSqliteBindings(standaloneDir) {
  const bs3Dir = join(standaloneDir, 'node_modules', 'better-sqlite3')
  if (!existsSync(bs3Dir)) {
    console.log('\n[cross-abi] skip: standalone has no better-sqlite3 (NFT may have inlined it)')
    return
  }
  const bs3Version = JSON.parse(readFileSync(join(bs3Dir, 'package.json'), 'utf8')).version
  const arch = process.arch === 'x64' ? 'x64' : process.arch
  const platform = process.platform === 'linux' ? 'linux' : process.platform

  console.log(`\n[cross-abi] bundling better-sqlite3@${bs3Version} prebuilds for ${NATIVE_NMV_TARGETS.length} ABIs`)

  for (const t of NATIVE_NMV_TARGETS) {
    const assetName = `better-sqlite3-v${bs3Version}-node-v${t.nmv}-${platform}-${arch}.tar.gz`
    const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bs3Version}/${assetName}`
    const tmpTar = join(tmpdir(), `${process.pid}-${assetName}`)
    const tmpExtract = join(tmpdir(), `${process.pid}-extract-${t.nmv}`)
    rmSync(tmpExtract, { recursive: true, force: true })
    mkdirSync(tmpExtract, { recursive: true })

    try {
      execFileSync('curl', ['-fsSL', '-o', tmpTar, url], { stdio: 'inherit' })
      execFileSync('tar', ['xzf', tmpTar, '-C', tmpExtract], { stdio: 'inherit' })
    } catch (err) {
      throw new Error(
        `[cross-abi] failed to fetch ${assetName} from upstream — verify the prebuild exists at ${url} (better-sqlite3@${bs3Version} may not publish a binary for Node ${t.node})`,
      )
    }

    const srcNode = join(tmpExtract, 'build', 'Release', 'better_sqlite3.node')
    if (!existsSync(srcNode)) {
      throw new Error(`[cross-abi] tarball ${assetName} did not contain build/Release/better_sqlite3.node`)
    }
    const destDir = join(bs3Dir, 'lib', 'binding', `node-v${t.nmv}-${platform}-${arch}`)
    mkdirSync(destDir, { recursive: true })
    cpSync(srcNode, join(destDir, 'better_sqlite3.node'))

    rmSync(tmpTar, { force: true })
    rmSync(tmpExtract, { recursive: true, force: true })
    console.log(`  ✓ Node ${t.node} (NMV ${t.nmv}) → lib/binding/node-v${t.nmv}-${platform}-${arch}/`)
  }

  // The single-Node binary at build/Release/better_sqlite3.node was produced
  // by the build host's `npm install`. The `bindings` package tries that path
  // BEFORE lib/binding/node-v<NMV>-..., so leaving it in place would override
  // the per-ABI binaries on the build host's Node major. Remove it so every
  // runtime falls through to its matching lib/binding entry.
  const buildReleaseNode = join(bs3Dir, 'build', 'Release', 'better_sqlite3.node')
  if (existsSync(buildReleaseNode)) {
    rmSync(buildReleaseNode, { force: true })
    console.log(`  ✓ removed build/Release/better_sqlite3.node so 'bindings' resolves per-ABI`)
  }
}

main().catch((err) => {
  console.error('\n✗ Release build failed:', err.message || err)
  process.exit(1)
})
