/**
 * model.ts — the pure half of the painel: no `$`, no engine, so it is tested directly.
 *
 * Adapted from four MIT mods:
 *   - prompt-cache-control (claude-code-templates): the cache TTL rules, observing the TTL from request timing
 *   - savvy-progress (johnnyvizz): the per-model price table and context windows of subagents
 *   - plan-progress (Kirill Serditov, zycck): the plan ops (next / done / active / failed) and carrying done steps over
 *   - session-band (johnnyvizz): the band's width tiers and the amber/red cache frame
 */
import type { CacheTurn, Plan, PlanStage, PlanState, PlanStep, PlannedTask, StepStatus } from '../types'

// --- Cache -------------------------------------------------------------------

export type Ttl = '5m' | '1h'

export type CacheEnv = {
  enable1h?: string
  force5m?: string
  ttlVar?: string
}

export type Account = 'subscription' | 'credits' | 'other'

export const isOn = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true'
const asTtl = (v: unknown): Ttl | undefined => (v === '5m' || v === '1h' ? v : undefined)

/**
 * Which lifetime Claude Code asks for on the main conversation, in the order its documentation gives:
 * the mod's own `ttl` option, FORCE_PROMPT_CACHING_5M, CLAUDE_CODE_PROMPT_CACHE_TTL, the promptCacheTtl
 * setting, ENABLE_PROMPT_CACHING_1H, then the account (1 hour on a Claude subscription, 5 minutes otherwise).
 */
export function decideTtl(option: unknown, env: CacheEnv, setting?: unknown, account?: Account): { ttl: Ttl; source: string } {
  const pinned = asTtl(option)
  if (pinned) return { ttl: pinned, source: 'ttl option' }
  if (isOn(env.force5m)) return { ttl: '5m', source: 'FORCE_PROMPT_CACHING_5M' }
  const fromVar = asTtl(env.ttlVar)
  if (fromVar) return { ttl: fromVar, source: 'CLAUDE_CODE_PROMPT_CACHE_TTL' }
  const fromSetting = asTtl(setting)
  if (fromSetting) return { ttl: fromSetting, source: 'promptCacheTtl setting' }
  if (isOn(env.enable1h)) return { ttl: '1h', source: 'ENABLE_PROMPT_CACHING_1H' }
  if (account === 'subscription') return { ttl: '1h', source: 'subscription default' }
  if (account === 'credits') return { ttl: '5m', source: 'usage credits default' }
  return { ttl: '5m', source: 'default' }
}

/** A five-hour or seven-day window means a subscription; one that is full means usage credits. */
export function accountOf(windows: readonly { kind: string; percentUsed: number }[]): Account {
  const plan = windows.filter(w => w.kind === 'five_hour' || w.kind === 'seven_day')
  if (plan.length === 0) return 'other'
  return plan.some(w => w.percentUsed >= 100) ? 'credits' : 'subscription'
}

export const ttlMs = (ttl: Ttl) => (ttl === '1h' ? 3_600_000 : 300_000)

/** One main-loop request, as the API reported it. */
export type Sample = { model: string; startedAt: number; read: number; write: number; fresh: number }

export const promptTokens = (s: { read: number; write: number; fresh: number }) => s.read + s.write + s.fresh
export const hitRatio = (s: { read: number; write: number; fresh: number }) => {
  const total = promptTokens(s)
  return total === 0 ? 0 : s.read / total
}

const SLACK_MS = 10_000

/**
 * What the traffic says about the lifetime: a hit more than 5 minutes after the previous request
 * proves 1 hour; a miss 5 minutes to an hour later with the same model and a prompt that did not
 * shrink says 5 minutes (a later hit overrules it).
 */
export function observeTtl(prev: Sample | undefined, cur: Sample, known: Ttl | undefined): Ttl | undefined {
  if (!prev || prev.read + prev.write === 0 || cur.model !== prev.model) return known
  const gap = cur.startedAt - prev.startedAt
  const before = promptTokens(prev)
  if (gap <= ttlMs('5m') + SLACK_MS) return known
  if (cur.read >= before * 0.5) return '1h'
  if (known === '1h') return known
  const lapsed = cur.write > 0 && promptTokens(cur) >= before * 0.7 && gap < ttlMs('1h') + SLACK_MS
  return lapsed ? '5m' : known
}

