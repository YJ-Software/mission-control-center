export function rewriteDynamicBlock(
  content: string,
  updates: Record<string, string | number>,
): string

export function updateEnvFile(
  path: string,
  updates: Record<string, string | number>,
): void
