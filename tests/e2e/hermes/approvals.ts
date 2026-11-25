import { expect } from '@playwright/test'
import { hermesApi, onHermes } from './target'

const configChange = `
import json, os, pathlib, subprocess, sys, tempfile, yaml
config = pathlib.Path.home() / '.hermes/config.yaml'

def write_config(contents):
    with tempfile.NamedTemporaryFile(dir=config.parent, delete=False) as tmp:
        tmp.write(contents)
        os.fchmod(tmp.fileno(), config.stat().st_mode & 0o777)
    os.replace(tmp.name, config)

if sys.argv[1] == 'manual':
    original = config.read_bytes()
    parsed = yaml.safe_load(original)
    parsed.setdefault('approvals', {})['mode'] = 'manual'
    with tempfile.NamedTemporaryFile(prefix='mcc-e2e-approvals-config-', dir='/tmp', delete=False) as snapshot:
        snapshot.write(original)
    write_config(yaml.safe_dump(parsed, allow_unicode=True).encode())
    try:
        subprocess.run(['systemctl', '--user', 'restart', 'hermes-gateway'], check=True)
    except BaseException:
        write_config(original)
        subprocess.run(['systemctl', '--user', 'restart', 'hermes-gateway'], check=True)
        os.unlink(snapshot.name)
        raise
    print(json.dumps(snapshot.name))
else:
    snapshot = pathlib.Path(sys.argv[2])
    original = snapshot.read_bytes()
    write_config(original)
    subprocess.run(['systemctl', '--user', 'restart', 'hermes-gateway'], check=True)
    assert config.read_bytes() == original
    snapshot.unlink()
    print(json.dumps(True))
`

export function manualApprovals() {
  return onHermes<string>(configChange, ['manual'], 85_000)
}

export async function waitForHermesApi() {
  await expect.poll(async () => {
    try {
      return (await hermesApi('GET', '/health/detailed')).status
    } catch {
      return 0
    }
  }, { timeout: 30_000 }).toBe(200)
}

export async function restoreApprovals(snapshot: string) {
  await onHermes<boolean>(configChange, ['restore', snapshot], 85_000)
  await waitForHermesApi()
}

export function approvalFixture() {
  return onHermes<string>(`
import json, os, tempfile
fd, path = tempfile.mkstemp(dir='/tmp', prefix='mcc-e2e-approval-')
os.close(fd)
print(json.dumps(path))
`)
}

export function approvalSize(path: string) {
  return onHermes<number>(`
import os, sys
print(os.stat(sys.argv[1]).st_size)
`, [path])
}

export function removeApprovalFixture(path: string) {
  return onHermes<null>(`
import os, sys
os.unlink(sys.argv[1])
print('null')
`, [path])
}

export function approvalCommand(path: string) {
  return `dd if=/dev/zero of=${path} bs=1 count=1 status=none`
}

export function approvalPrompt(path: string) {
  return `This is a terminal permission check. Run exactly this terminal command to write one zero byte to the empty test file: ${approvalCommand(path)}. Use the terminal, with no other shell commands. Wait for the result and then report it. If the operator denies it, do not retry.`
}