export type CacheLevel = 'ok' | 'warn' | 'alert' | 'expired'

/**
 * The countdown's colour: amber from a third of the lifetime left, red from a sixth
 * (20 and 10 minutes on the 1-hour cache, as session-band drew it).
 */
export function cacheLevel(secondsLeft: number, ttl: Ttl): CacheLevel {
  const life = ttlMs(ttl) / 1000
  if (secondsLeft <= 0) return 'expired'
  if (secondsLeft <= life / 6) return 'alert'
  if (secondsLeft <= life / 3) return 'warn'
  return 'ok'
}

/** Adds one request to the per-turn table, oldest first, at most `keep` turns. */
export function addToTurns(turns: readonly CacheTurn[], turn: number, s: Sample & { output: number }, keep = 100): CacheTurn[] {
  const last = turns[turns.length - 1]
  if (last && last.turn === turn) {
    const row = {
      ...last,
      requests: last.requests + 1,
      read: last.read + s.read,
      write: last.write + s.write,
      fresh: last.fresh + s.fresh,
      output: last.output + s.output,
    }
    return [...turns.slice(0, -1), row]
  }
  return [...turns, { turn, requests: 1, read: s.read, write: s.write, fresh: s.fresh, output: s.output }].slice(-keep)
}

// --- Cost (estimates for subagents; the session's own cost comes from the engine) ---------------

type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

// USD per million tokens; the first row that matches wins. Cache writes at the 1-hour rate.
const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function costOf(model: string, u: Usage): number {
  const id = model.toLowerCase()
  const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const [i, o, r, w] = prompt > 100_000 && /haiku-5-5/.test(id) ? HAIKU_LONG : (PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8])
  return (
    ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
  )
}

export const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

export const TIERS = ['fable', 'heavy', 'careful', 'medium', 'light'] as const

/** `savvy-careful` or `planfig-mods:savvy-careful` → `careful`; anything else → `''`. */
export function tierOf(type: string): string {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^savvy-/, '').toLowerCase()
  return bare.startsWith('savvy-') && (TIERS as readonly string[]).includes(t) ? t : ''
}

export const isSavvy = (type: string) => tierOf(type) !== ''

