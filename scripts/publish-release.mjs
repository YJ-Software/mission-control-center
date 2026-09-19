#!/usr/bin/env node
/**
 * Publish the latest `dist/` tarball to GitHub Releases and update the
 * in-repo manifest at `release-manifest.json`.
 *
 * Workflow:
 *   1. `npm run build:release`   → dist/mission-control-vX.Y.Z-linux-x64.tar.gz
 *   2. `npm run publish:release` →
 *        a. compute sha256 / size for the new tarball
 *        b. update release-manifest.json (latest + history rotation)
 *        c. `gh release create|upload vX.Y.Z dist/...tar.gz`
 *        d. git commit + push the manifest
 *
 * The manifest format matches what the dashboard's /api/upgrade/check
 * consumes (see src/lib/upgrade/manager.ts).
 *
 * Env:
 *   MCC_REPO     GitHub `owner/repo` (default: parsed from `git remote get-url origin`)
 *   MCC_NOTES    optional release notes (otherwise tries dist/NOTES.md)
 *   MCC_NO_GH    skip `gh release` step (manifest-only, useful for dry runs)
 *   MCC_NO_PUSH  skip `git commit && git push` step
 *   MCC_VALIDATED_OPENCLAW  comma list of OpenClaw versions the E2E run used
 *   MCC_VALIDATED_HERMES    comma list of Hermes versions the E2E run used
 *                           (both sticky from the previous release when unset)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { releaseTag, resolveValidated, buildManifest } from './lib/release-meta.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')
const MANIFEST_PATH = join(ROOT, 'release-manifest.json')

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function sha256File(path) {
  const buf = readFileSync(path)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function detectRepo() {
  if (process.env.MCC_REPO) return process.env.MCC_REPO
  const url = git('remote', 'get-url', 'origin')
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  if (!match) die(`could not parse GitHub repo from origin: ${url}`)
  return match[1]
}

if (!existsSync(DIST)) die(`dist/ not found — run \`npm run build:release\` first`)

// Find latest tarball in dist/ by mtime.
const tarballs = readdirSync(DIST)
  .filter((f) => /^mission-control-v.*\.tar\.gz$/.test(f))
  .map((f) => ({ name: f, path: join(DIST, f), mtime: statSync(join(DIST, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)

if (tarballs.length === 0) die(`no tarball in ${DIST} — run \`npm run build:release\` first`)

const tarball = tarballs[0]
const versionMatch = tarball.name.match(/^mission-control-v(\d+\.\d+\.\d+)-([^.]+)\.tar\.gz$/)
if (!versionMatch) die(`cannot parse version/tag from ${tarball.name}`)
const [, mccVersion, tag] = versionMatch
const [platform, arch] = tag.split('-')

const REPO = detectRepo()
const TAG = releaseTag(mccVersion)
const TARBALL_URL = `https://github.com/${REPO}/releases/download/${TAG}/${tarball.name}`
const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO}/main/release-manifest.json`

console.log(`• publishing ${TAG} (${tag}) to GitHub repo ${REPO}`)

const size = statSync(tarball.path).size
const sha = sha256File(tarball.path)
console.log(`  ${tarball.name} (${(size / 1024 / 1024).toFixed(1)} MB, sha256=${sha.slice(0, 12)}…)`)

// Gather release notes.
let notes = (process.env.MCC_NOTES || '').trim()
if (!notes) {
  const notesPath = join(DIST, 'NOTES.md')
  if (existsSync(notesPath)) notes = readFileSync(notesPath, 'utf8').trim()
}

// Build manifest — preserves previous artifacts for other arches when upgrading
// partially, and rotates history.
let prevManifest = null
if (existsSync(MANIFEST_PATH)) {
  try { prevManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) } catch {}
}

const newArtifact = {
  platform,
  arch,
  url: TARBALL_URL,
  sha256: sha,
  size,
}

const validated = resolveValidated(process.env, prevManifest?.latest ?? null)
console.log(`  validated: ${validated ? JSON.stringify(validated) : '(none — set MCC_VALIDATED_OPENCLAW / MCC_VALIDATED_HERMES after E2E)'}`)

const manifest = buildManifest({
  mccVersion,
  validated,
  notes,
  artifact: newArtifact,
  prevManifest,
  now: new Date().toISOString(),
})

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
console.log(`  wrote ${basename(MANIFEST_PATH)}`)

// --- GitHub Release ---
if (process.env.MCC_NO_GH === '1') {
  console.log(`  (MCC_NO_GH=1) skipping gh release upload`)
} else {
  // From P1 on, the release tag `v<mcc>` shares its name with the `npm
  // version` git tag. If the operator forgot to push that tag, `gh release
  // create` would happily create a tag of the same name on the remote's
  // current HEAD instead — a different commit than the one actually built
  // and tested. Verify origin already has this exact tag on this exact
  // commit before creating/uploading the release.
  let remoteLsTags
  try {
    remoteLsTags = git('ls-remote', '--tags', 'origin', TAG)
  } catch (err) {
    die(`could not query origin for tag ${TAG}: ${err.message}`)
  }
  const tagRefs = remoteLsTags
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split('\t')
      return { sha, ref }
    })
    .filter(({ ref }) => ref === `refs/tags/${TAG}` || ref === `refs/tags/${TAG}^{}`)

  if (tagRefs.length === 0) {
    die(`tag ${TAG} not found on origin — push it first: \`git push origin ${TAG}\` (or \`git push --follow-tags\`)`)
  }
  // Annotated tags list both the tag object and a peeled `^{}` line pointing
  // at the commit; prefer the peeled commit when present.
  const peeled = tagRefs.find(({ ref }) => ref.endsWith('^{}'))
  const remoteCommit = (peeled ?? tagRefs[0]).sha

  let localCommit
  try {
    localCommit = git('rev-parse', `${TAG}^{commit}`)
  } catch (err) {
    die(`local tag ${TAG} not found — run \`npm version\` first, or check out the commit it was tagged on: ${err.message}`)
  }

  if (remoteCommit !== localCommit) {
    die(
      `tag ${TAG} on origin points to a different commit than local ` +
        `(origin=${remoteCommit.slice(0, 12)}, local=${localCommit.slice(0, 12)}) — ` +
        `push the local tag first: \`git push origin ${TAG}\` (or \`git push --follow-tags\`)`,
    )
  }

  let releaseExists = false
  try {
    execFileSync('gh', ['release', 'view', TAG], { cwd: ROOT, stdio: 'ignore' })
    releaseExists = true
  } catch {
    releaseExists = false
  }

  if (releaseExists) {
    console.log(`  uploading ${tarball.name} to existing release ${TAG}`)
    execFileSync('gh', ['release', 'upload', TAG, tarball.path, '--clobber'], {
      cwd: ROOT,
      stdio: 'inherit',
    })
  } else {
    console.log(`  creating release ${TAG}`)
    const args = ['release', 'create', TAG, tarball.path, '--title', TAG]
    if (notes) args.push('--notes', notes)
    else args.push('--generate-notes')
    execFileSync('gh', args, { cwd: ROOT, stdio: 'inherit' })
  }
}

// --- Commit + push manifest ---
if (process.env.MCC_NO_PUSH === '1') {
  console.log(`  (MCC_NO_PUSH=1) skipping git commit + push`)
} else {
  const status = git('status', '--porcelain', '--', 'release-manifest.json')
  if (status) {
    git('add', 'release-manifest.json')
    git('commit', '-m', `chore(release): publish ${TAG}`)
    git('push', 'origin', 'HEAD')
    console.log(`  pushed release-manifest.json to origin/HEAD`)
  } else {
    console.log(`  release-manifest.json unchanged — skipping commit`)
  }
}

console.log(`\n✓ published ${TAG}`)
console.log(`  release:  https://github.com/${REPO}/releases/tag/${TAG}`)
console.log(`  tarball:  ${TARBALL_URL}`)
console.log(`  manifest: ${MANIFEST_URL}`)

// Sanity check: poll the manifest URL once.
try {
  const status = execFileSync('curl', ['-sL', '-o', '/dev/null', '-w', '%{http_code}', MANIFEST_URL], {
    encoding: 'utf8',
    timeout: 10000,
  }).trim()
  console.log(`  live check: HTTP ${status}`)
} catch {
  console.log(`  live check: skipped (curl unavailable)`)
}
