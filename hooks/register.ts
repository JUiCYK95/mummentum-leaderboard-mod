import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Standing, TokenUsage } from '../types'

export const LEADERBOARD_URL: string = 'https://mummentum-leaderboard.vercel.app'

const FLUSH_EVERY_MS = 60_000
const MIN_GAP_MS = 15_000
const ZERO: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const pending = atom({ plugin: 'mummentum-leaderboard', key: 'pending' } as const, ZERO)
const standing = atom({ plugin: 'mummentum-leaderboard', key: 'standing' } as const, null)

type $ = EngineInterface
type Credentials = { id: string; secret: string; name: string }

const sum = (u: TokenUsage) => u.input + u.output + u.cacheRead + u.cacheWrite

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Mrd.`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} Mio.`
  if (n >= 1e4) return `${Math.round(n / 1e3)} Tsd.`
  return String(n)
}

function isCredentials(value: unknown): value is Credentials {
  const v = value as Partial<Credentials> | null
  return typeof v?.id === 'string' && typeof v.secret === 'string' && typeof v.name === 'string'
}

async function post($: $, path: string, body: unknown) {
  if (LEADERBOARD_URL === '') return { status: 0, ok: false, data: {} as Record<string, unknown> }
  const res = await $.http.fetch(`${LEADERBOARD_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(res.text) as Record<string, unknown>
  } catch {}
  return { status: res.status, ok: res.ok, data }
}

async function gitName($: $): Promise<string> {
  for (const argv of [
    ['git', 'config', '--global', '--get', 'user.name'],
    ['git', 'config', '--get', 'user.name'],
    ['whoami'],
  ]) {
    try {
      const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 5000 })
      const name = stdout.trim()
      if (exitCode === 0 && name !== '') return name
    } catch {}
  }
  return ''
}

// Was nur diese Ladung des Moduls braucht; ein Reload fängt hier neu an.
const run: {
  registering: Promise<Credentials | null> | undefined
  flushing: Promise<void> | undefined
  lastFlush: number
  model: string | undefined
} = { registering: undefined, flushing: undefined, lastFlush: 0, model: undefined }

async function credentials($: $): Promise<Credentials | null> {
  const stored = await $.store.get('credentials')
  if (isCredentials(stored)) return stored
  if ((await $.store.get('optedOut')) === true) return null
  run.registering ??= (async () => {
    const name = await gitName($)
    const { ok, data } = await post($, '/api/register', { name })
    if (!ok || typeof data.id !== 'string' || typeof data.secret !== 'string') return null
    const creds: Credentials = { id: data.id, secret: data.secret, name: String(data.name ?? name) }
    await $.store.set('credentials', creds)
    $.ui.toast(`🏆 Im mummentum-Leaderboard eingetragen als „${creds.name}“`)
    return creds
  })().finally(() => {
    run.registering = undefined
  })
  return run.registering
}

async function showStatus($: $): Promise<void> {
  const s = await read($, standing)
  const open = sum(await read($, pending))
  if (s === null) return $.ui.status(open > 0 ? `🏆 ${formatTokens(open)} Tokens` : undefined)
  $.ui.status(`🏆 #${s.rank} · ${formatTokens(s.tokens + open)} Tokens`)
}

/** Meldet den vorgemerkten Verbrauch; läuft schon eine Meldung, wird danach gemeldet. */
async function flush($: $): Promise<void> {
  while (run.flushing) await run.flushing
  run.flushing = send($).finally(() => {
    run.flushing = undefined
  })
  return run.flushing
}

async function send($: $): Promise<void> {
  run.lastFlush = await $.clock.now()
  try {
    const creds = await credentials($)
    if (creds === null) return
    const sent = await read($, pending)
    if (sum(sent) === 0) return
    const { status, ok, data } = await post($, '/api/usage', {
      id: creds.id,
      secret: creds.secret,
      usage: sent,
      model: run.model,
    })
    if (status === 401) {
      // Der Eintrag existiert auf dem Server nicht mehr: beim nächsten Mal neu anlegen.
      await $.store.delete('credentials')
      return
    }
    if (!ok) return
    await update($, pending, cur => ({
      input: Math.max(0, cur.input - sent.input),
      output: Math.max(0, cur.output - sent.output),
      cacheRead: Math.max(0, cur.cacheRead - sent.cacheRead),
      cacheWrite: Math.max(0, cur.cacheWrite - sent.cacheWrite),
    }))
    if (typeof data.rank === 'number' && typeof data.tokens === 'number') {
      const next: Standing = { rank: data.rank, tokens: data.tokens }
      await update($, standing, () => next)
      await $.store.set('standing', next)
    }
  } catch {
    // Netzwerkfehler: der Verbrauch bleibt vorgemerkt und geht beim nächsten Mal mit.
  } finally {
    await showStatus($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'leaderboard',
      description: 'mummentum-Leaderboard: Platz anzeigen (name <Name> | austreten | beitreten)',
    })
    const stored = await $.store.get('standing')
    const s = stored as Partial<Standing> | undefined
    if (typeof s?.rank === 'number' && typeof s.tokens === 'number') {
      const known: Standing = { rank: s.rank, tokens: s.tokens }
      await update($, standing, () => known)
    }
    await showStatus($)
    $.clock.every(FLUSH_EVERY_MS, () => {
      void (async () => {
        if (sum(await read($, pending)) > 0) await flush($)
      })().catch(() => undefined)
    })
    void flush($).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = e.usage
    if (u !== undefined && (await $.store.get('optedOut')) !== true) {
      run.model = u.model
      await update($, pending, cur => ({
        input: cur.input + u.input_tokens,
        output: cur.output + u.output_tokens,
        cacheRead: cur.cacheRead + u.cache_read_input_tokens,
        cacheWrite: cur.cacheWrite + u.cache_creation_input_tokens,
      }))
      if ((await $.clock.now()) - run.lastFlush >= MIN_GAP_MS) void flush($).catch(() => undefined)
      else await showStatus($)
    }

    return done
  })

  on('session.end', async ($, e, next) => {
    if (sum(await read($, pending)) > 0) await flush($)
    return next(e)
  })

  on('command.run', { command: 'leaderboard' }, async ($, e) => {
    const [sub, ...rest] = e.args.trim().split(/\s+/)
    if (sub === 'austreten') {
      const creds = await credentials($)
      if (creds !== null) {
        const { ok, status } = await post($, '/api/leave', { id: creds.id, secret: creds.secret })
        if (!ok && status !== 401) return { text: 'Austreten fehlgeschlagen, das Leaderboard ist gerade nicht erreichbar.' }
      }
      await $.store.set('optedOut', true)
      await $.store.delete('credentials')
      await $.store.delete('standing')
      await update($, standing, () => null)
      await update($, pending, () => ZERO)
      $.ui.status(undefined)
      return { text: 'Du bist aus dem mummentum-Leaderboard ausgetreten. Mit /leaderboard beitreten kommst du zurück.' }
    }
    if (sub === 'beitreten') {
      await $.store.delete('optedOut')
      const creds = await credentials($)
      return { text: creds ? `Willkommen zurück im Leaderboard als „${creds.name}“.` : 'Das Leaderboard ist gerade nicht erreichbar.' }
    }
    if (sub === 'name') {
      const name = rest.join(' ').trim()
      if (name === '') return { text: 'Bitte einen Namen angeben: /leaderboard name <Neuer Name>' }
      const creds = await credentials($)
      if (creds === null) return { text: 'Das Leaderboard ist gerade nicht erreichbar.' }
      const { ok, data } = await post($, '/api/rename', { id: creds.id, secret: creds.secret, name })
      if (!ok) return { text: `Umbenennen fehlgeschlagen: ${String(data.error ?? 'unbekannter Fehler')}` }
      await $.store.set('credentials', { ...creds, name: String(data.name ?? name) })
      return { text: `Du heißt im Leaderboard jetzt „${String(data.name ?? name)}“.` }
    }

    await flush($)
    const creds = await credentials($)
    const s = await read($, standing)
    const who = creds ? `„${creds.name}“` : '(noch nicht eingetragen)'
    const where = s ? `Platz ${s.rank} mit ${s.tokens.toLocaleString('de-DE')} Tokens` : 'noch kein Platz'
    return { text: `🏆 mummentum-Leaderboard: ${who}, ${where}.\n${LEADERBOARD_URL}` }
  })
}