export function modelName(id: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

// --- Formatting ----------------------------------------------------------------

export const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** m:ss, or h:mm:ss from an hour up. */
export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`
}

export function bar(ratio: number, width: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

export const fit = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

/**
 * The top row drops details as the band narrows instead of wrapping:
 * 0 everything; 1 no "Turn" word; 2 no session cost; 3 no speed; 4 no turn number.
 */
const TIER_MIN = [84, 70, 58, 46] as const
export function tierFor(columns: number): number {
  const i = TIER_MIN.findIndex(min => columns >= min)
  return i === -1 ? TIER_MIN.length : i
}

// --- Plans ------------------------------------------------------------------------

type Raw = Record<string, unknown>
const STATUSES: StepStatus[] = ['pending', 'active', 'done', 'error', 'skipped']
const MAX_STEPS = 60
const MAX_TASKS = 200

/** A short single-line text: control characters out (an ESC would reach the terminal as a command), cut at `max`. */
export const str = (v: unknown, max = 120) =>
  typeof v === 'string'
    ? v
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F-\u009F￾￿]/g, '')
        .trim()
        .slice(0, max)
        .replace(/[\uD800-\uDBFF]$/, '')
        .trimEnd()
    : ''

const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []) as Raw[]
const statusOf = (v: unknown): StepStatus => (STATUSES.includes(v as StepStatus) ? (v as StepStatus) : 'pending')
export const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export const slug = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

export const stepsOf = (p: Plan): PlanStep[] => p.stages.flatMap(s => s.steps)

/** With nothing in progress, the first open step becomes active. */
function pointAt(stages: PlanStage[]): PlanStage[] {
  const steps = stages.flatMap(s => s.steps)
  if (steps.some(st => st.status === 'active' || st.status === 'error')) return stages
  const first = steps.find(st => st.status === 'pending')
  return stages.map(s => ({ ...s, steps: s.steps.map(st => (st === first ? { ...st, status: 'active' as const } : st)) }))
}

/** A resent plan keeps what is finished: a step sent pending under a title that was done stays done. */
function carryDone(stages: PlanStage[], before: PlanStage[]): PlanStage[] {
  const finished = new Map<string, PlanStep[]>()
  for (const st of before.flatMap(s => s.steps).filter(st => isFinished(st.status))) {
    const key = st.title.trim().toLowerCase()
    finished.set(key, [...(finished.get(key) ?? []), st])
  }
  return stages.map(s => ({
    ...s,
    steps: s.steps.map(st => {
      const queue = finished.get(st.title.trim().toLowerCase())
      const was = queue?.[0]
      if (!queue || !was || st.status !== 'pending') return st
      queue.shift()
      return { ...st, status: was.status, doneAt: was.doneAt }
    }),
  }))
}

/** The short ops: next, done, active, failed. Titles it cannot find come back in `missing`. */
function applyOps(stages: PlanStage[], input: Raw, now: number): { stages: PlanStage[]; missing: string[] } {
  const out = stages.map(s => ({ ...s, steps: s.steps.map(st => ({ ...st })) }))
  const steps = out.flatMap(s => s.steps)
  const missing: string[] = []
  const finish = (st: PlanStep) => {
    if (!isFinished(st.status)) Object.assign(st, { status: 'done', doneAt: now })
  }
  const find = (title: string) => {
    const found = steps.find(st => same(st.title, title) && !isFinished(st.status)) ?? steps.find(st => same(st.title, title))
    if (!found) missing.push(title)
    return found
  }
  const openAfter = (at: number) => steps.slice(at + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
  if (input.next === true) {
    const active = steps.findIndex(st => st.status === 'active')
    const at = active >= 0 ? active : steps.findIndex(st => !isFinished(st.status))
    const cur = steps[at]
    if (cur) finish(cur)
    const following = openAfter(at)
    if (following && typeof input.active !== 'string') following.status = 'active'
  }
  let lastDone = -1
  for (const t of Array.isArray(input.done) ? input.done : []) {
    const st = typeof t === 'string' ? find(t) : undefined
    if (st?.status === 'active') lastDone = steps.indexOf(st)
    if (st) finish(st)
  }
  if (lastDone >= 0 && typeof input.active !== 'string' && !steps.some(st => st.status === 'active')) {
    const following = openAfter(lastDone)
    if (following) following.status = 'active'
  }
  const active = typeof input.active === 'string' ? find(input.active) : undefined
  if (active) {
    const at = steps.indexOf(active)
    steps.forEach((st, i) => {
      if (st.status === 'active' && i !== at) {
        if (i < at) finish(st)
        else st.status = 'pending'
      }
    })
    active.status = 'active'
    delete active.doneAt
  }
  const failed = typeof input.failed === 'string' ? find(input.failed) : undefined
  if (failed) {
    failed.status = 'error'
    delete failed.doneAt
  }
  return { stages: out, missing }
}

const TIER_SET = new Set<string>(TIERS)
function cleanTasks(v: unknown): PlannedTask[] | undefined {
  if (!Array.isArray(v)) return undefined
  return list(v)
    .filter(t => str(t.title))
    .slice(0, MAX_TASKS)
    .map(t => {
      const tier = str(t.tier, 20).replace(/^savvy-/, '').toLowerCase()
      return {
        title: str(t.title),
        tier: TIER_SET.has(tier) ? tier : '',
        after: (Array.isArray(t.after) ? t.after : []).filter((n): n is number => Number.isInteger(n) && (n as number) > 0).slice(0, 20),
      }
    })
}

/**
 * The plan a `painel_plan` call leaves, or the refusal text. `stages` creates or resends the whole plan;
 * `tasks` (the orchestrator's worker tasks, with tiers) also make the steps when no `stages` are sent;
 * the short ops move it. A finished plan sent again under another title starts from zero.
 */
export function editPlan(input: Raw, prev: Plan | null, now: number, id: string): Plan | string {
  const tasks = cleanTasks(input.tasks)
  let sent = list(input.stages)
    .map(s => ({
      name: str(s.name, 80) || 'Stage',
      steps: list(s.steps)
        .slice(0, MAX_STEPS)
        .map(st => ({ title: str(st.title) || 'Step', status: statusOf(st.status) })),
    }))
    .filter(s => s.steps.length > 0) as PlanStage[]
  if (sent.length === 0 && tasks && tasks.length > 0) {
    sent = [{ name: 'Tasks', steps: tasks.slice(0, MAX_STEPS).map(t => ({ title: t.title, status: 'pending' as const })) }]
  }
  const title = str(input.title, 80)
  const isNext = !!prev && prev.state === 'done' && sent.length > 0 && !!title && !same(title, prev.title)
  const was = isNext ? null : prev
  const isPartial = sent.length === 0
  if (isPartial && !was) return `painel_plan: no plan "${id}" yet; create it with title and stages.`
  const base = isPartial ? was!.stages : pointAt(was ? carryDone(sent, was.stages) : sent)
  const { stages, missing } = applyOps(base, input, now)
  if (missing.length > 0) {
    const titles = stages.flatMap(s => s.steps.map(st => st.title)).join(', ')
    return `painel_plan: "${id}" has no step ${missing.map(t => `"${str(t, 60)}"`).join(', ')}. Its steps: ${str(titles, 400)}`
  }
  const steps = stages.flatMap(s => s.steps)
  const isAllDone = steps.length > 0 && steps.every(s => isFinished(s.status))
  const asked = input.state as PlanState
  const finished = input.finished === true
  const state: PlanState = finished
    ? 'done'
    : ['running', 'needs_input', 'error', 'done'].includes(asked)
      ? asked
      : isAllDone
        ? 'done'
        : typeof input.failed === 'string'
          ? 'error'
          : 'running'
  const closed = state === 'done' ? stages.map(s => ({ ...s, steps: s.steps.map(st => (isFinished(st.status) ? st : { ...st, status: 'done' as const, doneAt: now })) })) : stages
  return {
    id,
    title: title || was?.title || 'Plan',
    kind: input.kind === 'todo' || (isPartial && was?.kind === 'todo') ? 'todo' : 'plan',
    stages: closed,
    state,
    note: str(input.note, 160) || null,
    tasks: tasks ?? was?.tasks ?? [],
    startedAt: was ? was.startedAt : now,
    endedAt: state === 'done' ? (was?.endedAt ?? now) : null,
    touchedAt: now,
  }
}

/** "3/7" and the share done, for the band. */
export function progressOf(p: Plan): { done: number; total: number; ratio: number; active: PlanStep | undefined } {
  const steps = stepsOf(p)
  const done = steps.filter(s => isFinished(s.status)).length
  const total = steps.length
  return { done, total, ratio: total ? done / total : 0, active: steps.find(s => s.status === 'active' || s.status === 'error') }
}

/**
 * The orchestrator's old `progress` call (savvy-progress) as a `painel_plan` call: tasks become
 * the steps, `done` finishes the first n, `finished` closes it.
 */
export function fromSavvyProgress(input: Raw, prev: Plan | null): Raw {
  const out: Raw = {}
  if (typeof input.title === 'string') out.title = input.title
  if (Array.isArray(input.tasks)) out.tasks = input.tasks
  if (input.finished === true) out.finished = true
  const done = typeof input.done === 'number' ? Math.max(0, Math.floor(input.done)) : undefined
  let titles = Array.isArray(input.tasks)
    ? list(input.tasks).map(t => str(t.title)).filter(Boolean)
    : prev
      ? stepsOf(prev).map(s => s.title)
      : []
  if (!prev && titles.length === 0) {
    // A flow reported by counts alone: numbered steps stand in for its tasks.
    const total = typeof input.total === 'number' ? Math.min(MAX_STEPS, Math.max(1, Math.floor(input.total))) : 1
    titles = Array.from({ length: total }, (_, i) => `Task ${i + 1}`)
    out.stages = [{ name: 'Tasks', steps: titles.map(title => ({ title })) }]
  }
  if (done !== undefined) out.done = titles.slice(0, done)
  return out
}
