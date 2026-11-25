import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import reads from '../../unit/fixtures/hermes-0.21.5-reads.json'
import runs from '../../unit/fixtures/hermes-0.21.5-runs.json'
import { approvalFixture, approvalPrompt, approvalSize, manualApprovals, removeApprovalFixture, restoreApprovals, waitForHermesApi } from './approvals'
import { hermesApi, native, requireHermes } from './target'

type NativeEvent = { event: string; request_id?: string; delta?: string; output?: string }

// Additional upstream fields are allowed. Fail on a missing fixture field or a
// changed primitive type, including explicit nulls in the controlled samples.
function fixtureShape(value: unknown): unknown {
  if (Array.isArray(value)) return expect.arrayContaining(value.map(fixtureShape))
  if (value && typeof value === 'object') {
    return expect.objectContaining(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, fixtureShape(nested)])))
  }
  if (typeof value === 'string') return expect.any(String)
  if (typeof value === 'number') return expect.any(Number)
  if (typeof value === 'boolean') return expect.any(Boolean)
  return value
}

test.beforeEach(async ({ request, baseURL }) => requireHermes(request, baseURL))

test('matches native health, session, usage, history, job and run fixtures', async () => {
  const session = `mcc-e2e-wire-${randomUUID()}`
  const title = `Wire shape ${session.slice(-8)}`
  const sessionPath = `/api/sessions/${session}`
  let jobPath: string | undefined
  let runPath: string | undefined
  try {
    const health = await native<{ version: string }>('GET', '/health')
    expect(health).toEqual(fixtureShape(reads.health))
    expect(health).toMatchObject({ platform: reads.health.platform, status: reads.health.status })
    expect(await native('GET', '/health/detailed')).toEqual(fixtureShape(reads.detailedHealth))

    const payload = {
      input: 'Use the terminal tool to run exactly: printf HERMES_WIRE_SHAPE. After receiving stdout, reply with HERMES_WIRE_SHAPE.',
      session_id: session,
    }
    const headers = { 'Idempotency-Key': session }
    const submitted = await native<{ run_id: string }>('POST', '/v1/runs', 202, payload, headers)
    expect(submitted).toEqual(fixtureShape(runs.submitted))
    expect(submitted).toMatchObject({ status: runs.submitted.status, replayed: runs.submitted.replayed })
    runPath = `/v1/runs/${submitted.run_id}`
    const replay = await native('POST', '/v1/runs', runs.replay.status, payload, headers)
    expect(replay).toMatchObject({ run_id: submitted.run_id, replayed: runs.replay.replayed })

    const events = await native<NativeEvent[]>('GET', `${runPath}/events`)
    for (const fixture of [runs.toolStart, runs.toolComplete, runs.terminal]) {
      expect(events.find(event => event.event === fixture.event), fixture.event).toEqual(fixtureShape(fixture))
    }
    expect(events.some(event => event.event === 'message.delta' && typeof event.delta === 'string')).toBe(true)
    expect(events.find(event => event.event === 'run.completed')?.output).toContain('HERMES_WIRE_SHAPE')
    expect(await native('GET', runPath)).toMatchObject({
      status: 'completed', session_id: session, output: expect.any(String),
    })
    expect((await hermesApi('GET', `${runPath}/events`)).status).toBe(runs.streamReopenStatus)

    await native('PATCH', sessionPath, 200, { title })
    const sessions = await native<{ data: { id: string }[] }>('GET', '/api/sessions?limit=200&offset=0')
    expect(sessions).toEqual(fixtureShape({ ...reads.sessions, data: [] }))
    expect(sessions.data.find(row => row.id === session)).toEqual(fixtureShape(reads.sessions.data[0]))

    const messages = await native('GET', `${sessionPath}/messages?order=latest&limit=2`)
    expect(messages).toEqual(fixtureShape(reads.historyLatest))
    expect(messages).toMatchObject({ session_id: session, pagination: reads.historyLatest.pagination })
    const allMessages = await native('GET', `${sessionPath}/messages`)
    expect(allMessages).toEqual(expect.objectContaining({ pagination: fixtureShape(reads.historyDefaultPagination) }))

    const { job } = await native<{ job: { id: string } }>('POST', '/api/jobs', 200, {
      name: title, prompt: 'Paused native shape fixture', schedule: '0 0 1 1 *',
    })
    jobPath = `/api/jobs/${job.id}`
    await native('POST', `${jobPath}/pause`, 200, {})
    const jobs = await native<{ jobs: { id: string }[] }>('GET', '/api/jobs?include_disabled=true')
    expect(jobs.jobs.find(row => row.id === job.id)).toEqual(fixtureShape(reads.jobs.jobs[1]))
    const enabledJobs = await native<{ jobs: { id: string }[] }>('GET', '/api/jobs')
    expect(enabledJobs.jobs.some(row => row.id === job.id)).toBe(false)
    console.log(`Native wire compared with unit fixtures on Hermes ${health.version}`)
  } finally {
    if (runPath) await hermesApi('POST', `${runPath}/stop`, {})
    if (jobPath) await hermesApi('DELETE', jobPath)
    await hermesApi('DELETE', sessionPath)
  }
})

test('matches native manual approval and inactive approval fixtures', async () => {
  const session = `mcc-e2e-wire-approval-${randomUUID()}`
  const fixture = await approvalFixture()
  const snapshot = await manualApprovals()
  let runPath: string | undefined
  try {
    await waitForHermesApi()
    const submitted = await native<{ run_id: string }>('POST', '/v1/runs', 202, {
      input: approvalPrompt(fixture), session_id: session,
    })
    runPath = `/v1/runs/${submitted.run_id}`
    const { status, body } = await hermesApi<{
      events: NativeEvent[]
      control: { waiting: unknown; status: number; body: unknown }
    }>('GET', `${runPath}/events`, undefined, {}, 'deny')
    expect(status).toBe(200)
    const approval = body.events.find(event => event.event === runs.approvalRequest.event)
    expect(approval).toEqual(fixtureShape(runs.approvalRequest))
    expect(approval).toMatchObject({ choices: runs.approvalRequest.choices })
    expect(body.control.waiting).toMatchObject(runs.waiting)
    expect(body.control.status).toBe(200)
    expect(body.control.body).toMatchObject(runs.approvalResponse)
    expect(body.events.find(event => event.event === runs.terminal.event)).toEqual(fixtureShape(runs.terminal))
    const inactive = await native('POST', `${runPath}/approval`, runs.approvalInactive.status, {
      choice: 'deny', request_id: approval!.request_id,
    })
    expect(inactive).toMatchObject(runs.approvalInactive.body)
    expect(await approvalSize(fixture)).toBe(0)
  } finally {
    try {
      if (runPath) await hermesApi('POST', `${runPath}/stop`, {})
      await hermesApi('DELETE', `/api/sessions/${session}`)
      await removeApprovalFixture(fixture)
    } finally {
      await restoreApprovals(snapshot)
    }
  }
})
