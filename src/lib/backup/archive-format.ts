export type BackupKind = 'mcc' | 'legacy-openclaw' | 'extra' | 'unknown'

export function classifyBackupFile(filename: string): BackupKind {
  if (!filename.endsWith('.tar.gz')) return 'unknown'

  if (filename.startsWith('mcc-backup_')) return 'mcc'
  if (filename.startsWith('openclaw-backup_')) return 'legacy-openclaw'
  if (filename.startsWith('extra-backup_')) return 'extra'

  return 'unknown'
}

export function buildArchiveName(opts: {
  backend: 'openclaw' | 'hermes'
  host: string
  at: Date
}): string {
  // Sanitize host: keep [A-Za-z0-9.-], replace others with -
  const sanitizedHost = opts.host.replace(/[^A-Za-z0-9.-]/g, '-')

  // Format timestamp in local time (YYYYMMDD_HHMMSS)
  const year = opts.at.getFullYear()
  const month = String(opts.at.getMonth() + 1).padStart(2, '0')
  const date = String(opts.at.getDate()).padStart(2, '0')
  const hours = String(opts.at.getHours()).padStart(2, '0')
  const minutes = String(opts.at.getMinutes()).padStart(2, '0')
  const seconds = String(opts.at.getSeconds()).padStart(2, '0')

  const timestamp = `${year}${month}${date}_${hours}${minutes}${seconds}`

  return `mcc-backup_${opts.backend}_${sanitizedHost}_${timestamp}.tar.gz`
}

export interface BackupManifest {
  format: 1
  backend: 'openclaw' | 'hermes'
  backendVersion: string | null
  mccVersion: string
  createdAt: string
  hostname: string
  parts: {
    /** null：此備份不含 backend（未勾選 OpenClaw） */
    backend: string | null
    mccDb: string
    mccEnv: string | null
  }
}

function isInvalidPath(path: string): boolean {
  return path.startsWith('/') || path.includes('..')
}

export function parseManifest(json: unknown): BackupManifest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('manifest must be an object')
  }

  const obj = json as Record<string, unknown>

  // Validate format
  if (obj.format !== 1) {
    throw new Error('format must be 1')
  }

  // Validate backend
  if (obj.backend !== 'openclaw' && obj.backend !== 'hermes') {
    throw new Error('backend must be openclaw or hermes')
  }

  // Validate backendVersion (can be null or string)
  if (obj.backendVersion !== null && typeof obj.backendVersion !== 'string') {
    throw new Error('backendVersion must be null or string')
  }

  // Validate mccVersion
  if (typeof obj.mccVersion !== 'string') {
    throw new Error('mccVersion must be string')
  }

  // Validate createdAt
  if (typeof obj.createdAt !== 'string') {
    throw new Error('createdAt must be string')
  }

  // Validate hostname
  if (typeof obj.hostname !== 'string') {
    throw new Error('hostname must be string')
  }

  // Validate parts
  const parts = obj.parts as Record<string, unknown>
  if (!parts || typeof parts !== 'object') {
    throw new Error('parts must be an object')
  }

  // Validate parts.backend (null = 不含 backend)
  if (parts.backend !== null) {
    if (typeof parts.backend !== 'string' || parts.backend === '') {
      throw new Error('parts.backend must be null or a non-empty string')
    }
    if (isInvalidPath(parts.backend as string)) {
      throw new Error('parts.backend must not contain absolute paths or ..')
    }
  }

  // Validate parts.mccDb
  if (typeof parts.mccDb !== 'string') {
    throw new Error('parts.mccDb must be string')
  }

  // Check for absolute paths and .. in parts.mccDb
  if (isInvalidPath(parts.mccDb as string)) {
    throw new Error('parts.mccDb must not contain absolute paths or ..')
  }

  // Validate parts.mccEnv (can be null or string)
  if (parts.mccEnv !== null && typeof parts.mccEnv !== 'string') {
    throw new Error('parts.mccEnv must be null or string')
  }

  // Check for absolute paths and .. in parts.mccEnv
  if (parts.mccEnv && isInvalidPath(parts.mccEnv as string)) {
    throw new Error('parts.mccEnv must not contain absolute paths or ..')
  }

  return {
    format: 1,
    backend: obj.backend as 'openclaw' | 'hermes',
    backendVersion: obj.backendVersion as string | null,
    mccVersion: obj.mccVersion as string,
    createdAt: obj.createdAt as string,
    hostname: obj.hostname as string,
    parts: {
      backend: parts.backend as string | null,
      mccDb: parts.mccDb as string,
      mccEnv: parts.mccEnv as string | null,
    },
  }
}
