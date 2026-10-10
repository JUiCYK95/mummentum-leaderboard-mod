import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Call = { url: string; body: Record<string, unknown> }

// Ein Leaderboard-Server im Speicher, unter dem Mod: zählt mit, was ankommt.
function server(on: On) {
  const calls: Call[] = []
  let tokens = 0
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  mock.clock(on)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('command.register', () => ({ value: undefined as never }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Ada Lovelace\n', stderr: '' } as never }))
  on('http.fetch', ($, e) => {
    const body = JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url: e.url, body })
    const reply = (status: number, data: unknown) => ({
      value: { status, ok: status < 300, headers: {}, text: JSON.stringify(data) } as never,
    })
    if (e.url.endsWith('/api/register')) return reply(201, { id: 'id-1', secret: 's3cret', name: body.name })
    if (e.url.endsWith('/api/usage')) {
      const u = body.usage as Record<string, number>
      tokens += u.input! + u.output! + u.cacheRead! + u.cacheWrite!
      return reply(200, { tokens, rank: 1 })
    }
    if (e.url.endsWith('/api/leave')) return reply(200, { removed: true })
    return reply(404, {})
  })
  return calls
}

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never

const turn = (input: number, output: number) =>
  ({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: `t-${input}`,
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: input, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  }) as never

test('trägt sich mit dem Git-Namen ein und meldet den Verbrauch', async ($, on) => {
  const calls = server(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.start(START)
  await $.turn.complete(turn(1000, 500))
  const shown = await $.command.run({ command: 'leaderboard', args: '' } as never)
  expect(String((shown as { text?: string }).text)).toContain('Platz 1')
  const register = calls.find(c => c.url.endsWith('/api/register'))
  expect(register?.body.name).toBe('Ada Lovelace')

  const reported = calls.filter(c => c.url.endsWith('/api/usage')).map(c => c.body.usage)
  expect(reported).toContainEqual({ input: 1000, output: 500, cacheRead: 100, cacheWrite: 0 })
  expect(calls.filter(c => c.url.endsWith('/api/register'))).toHaveLength(1)
})

test('nach /leaderboard austreten wird nichts mehr gemeldet', async ($, on) => {
  const calls = server(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.start(START)
  await $.command.run({ command: 'leaderboard', args: 'austreten' } as never)
  expect(calls.some(c => c.url.endsWith('/api/leave'))).toBe(true)

  const before = calls.length
  await $.turn.complete(turn(5000, 5000))
  await $.session.start(START)
  expect(calls.slice(before).some(c => c.url.endsWith('/api/usage') || c.url.endsWith('/api/register'))).toBe(false)
})
