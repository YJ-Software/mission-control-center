import { readFileSync, writeFileSync } from 'node:fs'

const OPEN = '# >>> e2e dynamic'
const CLOSE = '# <<<'

export function rewriteDynamicBlock(content, updates) {
  const lines = content.split('\n')
  const openIdx = lines.findIndex(l => l.trim() === OPEN)
  const closeIdx = lines.findIndex((l, i) => i > openIdx && l.trim() === CLOSE)

  const blockLines = []
  for (const [k, v] of Object.entries(updates)) blockLines.push(`${k}=${v}`)

  if (openIdx === -1 || closeIdx === -1) {
    const trailing = content.endsWith('\n') ? '' : '\n'
    return content + trailing + OPEN + '\n' + blockLines.join('\n') + '\n' + CLOSE + '\n'
  }

  const existingKeys = new Set(Object.keys(updates))
  const preserved = lines
    .slice(openIdx + 1, closeIdx)
    .filter(line => {
      const eq = line.indexOf('=')
      if (eq < 1) return true
      return !existingKeys.has(line.slice(0, eq).trim())
    })

  const newBlock = [OPEN, ...preserved, ...blockLines, CLOSE]
  return [...lines.slice(0, openIdx), ...newBlock, ...lines.slice(closeIdx + 1)].join('\n')
}

export function updateEnvFile(path, updates) {
  const before = readFileSync(path, 'utf8')
  const after = rewriteDynamicBlock(before, updates)
  writeFileSync(path, after)
}
