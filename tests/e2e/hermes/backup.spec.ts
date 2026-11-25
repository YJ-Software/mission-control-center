import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { test, expect } from '../fixtures/login'
import { sendChatTurnOnCurrentPage } from '../utils/chat-turn'
import { expectJobSuccess, hermesApi, native, onHermes, requireHermes, unitPid } from './target'

test.beforeEach(async ({ request, baseURL }) => requireHermes(request, baseURL))

test('creates a native archive and restores Hermes and MCC state', async ({ loggedInPage: page }) => {
  const api = page.request
  const key = randomUUID()
  const sessionPath = `/api/sessions/mcc-e2e-backup-${key}`
  const sessionId = sessionPath.split('/').at(-1)!
  const marker = `restore marker ${key}`
  const sourceName = `MCC E2E source ${key}`
  const history = () => native<{ data: { role: string; content: string }[] }>(
    'GET', `${sessionPath}/messages?order=latest&limit=10`,
  )
  const sources = async () => (await api.get('/api/backup/sources')).json() as Promise<{ id: string; name: string }[]>
  let backupFile: string | undefined
  let jobPath: string | undefined
  let sourceId: string | undefined
  let restoreStarted = false

  try {
    const seed = await native<{ run_id: string }>('POST', '/v1/runs', 202, {
      input: `Reply with the following text and nothing else: ${marker}`, session_id: sessionId,
    })
    const events = await native<{ event: string; output?: string }[]>('GET', `/v1/runs/${seed.run_id}/events`)
    expect(events.find(event => event.event === 'run.completed')?.output).toContain(marker)
    await native('PATCH', sessionPath, 200, { title: marker })
    const before = (await history()).data.map(({ role, content }) => ({ role, content }))
    expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: expect.stringContaining(marker) })]))

    const { job } = await native<{ job: { id: string } }>('POST', '/api/jobs', 200, {
      name: marker, prompt: 'Paused MCC restore test fixture', schedule: '0 0 1 1 *', paused: true,
    })
    jobPath = `/api/jobs/${job.id}`

    const dash = await api.get('/api/backup?type=dashboard')
    expect(dash.status()).toBe(200)
    const { backupToken, backupAvailable } = await dash.json()
    expect(backupAvailable).toBe(true)
    const backup = await api.post('/api/backup/run', {
      data: { triggeredBy: 'api' }, headers: { 'X-Backup-Token': backupToken },
    })
    expect(backup.status()).toBe(200)
    const { logId, jobId } = await backup.json()
    await expectJobSuccess(api, jobId)
    const backupLog = await api.get(`/api/backup/logs?logId=${logId}`)
    expect(backupLog.status()).toBe(200)
    const { filePath, status } = await backupLog.json()
    expect(status).toBe('completed')
    expect(filePath).toBeTruthy()
    backupFile = filePath as string
    expect(basename(backupFile)).toMatch(/^mcc-backup_hermes_.*\.tar\.gz$/)
    const archive = await onHermes<{ mode: number; bytes: number; backend: string; backendVersion: string }>(`
import json, pathlib, stat, sys, tarfile
path = pathlib.Path(sys.argv[1])
with tarfile.open(path) as archive:
    manifest = json.load(archive.extractfile('./manifest.json'))
    assert archive.getmember('./hermes.zip').size > 0
    assert archive.getmember('./mcc.sqlite').size > 0
    assert manifest['parts']['backend'] == 'hermes.zip' and manifest['parts']['mccDb'] == 'mcc.sqlite'
print(json.dumps(dict(mode=stat.S_IMODE(path.stat().st_mode), bytes=path.stat().st_size,
  backend=manifest['backend'], backendVersion=manifest['backendVersion'])))
`, [backupFile])
    expect(archive).toMatchObject({ mode: 0o600, backend: 'hermes', backendVersion: expect.any(String) })

    const changed = 'Changed after backup'
    await native('PATCH', sessionPath, 200, { title: changed })
    await native('PATCH', jobPath, 200, { name: changed })
    expect((await native<{ session: { title: string } }>('GET', sessionPath)).session.title).toBe(changed)
    expect((await native<{ job: { name: string } }>('GET', jobPath)).job.name).toBe(changed)
    const mccMarker = await api.post('/api/backup/sources', { data: { name: sourceName, path: '/tmp' } })
    expect(mccMarker.status()).toBe(200)
    sourceId = (await mccMarker.json()).id
    expect((await sources()).some(source => source.id === sourceId)).toBe(true)

    const oldHermesPid = await unitPid('hermes-gateway')
    const oldMccPid = await unitPid('mission-control')
    await page.goto('/backup')
    await expect(page.getByText('管理 Hermes 備份、排程與還原點', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '還原', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: basename(backupFile) })
    const preview = page.waitForResponse(r => r.url().endsWith('/api/backup/restore') && r.request().postDataJSON()?.dryRun === true)
    await row.getByRole('button', { name: '還原', exact: true }).click()
    const previewResponse = await preview
    expect(previewResponse.status()).toBe(200)
    expect((await previewResponse.json()).kind).toBe('mcc')
    await expect(page.getByText('此操作將覆蓋目前的 Hermes 資料與 MCC 資料庫。')).toBeVisible()
    const restore = page.waitForResponse(r => r.url().endsWith('/api/backup/restore') && r.request().postDataJSON()?.dryRun === false)
    await page.getByRole('button', { name: '確認還原', exact: true }).click()
    const restoreResponse = await restore
    expect(restoreResponse.status()).toBe(200)
    const { jobId: restoreId } = await restoreResponse.json()
    restoreStarted = true
    await expectJobSuccess(api, restoreId, 120_000)
    const runningAgain = async () => {
      const pid = await unitPid('mission-control')
      return pid > 0 && pid !== oldMccPid
    }
    await expect.poll(runningAgain, { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => {
      try {
        const response = await api.get('/api/backup?type=dashboard', { timeout: 5_000 })
        if (response.status() === 401) {
          await api.post('/api/auth', { data: { password: process.env.AUTH_PASSWORD } })
          return undefined
        }
        return response.ok() ? (await response.json()).lastDbRestore : undefined
      } catch {
        return undefined
      }
    }, { timeout: 60_000 }).toMatchObject({ result: 'applied', at: expect.any(String) })

    const hermesPid = await unitPid('hermes-gateway')
    expect(hermesPid).toBeGreaterThan(0)
    expect(hermesPid).not.toBe(oldHermesPid)
    await native('GET', '/health/detailed')
    expect((await native<{ session: { title: string } }>('GET', sessionPath)).session.title).toBe(marker)
    expect((await history()).data.map(({ role, content }) => ({ role, content }))).toEqual(before)
    expect((await native<{ job: { name: string; enabled: boolean } }>('GET', jobPath)).job)
      .toMatchObject({ name: marker, enabled: false })
    expect((await sources()).some(source => source.id === sourceId)).toBe(false)
    const restoredLog = await api.get(`/api/backup/logs?logId=${logId}`)
    expect(restoredLog.status()).toBe(200)
    expect(await restoredLog.json()).toMatchObject({ status: 'completed', filePath: backupFile })

    await page.evaluate((id) => localStorage.setItem('chat-page-session', id), sessionId)
    await page.goto('/chat')
    await expect(page.locator('textarea')).toBeEnabled()
    await sendChatTurnOnCurrentPage(page, 'Say READY to confirm the restore chat works.')
    console.log(`Restored ${basename(backupFile)} (${archive.bytes} bytes, 0600), transcript (${before.length} rows), paused job, and MCC SQLite. Hermes PID ${oldHermesPid} → ${hermesPid}, MCC PID ${oldMccPid} → ${await unitPid('mission-control')}.`)
    restoreStarted = false
  } finally {
    // Leave the fixtures intact if a submitted restore has not been verified yet.
    if (!restoreStarted) {
      if (backupFile) await api.post('/api/backup?action=delete', { data: { file: backupFile } })
      if (sourceId) await api.delete(`/api/backup/sources?id=${sourceId}`)
      if (jobPath) await hermesApi('DELETE', jobPath)
      await hermesApi('DELETE', sessionPath)
    }
  }
})
