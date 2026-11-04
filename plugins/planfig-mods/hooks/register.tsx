/**
 * painel — one band above the prompt and one detailed pane (/painel) for a Claude Code session.
 *
 * Joins, adapts and de-duplicates four MIT mods:
 *   - session-band (johnnyvizz): turn, tok/s, turn and session cost, context, cache countdown with an amber/red frame
 *   - prompt-cache-control (claude-code-templates): cache read share per request and per turn, the right TTL per account
 *   - plan-progress (Kirill Serditov, zycck): plan bars moved by short ops, sounds for a question, an error and done
 *   - savvy-progress (johnnyvizz): subagent rows with tier, task, steps, context and estimated cost
 *
 * One cache clock and one agent list: the top row carries the session, a second part (only while there is a plan
 * or subagents) the plan and one row per agent. /painel opens the pane with everything in full.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentRun, CacheView, Plan, PlannedTask, Prefs, Stats } from '../types'
import {
  accountOf,
  addToTurns,
  bar,
  cacheLevel,
  costOf,
  decideTtl,
  editPlan,
  fit,
  fmtClock,
  fmtTokens,
  fromSavvyProgress,
  hitRatio,
  isFinished,
  isSavvy,
  modelName,
  observeTtl,
  progressOf,
  promptTokens,
  slug,
  stepsOf,
  str,
  tierFor,
  tierOf,
  ttlMs,
  usd,
  windowOf,
} from './model.ts'
import type { Account, CacheEnv, CacheLevel, Sample, Ttl } from './model.ts'
import {
  ACCENT,
  AGENT_H,
  ALERT,
  BAND_H,
  CACHE,
  CONTEXT,
  DONE,
  MONEY,
  MONEY_ICON,
  PLANNED_H,
  SPEED,
  SPEED_ICON,
  TURN_ICON,
  WARN,
  agentSvg,
  cacheIcon,
  cacheTableSvg,
  colorOf,
  contextBar,
  contextIcon,
  crab,
  costumeOf,
  CRAB_CSS,
  planRowSvg,
  planSvg,
  plannedSvg,
  tilesHeight,
  tilesSvg,
} from './draw.ts'

const P = 'planfig-mods'
const PLAN_TOOL = 'mcp__planfig-mods__painel_plan'
const STEP_TOOL = 'mcp__planfig-mods__painel_step'
// The originals' tools: when they are still installed, their calls are mirrored here so the band is the one place to look.
const OLD_PLAN = 'mcp__plan-progress__plan_progress'
const OLD_FLOW = 'mcp__savvy-progress__progress'
const OLD_STEP = 'mcp__savvy-progress__step'
const PANE = 'painel'
const COMMAND = 'painel'

const stats = atom({ plugin: 'planfig-mods', key: 'stats' } as const, { turn: 0, speed: null, turnCost: null, total: 0, context: 0, costAtStart: 0, turnStartedAt: 0 } as Stats, {
  shape: 'stats-1',
})
const cache = atom({ plugin: 'planfig-mods', key: 'cache' } as const, { ttl: '5m', ttlSource: 'default', expiresAt: null, last: null, turns: [] } as CacheView, {
  shape: 'cache-1',
})
const plans = atom({ plugin: 'planfig-mods', key: 'plans' } as const, [] as Plan[], { shape: 'plans-1' })
const agents = atom({ plugin: 'planfig-mods', key: 'agents' } as const, [] as AgentRun[], { shape: 'agents-1' })
const prefs = atom({ plugin: 'planfig-mods', key: 'prefs' } as const, { isHidden: false, isPaneOpen: false } as Prefs)
const now = atom({ plugin: 'planfig-mods', key: 'now' } as const, 0)

const MUTED_TEXT = '#8a8f8c'
// What each savvy tier runs on, for planned tasks with no run yet.
const TIER_MODEL: Record<string, string> = { fable: 'Fable · high', heavy: 'Opus · xhigh', careful: 'Opus · high', medium: 'Opus · medium', light: 'Opus · low' }

// Responses shorter than this are mostly tool-call stubs; one that arrived in one burst cannot be timed.
const MIN_TOKENS = 20
const MIN_SECONDS = 0.5
// Below this a lapsed cache costs too little to interrupt anyone about.
const TOAST_MIN_TOKENS = 20_000

const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`

const RULES = `# Painel
Tasks needing more than ~3 edits or commands get a plan via ${PLAN_TOOL}: create it once with the whole breakdown ({id, title, stages:[{name, steps:[{title}]}]}, 2-7 stages, or kind "todo" for one flat list; titles of at most 4 words, in the user's language; the first open step becomes active), then move it with short calls: {id, next:true} when the active step is finished, or {id, done:[...], active:"..."}, {id, failed:"...", note}, {id, state:"done"}. When the plan changes, resend stages under the same id and title; finished steps keep their done by title. Send state "needs_input" with a note before asking the user to decide. Never describe the painel to the user.`

// --- Language ---------------------------------------------------------------------

type Lang = 'en' | 'pt'
let lang: Lang = 'en'

const STRINGS = {
  en: {
    turn: 'Turn',
    cache: 'cache',
    expired: 'expired',
    context: 'ctx',
    open: 'painel',
    tiers: { fable: 'Fable', heavy: 'Heavy', careful: 'Careful', medium: 'Medium', light: 'Light' } as Record<string, string>,
    session: 'Session',
    turns: 'turns',
    speed: 'speed',
    turnCost: 'last turn',
    sessionCost: 'session',
    plans: 'Plans',
    noPlan: 'No plan yet.',
    agentsH: 'Agents',
    noAgents: 'No subagents yet.',
    planned: 'planned',
    cacheH: 'Prompt cache',
    lifetime: 'lifetime',
    noRequests: 'no requests yet',
    read: 'read',
    wrote: 'wrote',
    fresh: 'new',
    hit: 'hit',
    reqs: 'reqs',
    close: 'close',
    estimate: 'Agent costs are estimates from token counts; the session cost is Claude Code’s own.',
    soon: (m: string) => `Prompt cache expires in ${m}: send a message to keep it warm`,
    lapsed: (t: string) => `Prompt cache expired: the next message rewrites ${t} tokens (/compact first if the task goes on)`,
    opened: 'Painel opened.',
    closed: 'Painel closed.',
    hidden: 'Band hidden (/painel band shows it again).',
    shown: 'Band shown.',
    cost: 'Cost', tokens: 'Tokens', time: 'Time', running: 'Running', finished: 'Finished', plannedH: 'Planned',
    collapse: 'Collapse', expand: 'Expand', tasks: 'Tasks', steps: 'Steps', doneWord: 'Done', waiting: 'Waiting', failed: 'failed', after: 'after',
    left: 'left', lastHit: 'last hit', perTurn: 'Cache per turn', turnCol: 'turn', painel: 'Painel',
  },
  pt: {
    turn: 'Turno',
    cache: 'cache',
    expired: 'expirou',
    context: 'ctx',
    open: 'painel',
    tiers: { fable: 'Fable', heavy: 'Pesado', careful: 'Cuidadoso', medium: 'Médio', light: 'Leve' } as Record<string, string>,
    session: 'Sessão',
    turns: 'turnos',
    speed: 'velocidade',
    turnCost: 'último turno',
    sessionCost: 'sessão',
    plans: 'Planos',
    noPlan: 'Nenhum plano ainda.',
    agentsH: 'Agentes',
    noAgents: 'Nenhum subagente ainda.',
    planned: 'planejado',
    cacheH: 'Cache do prompt',
    lifetime: 'duração',
    noRequests: 'nenhuma requisição ainda',
    read: 'lido',
    wrote: 'gravado',
    fresh: 'novo',
    hit: 'acerto',
    reqs: 'req',
    close: 'fechar',
    estimate: 'Custos dos agentes são estimativas pelos tokens; o custo da sessão é o do próprio Claude Code.',
    soon: (m: string) => `O cache do prompt expira em ${m}: mande uma mensagem para mantê-lo`,
    lapsed: (t: string) => `O cache do prompt expirou: a próxima mensagem regrava ${t} tokens (/compact antes, se a tarefa continua)`,
    opened: 'Painel aberto.',
    closed: 'Painel fechado.',
    hidden: 'Faixa escondida (/painel band mostra de novo).',
    shown: 'Faixa visível.',
    cost: 'Custo', tokens: 'Tokens', time: 'Tempo', running: 'Rodando', finished: 'Concluídos', plannedH: 'Planejados',
    collapse: 'Recolher', expand: 'Expandir', tasks: 'Tarefas', steps: 'Passos', doneWord: 'Pronto', waiting: 'Aguardando', failed: 'falhou', after: 'depois de',
    left: 'restante', lastHit: 'último acerto', perTurn: 'Cache por turno', turnCol: 'turno', painel: 'Painel',
  },
}
const tr = () => STRINGS[lang]
const langOf = (v: unknown): Lang => (typeof v === 'string' && /^(pt|portu)/i.test(v.trim()) ? 'pt' : 'en')

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'pt') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return langOf(settings.language)
  } catch {
    // no settings: the locale decides
  }
  const none = () => undefined
  return langOf((await $.env.get('LC_ALL').catch(none)) || (await $.env.get('LANG').catch(none)))
}

const tierWord = (type: string) => {
  const t = tierOf(type)
  return t ? (tr().tiers[t] ?? t) : type.replace(/^[^:]*:/, '')
}

// --- Cache bookkeeping (module variables: they only steer how the next request is read) ------------

let env: CacheEnv = {}
let ttlSetting: unknown
let account: Account = 'other'
let observed: Ttl | undefined
let prevSample: Sample | undefined
let isBusy = false
// The level last announced for the current cache entry, so each toast fires once.
let toastedFor = 0
let toastedLevel: CacheLevel = 'ok'

async function readTtlSetting($: EngineInterface): Promise<unknown> {
  const home = await $.env.get('HOME').catch(() => undefined)
  const cwd = await $.session.cwd().catch(() => undefined)
  for (const file of [cwd && `${cwd}/.claude/settings.local.json`, cwd && `${cwd}/.claude/settings.json`, home && `${home}/.claude/settings.json`]) {
    if (!file) continue
    try {
      const v = JSON.parse(await $.fs.read(file)).promptCacheTtl
      if (v === '5m' || v === '1h') return v
    } catch {
      // missing or unreadable: the next file
    }
  }
  return undefined
}

const secondsLeft = (c: CacheView, at: number) => (c.expiresAt === null ? null : Math.max(0, Math.floor((c.expiresAt - at) / 1000)))

// --- Sounds (plan-progress): the engine's player, or PowerShell on Windows where it can stay silent ----------

let isSoundOn = true
function play($: EngineInterface, name: 'decision' | 'error' | 'done') {
  if (!isSoundOn) return
  const file = `${$.plugin.root}/sounds/${name}.wav`
  const viaPowerShell = () =>
    $.process
      .run(['powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '(New-Object Media.SoundPlayer $env:PAINEL_WAV).PlaySync()'], {
        env: { PAINEL_WAV: file.replace(/\//g, '\\') },
        timeoutMs: 5000,
      })
      .catch(() => undefined)
  if (/^[A-Za-z]:/.test($.plugin.root)) {
    void viaPowerShell()
    return
  }
  void $.audio.play({ asset: `sounds/${name}.wav` }).catch(viaPowerShell)
}

// --- Plans ----------------------------------------------------------------------------

/** Applies a plan call; returns the tool's answer text, or a refusal. */
async function applyPlan($: EngineInterface, raw: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const id = slug(str(raw.id, 60)) || slug(str(raw.title, 80)) || (raw.tasks ? 'flow' : '')
  if (!id) return { deny: 'painel_plan: the id needs a letter or a digit, like "fix-login".' }
  const at = await $.clock.now()
  const before = (await read($, plans)).find(p => p.id === id) ?? null
  const made = editPlan(raw, before, at, id)
  if (typeof made === 'string') return { deny: made }
  await update($, plans, list => [...list.filter(p => p.id !== id), made].slice(-20))
  if (made.state === 'done' && before?.state !== 'done') play($, 'done')
  if (made.state === 'error' && before?.state !== 'error') play($, 'error')
  if (made.tasks.length > 0 && made.state !== 'done') await autoOpen($, `plan:${made.id}:${made.startedAt}`)
  const { done, total, active } = progressOf(made)
  return { result: `${id}: ${done}/${total}, ${made.state}${active && made.state !== 'done' ? `, active "${active.title}"` : ''}` }
}

/** The plan the band shows: the one touched last that is open, or finished during this turn. */
function shownPlan(list: readonly Plan[], s: Stats): Plan | undefined {
  return [...list].sort((a, b) => b.touchedAt - a.touchedAt).find(p => p.state !== 'done' || (p.endedAt ?? 0) >= s.turnStartedAt)
}

async function applyStep($: EngineInterface, agentId: string | undefined, input: { done?: unknown; total?: unknown; note?: unknown }) {
  if (!agentId) return { result: 'ignored: only subagents report steps (the main session uses painel_plan)' }
  let matched = false
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined)
  await update($, agents, list =>
    list.map(a => {
      if (a.agentId !== agentId) return a
      matched = true
      const total = Math.min(100, num(input.total) ?? a.stepTotal ?? 0)
      const done = num(input.done) ?? a.stepDone ?? 0
      return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: str(input.note, 80) || undefined }
    }),
  )
  return { result: matched ? 'ok' : `ignored: no row for agent ${agentId}` }
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Plan id; reuse it for updates' },
    title: { type: 'string' },
    kind: { enum: ['plan', 'todo'] },
    stages: {
      type: 'array',
      description: 'Full breakdown: when creating, or resent under the same id when the plan changes',
      items: {
        type: 'object',
        required: ['name', 'steps'],
        properties: {
          name: { type: 'string' },
          steps: { type: 'array', items: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, status: { enum: ['pending', 'active', 'done', 'error', 'skipped'] } } } },
        },
      },
    },
    tasks: {
      type: 'array',
      description:
        'Orchestrators: the worker tasks in plan order. Each title must equal the Agent tool `description` it will be delegated with; without stages, the tasks are the steps.',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          tier: { enum: ['fable', 'heavy', 'careful', 'medium', 'light'] },
          after: { type: 'array', items: { type: 'integer' }, description: 'Numbers (from 1) of the tasks this one waits for' },
        },
      },
    },
    next: { type: 'boolean', description: 'Active step finished, start the next one' },
    done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
    active: { type: 'string', description: 'Step title now in progress' },
    failed: { type: 'string', description: 'Step title that failed' },
    state: { enum: ['running', 'needs_input', 'error', 'done'] },
    note: { type: 'string', description: 'One line for needs_input or error' },
  },
  required: ['id'],
}

async function refreshUsage($: EngineInterface) {
  const usage = await $.session.usage().catch(() => undefined)
  const total = usage?.cost?.usd ?? 0
  await update($, stats, s => ({ ...s, total, turnCost: total - s.costAtStart, context: Math.round(usage?.context.percent ?? s.context) }))
  return usage
}

async function togglePane($: EngineInterface, force?: boolean) {
  const isOpen = force ?? !(await read($, prefs)).isPaneOpen
  if (isOpen) {
    const at = await $.clock.now()
    await update($, now, () => at)
    await $.ui.open({ id: PANE, title: 'Painel' })
  } else {
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  await update($, prefs, p => ({ ...p, isPaneOpen: isOpen }))
  return isOpen
}

/** The plan's worker tasks no agent has started yet, numbered from 1 in plan order. */
function plannedLeft(plan: Plan, list: readonly AgentRun[]): (PlannedTask & { n: number })[] {
  if (plan.state === 'done') return []
  const started = new Set(list.map(a => a.description.trim().toLowerCase()))
  return plan.tasks.map((task, i) => ({ ...task, n: i + 1 })).filter(task => !started.has(task.title.trim().toLowerCase()))
}

/** The crew without a plan: one crab per agent of this turn, walking while it works. */
function crewSvg(list: readonly AgentRun[]): string {
  const shown = list.slice(-10)
  const W = Math.max(36, 36 * shown.length)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="30" viewBox="0 0 ${W} 30">${CRAB_CSS}${shown
    .map((a, i) => crab(i * 36, 0, costumeOf(a.type), a.status !== 'running', a.status === 'running', 1))
    .join('')}${shown.map((a, i) => (a.status === 'running' ? `<circle cx="${i * 36 + 32}" cy="4" r="3" fill="${colorOf(tierOf(a.type) || 'other')}"/>` : '')).join('')}</svg>`
}

/** Opens the pane once per plan (or per session of agents) by itself, the way savvy-progress did. */
async function autoOpen($: EngineInterface, key: string) {
  const p = await read($, prefs)
  if (p.autoOpenedFor === key || p.isPaneOpen) return
  await update($, prefs, prev => ({ ...prev, autoOpenedFor: key }))
  await togglePane($, true).catch(() => undefined)
}

// --- Register ----------------------------------------------------------------------------

export const register: Register = (on, options) => {
  isSoundOn = options.sounds !== false
  const wantRules = options.rules !== false
  const wantToast = options.toast !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    lang = await detectLang($, options.language)
    const none = () => undefined
    env = {
      enable1h: await $.env.get('ENABLE_PROMPT_CACHING_1H').catch(none),
      force5m: await $.env.get('FORCE_PROMPT_CACHING_5M').catch(none),
      ttlVar: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL').catch(none),
    }
    ttlSetting = await readTtlSetting($)
    account = accountOf((await $.session.usage().catch(() => undefined))?.rateLimits ?? [])
    const choice = decideTtl(options.ttl, env, ttlSetting, account)
    await update($, cache, c => (c.expiresAt === null ? { ...c, ttl: choice.ttl, ttlSource: choice.source } : c))

    await $.tool.register({
      name: 'painel_plan',
      description:
        'Live plan above the prompt (the painel), one per id. Create with title + stages (or, for an orchestrator, tasks with tiers); move it with short ops (next, done, active, failed) or state.',
      inputSchema: PLAN_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'painel_step',
      description:
        'For subagents: report progress on your own task to the painel. Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: COMMAND,
      description: 'Open or close the painel: cache per turn, costs, plans and every agent (`band` shows or hides the band)',
      argumentHint: '[band]',
    })

    // One clock for the cache countdown and the agents' times; quiet when nothing counts.
    $.clock.every(1000, async () => {
      const at = await $.clock.now()
      const c = await read($, cache)
      const left = secondsLeft(c, at)
      const running = (await read($, agents)).some(a => a.status === 'running')
      const isOpen = (await read($, prefs)).isPaneOpen
      if ((left !== null && left > 0) || running || isOpen) await update($, now, () => at)
      if (left === null || isBusy || !wantToast || !c.last || promptTokens(c.last) < TOAST_MIN_TOKENS || c.expiresAt === null) return
      if (toastedFor !== c.expiresAt) {
        toastedFor = c.expiresAt
        toastedLevel = cacheLevel(left, c.ttl) === 'ok' || cacheLevel(left, c.ttl) === 'warn' ? 'ok' : cacheLevel(left, c.ttl)
      }
      const level = cacheLevel(left, c.ttl)
      if (level === 'alert' && toastedLevel === 'ok') {
        toastedLevel = 'alert'
        $.ui.toast(`⏳ ${tr().soon(fmtClock(left))}`, { timeoutMs: 20_000 })
      } else if (level === 'expired' && toastedLevel !== 'expired') {
        toastedLevel = 'expired'
        $.ui.toast(`⌛ ${tr().lapsed(fmtTokens(promptTokens(c.last)))}`, { timeoutMs: 20_000 })
      }
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    // /clear starts a new conversation in the same process: a new cache, a new count.
    if (e.reason === 'clear') {
      prevSample = undefined
      observed = undefined
      const choice = decideTtl(options.ttl, env, ttlSetting, account)
      await update($, cache, () => ({ ttl: choice.ttl, ttlSource: choice.source, expiresAt: null, last: null, turns: [] }))
      await update($, stats, s => ({ ...s, turn: 0, speed: null, turnCost: null }))
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!wantRules) return result
    return { sections: [...result.sections, { id: 'painel:rules', text: RULES, scope: 'session' as const }] }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isBusy = true
    const at = await $.clock.now()
    const total = (await $.session.usage().catch(() => undefined))?.cost?.usd ?? 0
    const s = await update($, stats, s => ({ ...s, turn: s.turn + 1, costAtStart: total, total, turnStartedAt: at }))
    // This turn's band lists the agents still at work; finished ones stay in the pane.
    await update($, agents, list => list.map(a => (a.status === 'running' ? { ...a, turn: s?.turn ?? a.turn } : a)))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const stream = next(e)
    let firstAt: number | null = null
    let step = await stream.next()
    while (!step.done) {
      if (firstAt === null) firstAt = await $.clock.now()
      yield step.value
      step = await stream.next()
    }
    const result = step.value
    const usage = result.usage
    if (!usage) return result
    const model = usage.model || e.model

    if (e.agentId !== undefined) {
      // A subagent's request: its context, tokens and estimated cost.
      const agentId = e.agentId
      await update($, agents, list =>
        list.map((a): AgentRun =>
          a.agentId !== agentId
            ? a
            : {
                ...a,
                model,
                effort: typeof e.effort === 'string' ? e.effort : a.effort,
                contextTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens,
                contextMax: windowOf(model),
                tokens: a.tokens + usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
                costUsd: a.costUsd + costOf(model, usage),
                requests: a.requests + 1,
              },
        ),
      )
      return result
    }

    // The main loop: output speed (from the first streamed item, so time-to-first-token is left out) and the cache.
    const seconds = firstAt === null ? 0 : ((await $.clock.now()) - firstAt) / 1000
    const speed = usage.output_tokens / seconds
    if (usage.output_tokens >= MIN_TOKENS && seconds >= MIN_SECONDS && speed <= 1000) {
      await update($, stats, s => ({ ...s, speed: Math.round(speed) }))
    }
    const sample: Sample = { model, startedAt, read: usage.cache_read_input_tokens, write: usage.cache_creation_input_tokens, fresh: usage.input_tokens }
    const fresh = await refreshUsage($)
    if (options.ttl !== '5m' && options.ttl !== '1h') account = accountOf(fresh?.rateLimits ?? [])
    observed = observeTtl(prevSample, sample, observed)
    prevSample = sample
    const base = decideTtl(options.ttl, env, ttlSetting, account)
    const ttl = observed ?? base.ttl
    const source = observed && observed !== base.ttl ? `observed; ${base.source} said ${base.ttl}` : observed ? `observed, ${base.source}` : base.source
    const turn = (await read($, stats)).turn
    await update($, cache, c => ({
      ttl,
      ttlSource: source,
      expiresAt: sample.read + sample.write > 0 ? startedAt + ttlMs(ttl) : c.expiresAt,
      last: { model, read: sample.read, write: sample.write, fresh: sample.fresh },
      turns: addToTurns(c.turns, turn, { ...sample, output: usage.output_tokens }),
    }))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      isBusy = false
      await refreshUsage($)
      return result
    }
    const agentId = e.agentId
    await update($, agents, list =>
      list.map((a): AgentRun => {
        if (a.agentId !== agentId) return a
        // A run whose requests went unseen still gets the turn's own sum.
        const fallback = a.requests === 0 && e.usage ? e.usage : null
        return {
          ...a,
          status: e.reason === 'answer' ? 'done' : 'failed',
          endedAt: at,
          ...(fallback
            ? {
                model: fallback.model || a.model,
                tokens: fallback.input_tokens + fallback.output_tokens + fallback.cache_read_input_tokens + fallback.cache_creation_input_tokens,
                costUsd: costOf(fallback.model || a.model, fallback),
              }
            : {}),
        }
      }),
    )
    await refreshUsage($)
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const isUnbriefed = isSavvy(e.subagentType) && !e.prompt.includes(STEP_TOOL) && !e.prompt.includes(OLD_STEP)
    const started = await next(isUnbriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    const turn = (await read($, stats)).turn
    const run: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      type: e.subagentType,
      description: str(e.description, 120),
      model: started.model,
      status: 'running',
      startedAt: at,
      turn,
      contextTokens: 0,
      contextMax: windowOf(started.model),
      tokens: 0,
      costUsd: 0,
      requests: 0,
    }
    await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-200))
    await update($, now, () => at)
    if (isSavvy(e.subagentType)) {
      const p = shownPlan(await read($, plans), await read($, stats))
      await autoOpen($, p && p.tasks.length ? `plan:${p.id}:${p.startedAt}` : `turn:${turn}`)
    }
    return started
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => applyPlan($, e as unknown as Record<string, unknown>))

  on('tool.call', { tool: STEP_TOOL }, async ($, e) => applyStep($, e.agentId, e as unknown as Record<string, unknown>))

  // The originals, while still installed: their own mod answers, and the painel shows the same plan.
  on('tool.call', { tool: OLD_PLAN }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await applyPlan($, e as unknown as Record<string, unknown>).catch(() => undefined)
    return ran
  })
  on('tool.call', { tool: OLD_FLOW }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && !e.agentId) {
      const prev = (await read($, plans)).find(p => p.id === 'flow') ?? null
      await applyPlan($, { id: 'flow', ...fromSavvyProgress(e as unknown as Record<string, unknown>, prev) }).catch(() => undefined)
    }
    return ran
  })
  on('tool.call', { tool: OLD_STEP }, async ($, e, next) => {
    const ran = await next(e)
    await applyStep($, e.agentId, e as unknown as Record<string, unknown>).catch(() => undefined)
    return ran
  })

  // A question to the person: the open plan waits (amber) and a soft sound says so.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const s = await read($, stats)
    const live = shownPlan(await read($, plans), s)
    const isLive = live !== undefined && live.state === 'running'
    if (isLive) await update($, plans, list => list.map(p => (p.id === live.id ? { ...p, state: 'needs_input' as const } : p)))
    play($, 'decision')
    const ran = await next(e)
    if (isLive) await update($, plans, list => list.map(p => (p.id === live.id && p.state === 'needs_input' ? { ...p, state: 'running' as const } : p)))
    return ran
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'band') {
      const p = await update($, prefs, p => ({ ...p, isHidden: !p.isHidden }))
      return { text: p?.isHidden ? tr().hidden : tr().shown }
    }
    return { text: (await togglePane($)) ? tr().opened : tr().closed }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, prefs, p => ({ ...p, isPaneOpen: false }))
    return next(e)
  })

  // --- The band ----------------------------------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, stats)
    const pref = await read($, prefs)
    if (e.props.hasSurvey || pref.isHidden || s.turn === 0) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const c = await read($, cache)
    await read($, now)
    const at = await $.clock.now()
    const allPlans = await read($, plans)
    const allAgents = await read($, agents)
    const cols = e.props.bodyColumns || 100
    const tier = tierFor(cols)
    const t = tr()

    const left = secondsLeft(c, at)
    const level = left === null ? null : cacheLevel(left, c.ttl)
    const frame = e.props.isWorking ? null : level === 'alert' || level === 'expired' ? ALERT : level === 'warn' ? WARN : null
    const cacheColor = frame ?? CACHE
    const hit = c.last ? `${Math.round(hitRatio(c.last) * 100)}%` : '—'
    const clock = e.props.isWorking ? '…' : left === null ? '—' : left === 0 ? t.expired : fmtClock(left)
    const life = left === null ? 0 : left / (ttlMs(c.ttl) / 1000)

    const plan = shownPlan(allPlans, s)
    const running = allAgents.filter(a => a.status === 'running')
    const visible = allAgents.filter(a => a.status === 'running' || a.turn === s.turn)
    const crew = visible.length + (plan ? plannedLeft(plan, allAgents).length : 0)
    const crewButton = crew > 0 ? <Button key="painel-crew" label={`×${crew}`} plain onPress={() => void togglePane($)} /> : null

    const isDesktop = e.surface !== 'terminal' && 'Svg' in ui
    const Svg = isDesktop && 'Svg' in ui ? ui.Svg : null
    const icon = tier >= 3 ? 18 : 22
    const ico = (key: string, source: string, alt: string, fallback: string, color: string) =>
      Svg ? <Svg key={key} source={source} alt={alt} width={icon} height={icon} /> : <Text key={key} color={color}>{fallback}</Text>
    const item = (key: string, children: RenderChildren) => (
      <Box key={key} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
        {children}
      </Box>
    )

    const top = (
      <Box key="top" flexDirection="row" alignItems="center" columnGap={tier >= 3 ? 1 : 2} flexWrap="nowrap" overflow="hidden">
        {tier <= 3 ? item('turn', [ico('i', TURN_ICON, 'turn', '#', MUTED_TEXT), ...(tier === 0 ? [<Text key="l" dimColor>{t.turn}</Text>] : []), <Text key="v" bold>{String(s.turn)}</Text>]) : null}
        {tier <= 2 ? item('speed', [ico('i', SPEED_ICON, 'speed', '⚡', SPEED), <Text key="v" bold>{s.speed === null ? '—' : `${s.speed} tok/s`}</Text>]) : null}
        {item('cost', [
          ico('i', MONEY_ICON, 'cost', '$', MONEY),
          <Text key="t" bold color={MONEY}>{s.turnCost === null ? '—' : usd(s.turnCost)}</Text>,
          ...(tier <= 1 ? [<Text key="s" dimColor>|</Text>, <Text key="v" bold>{usd(s.total)}</Text>] : []),
        ])}
        {item('cache', [
          ico('i', cacheIcon(cacheColor, life), 'cache', '⧗', cacheColor),
          ...(tier <= 2 ? [<Text key="h" dimColor>{`${t.cache} ${hit}`}</Text>] : []),
          <Text key="v" bold color={frame ?? undefined}>{clock}</Text>,
        ])}
        <Box key="gap" flexGrow={1} flexShrink={1} />
        {item('ctx', [
          ...(Svg ? [<Svg key="i" source={contextIcon(s.context)} alt="context" width={icon} height={icon} />] : [<Text key="i" color={CONTEXT}>{t.context}</Text>]),
          ...(Svg && tier === 0 ? [<Svg key="b" source={contextBar(s.context)} alt={`context ${s.context}%`} width={80} height={6} />] : []),
          <Text key="v" bold>{`${s.context}%`}</Text>,
        ])}
        <Button key="painel-open" label="▤" plain dimColor onPress={() => void togglePane($)} />
        <Button key="painel-hide" label="×" role="dismiss" plain dimColor onPress={() => update($, prefs, p => ({ ...p, isHidden: true }))} />
      </Box>
    )

    const rows: RenderChildren[] = []
    if (plan) {
      const { done, total, ratio, active } = progressOf(plan)
      const label =
        plan.state === 'done' ? t.doneWord : plan.state === 'needs_input' ? t.waiting : `${plan.tasks.length ? t.tasks : t.steps} ${done}/${total}`
      if (Svg) {
        // As savvy-progress drew it: one drawing for title, pill bar, percent and crab; the crew count opens the pane.
        const W = Math.max(180, Math.min(1600, cols * 8 - 70))
        const activeTitle = plan.state === 'done' ? '' : (plan.note && plan.state !== 'running' ? plan.note : active?.title) ?? ''
        rows.push(
          <Box key="plan" flexDirection="row" alignItems="center" gap={1}>
            <Svg
              source={planRowSvg({ ...plan, title: activeTitle ? `${plan.title} · ${activeTitle}` : plan.title }, W, label, done, total, running.length, running.length > 0 || !!e.props.isWorking)}
              alt={`${plan.title}: ${label}, ${Math.round(ratio * 100)}%`}
              width={W}
              height={BAND_H}
            />
            {crewButton}
            <Button key="painel-plan-x" label="✕" plain role="dismiss" onPress={() => update($, plans, list => list.map(p => (p.id === plan.id ? { ...p, state: 'done' as const, endedAt: 0 } : p)))} />
          </Box>,
        )
      } else {
        const color = plan.state === 'done' ? DONE : plan.state === 'error' ? ALERT : plan.state === 'needs_input' ? WARN : ACCENT
        const glyph = plan.state === 'done' ? '✓' : plan.state === 'error' ? '✗' : plan.state === 'needs_input' ? '?' : '●'
        const activeText = plan.state === 'done' ? '' : (plan.note && plan.state !== 'running' ? plan.note : active?.title) ?? ''
        const room = cols - label.length - 12
        const barW = Math.max(0, Math.min(24, Math.floor(room / 3)))
        const textW = Math.max(8, room - barW - 2)
        rows.push(
          <Box key="plan" flexDirection="row" columnGap={1} flexWrap="nowrap" overflow="hidden">
            <Text color={color}>{glyph}</Text>
            <Text wrap="truncate-end">{fit(activeText ? `${plan.title} · ${activeText}` : plan.title, textW)}</Text>
            {barW >= 6 ? <Text color={color}>{bar(ratio, barW)}</Text> : null}
            <Text bold>{label}</Text>
            <Text dimColor>{`${Math.round(ratio * 100)}%`}</Text>
            {crewButton}
          </Box>,
        )
      }
    } else if (crewButton && Svg) {
      rows.push(
        <Box key="crew" flexDirection="row" alignItems="center" gap={1}>
          <Svg source={crewSvg(visible)} alt={`${visible.length} agents`} width={Math.min(36 * visible.length, 360)} height={30} />
          {crewButton}
        </Box>,
      )
    }

    // The terminal lists the agents in the band; the desktop has them in the pane beside it.
    if (!Svg) {
      const room = Math.max(1, (e.props.maxRows || 8) - 1 - rows.length - (frame ? 2 : 0))
      const shown = visible.length > room ? visible.slice(-(room - 1)) : visible
      for (const a of shown) {
        const color = a.status === 'done' ? DONE : a.status === 'failed' ? ALERT : colorOf(tierOf(a.type) || 'other')
        const glyph = a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '●'
        const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}` : a.requests ? `${a.requests} ${t.reqs}` : ''
        const tail = [steps, usd(a.costUsd)].filter(Boolean).join(' · ')
        const word = tierWord(a.type)
        const taskW = Math.max(6, cols - word.length - tail.length - 8)
        rows.push(
          <Box key={`a:${a.id}`} flexDirection="row" columnGap={1} flexWrap="nowrap" overflow="hidden">
            <Text color={color}>{` ${glyph}`}</Text>
            <Text color={color} bold>{word}</Text>
            <Text wrap="truncate-end" dimColor={a.status !== 'running'}>{fit(a.description || a.type, taskW)}</Text>
            <Text dimColor>{tail}</Text>
          </Box>,
        )
      }
      if (shown.length < visible.length) rows.push(<Text key="more" dimColor>{`  +${visible.length - shown.length}`}</Text>)
    }

    return (
      <Box flexDirection="column" paddingX={1} rowGap={Svg ? 1 : 0} {...(frame ? { borderStyle: 'round', borderColor: frame } : {})}>
        {top}
        {rows}
      </Box>
    )
  })

  // --- The pane (/painel) ----------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const t = tr()
    const s = await read($, stats)
    const c = await read($, cache)
    const pref = await read($, prefs)
    await read($, now)
    const at = await $.clock.now()
    const allPlans = [...(await read($, plans))].sort((a, b) => b.touchedAt - a.touchedAt)
    const allAgents = await read($, agents)
    const plan = shownPlan(allPlans, s) ?? allPlans[0]
    const runningList = allAgents.filter(a => a.status === 'running').reverse()
    const finishedList = allAgents.filter(a => a.status !== 'running').reverse()
    const planned = plan ? plannedLeft(plan, allAgents) : []
    const agentCost = allAgents.reduce((n, a) => n + a.costUsd, 0)
    const agentTokens = allAgents.reduce((n, a) => n + a.tokens, 0)
    const start = allAgents.length ? Math.min(...allAgents.map(a => a.startedAt)) : at
    const end = allAgents.length ? Math.max(...allAgents.map(a => a.endedAt ?? Math.max(at, a.startedAt))) : at
    const left = secondsLeft(c, at)
    const level = left === null ? null : cacheLevel(left, c.ttl)
    const clockColor = level === 'alert' || level === 'expired' ? ALERT : level === 'warn' ? WARN : CACHE
    const words = {
      tier: (type: string) => tierWord(type),
      model: '',
      ctx: t.context,
      failed: t.failed,
      after: t.after,
    }
    const runWords = (a: AgentRun) => ({ ...words, model: `${modelName(a.model)}${a.effort ? ` · ${a.effort}` : ''}` })
    const tierModel = (tier: string) => TIER_MODEL[tier] ?? ''
    const isCompact = pref.isCompact === true
    const isDoneCollapsed = pref.isDoneCollapsed === true

    const toggleCompact = (
      <Button key="compact" label={isCompact ? t.expand : t.collapse} plain onPress={() => update($, prefs, p => ({ ...p, isCompact: !p.isCompact }))} />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${isDoneCollapsed ? '▸' : '▾'} ${t.finished} · ${finishedList.length}`}
        plain
        onPress={() => update($, prefs, p => ({ ...p, isDoneCollapsed: !p.isDoneCollapsed }))}
      />
    )

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )
      const sessionTiles = tilesSvg(W, '', [
        { label: t.turn, value: String(s.turn) },
        { label: t.speed, value: s.speed === null ? '—' : `${s.speed} tok/s` },
        { label: t.sessionCost, value: usd(s.total) },
        { label: t.context, value: `${s.context}%` },
      ])
      const cacheTiles = tilesSvg(W, `${t.cacheH} · ${c.ttl}`, [
        { label: t.left, value: left === null ? '—' : left === 0 ? t.expired : fmtClock(left), color: left === null ? undefined : clockColor },
        { label: t.lastHit, value: c.last ? `${Math.round(hitRatio(c.last) * 100)}%` : '—' },
        { label: `${t.read} · ${t.wrote}`, value: c.last ? `${fmtTokens(c.last.read)} · ${fmtTokens(c.last.write)}` : '—' },
      ])
      const table = cacheTableSvg(W, c.turns.slice(-12), {
        turn: t.turnCol,
        reqs: t.reqs,
        read: t.read,
        wrote: t.wrote,
        fresh: t.fresh,
        hit: t.hit,
        none: t.noRequests,
      })
      const others = allPlans.filter(p => p !== plan).slice(0, 3)
      return (
        <Box flexDirection="column" rowGap={1}>
          <Svg key="agents-head" source={tilesSvg(W, plan?.title ?? t.agentsH, [
            { label: t.cost, value: `≈${usd(agentCost)}` },
            { label: t.tokens, value: fmtTokens(agentTokens) },
            { label: t.time, value: fmtClock((end - start) / 1000) },
          ])} alt={`${plan?.title ?? t.agentsH}: ≈${usd(agentCost)}, ${fmtTokens(agentTokens)} tokens`} width={W} height={tilesHeight(plan?.title ?? t.agentsH)} />
          {plan ? (() => {
            const { done, total } = progressOf(plan)
            const drawn = planSvg(W, plan, done, total, isCompact ? [] : stepsOf(plan))
            return <Svg key="plan" source={drawn.source} alt={`${plan.title}: ${done}/${total}`} width={W} height={drawn.height} />
          })() : null}
          {toggleCompact}
          {allAgents.length === 0 && planned.length === 0 ? <Text key="empty" dimColor>{t.noAgents}</Text> : null}
          {runningList.length > 0 ? section('h-run', `${t.running} · ${runningList.length}`) : null}
          {runningList.map(a => (
            <Svg key={a.id} source={agentSvg(W, a, at, runWords(a))} alt={`${a.description}: ${modelName(a.model)}`} width={W} height={AGENT_H} />
          ))}
          {finishedList.length > 0 ? toggleDone : null}
          {isDoneCollapsed
            ? null
            : finishedList.map(a => (
                <Svg key={a.id} source={agentSvg(W, a, at, runWords(a))} alt={`${a.description}: ${a.status}`} width={W} height={AGENT_H} />
              ))}
          {planned.length > 0 ? section('h-plan', `${t.plannedH} · ${planned.length}`) : null}
          {planned.map(p => (
            <Svg key={`plan-${p.n}`} source={plannedSvg(W, p.n, p, { ...words, model: tierModel(p.tier) })} alt={`${p.n}. ${p.title}`} width={W} height={PLANNED_H} />
          ))}
          {others.map(p => {
            const { done, total } = progressOf(p)
            const drawn = planSvg(W, p, done, total, [])
            return <Svg key={`other-${p.id}`} source={drawn.source} alt={`${p.title}: ${done}/${total}`} width={W} height={drawn.height} />
          })}
          <Svg key="session" source={sessionTiles} alt={`${t.session}: ${s.turn} ${t.turns}, ${usd(s.total)}`} width={W} height={tilesHeight('')} />
          <Svg key="cache-tiles" source={cacheTiles} alt={t.cacheH} width={W} height={tilesHeight('x')} />
          <Svg key="cache-table" source={table.source} alt={t.perTurn} width={W} height={table.height} />
          <Text key="estimate" dimColor>
            {t.estimate}
          </Text>
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const width = Math.max(30, e.props.bodyColumns - 1)
    const head = (key: string, text: string) => (
      <Text key={key} bold color="cyan">
        {text}
      </Text>
    )
    const cell = (key: string, w: number, text: string, color?: string, bold = false) => (
      <Box key={key} width={w} flexShrink={0} justifyContent="flex-end">
        <Text color={color} bold={bold} dimColor={!color}>
          {text}
        </Text>
      </Box>
    )
    const hitColor = (pct: number) => (pct >= 80 ? 'green' : pct >= 40 ? 'yellow' : 'red')
    const turnRows = c.turns.slice(-Math.max(3, (e.viewport?.rows ?? 30) - 24))
    const agentLine = (a: AgentRun) => {
      const color = a.status === 'done' ? DONE : a.status === 'failed' ? ALERT : colorOf(tierOf(a.type) || 'other')
      const glyph = a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '●'
      const ctx = a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ` ${a.stepNote}` : ''}` : `${a.requests} ${t.reqs}`
      const time = fmtClock(((a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt) / 1000)
      return (
        <Box key={`g:${a.id}`} flexDirection="column">
          <Text color={color} bold>
            {fit(`${glyph} ${tierWord(a.type)} · ${a.description || a.type}`, width)}
          </Text>
          <Text dimColor>{fit(`   ${modelName(a.model)}${a.effort ? ` · ${a.effort}` : ''} · ${steps} · ${t.context} ${ctx}% · ${fmtTokens(a.tokens)} tok · ≈${usd(a.costUsd)} · ${time}`, width)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {head('h-agents', `◆ ${plan?.title ?? t.agentsH} · ≈${usd(agentCost)} · ${fmtTokens(agentTokens)} tok · ${fmtClock((end - start) / 1000)}`)}
        {plan ? (
          <Box key="plan" flexDirection="column">
            <Text bold>{fit(`${plan.title} · ${progressOf(plan).done}/${progressOf(plan).total}${plan.note ? ` · ${plan.note}` : ''}`, width)}</Text>
            {stepsOf(plan).map((st, i) => (
              <Text key={`s:${i}`} color={st.status === 'active' ? ACCENT : st.status === 'error' ? ALERT : isFinished(st.status) ? DONE : undefined} dimColor={st.status === 'pending'}>
                {fit(`  ${isFinished(st.status) ? '✓' : st.status === 'active' ? '▸' : st.status === 'error' ? '✗' : '·'} ${st.title}`, width)}
              </Text>
            ))}
          </Box>
        ) : null}
        {allAgents.length === 0 && planned.length === 0 ? <Text key="empty" dimColor>{t.noAgents}</Text> : null}
        {runningList.length > 0 ? <Text key="h-run" dimColor>{`${t.running} · ${runningList.length}`}</Text> : null}
        {runningList.map(agentLine)}
        {finishedList.length > 0 ? toggleDone : null}
        {isDoneCollapsed ? null : finishedList.map(agentLine)}
        {planned.length > 0 ? <Text key="h-plan" dimColor>{`${t.plannedH} · ${planned.length}`}</Text> : null}
        {planned.map(p => (
          <Text key={`q:${p.n}`} dimColor>
            {fit(`  ◷ ${p.n}. ${p.title} · ${tierWord(`savvy-${p.tier}`)}${p.after.length ? ` · ${t.after} ${p.after.join(', ')}` : ''}`, width)}
          </Text>
        ))}

        <Box key="cache" flexDirection="column" marginTop={1}>
          {head('h-cache', `⧗ ${t.cacheH}`)}
          <Text key="ttl" dimColor>
            {fit(`${c.ttl} ${t.lifetime} (${c.ttlSource})`, width)}
          </Text>
          <Text key="clock" bold color={clockColor}>
            {left === null ? '⏱ --:--' : left === 0 ? `⏱ 0:00 · ${t.expired}` : `⏱ ${fmtClock(left)}  ${bar(left / (ttlMs(c.ttl) / 1000), Math.min(30, width - 12))}`}
          </Text>
          {c.last ? (
            <Text key="last">
              {fit(`${modelName(c.last.model)} · ${Math.round(hitRatio(c.last) * 100)}% ${t.hit} · ${t.read} ${fmtTokens(c.last.read)} · ${t.wrote} ${fmtTokens(c.last.write)} · ${t.fresh} ${fmtTokens(c.last.fresh)}`, width)}
            </Text>
          ) : null}
          <Box key="thead" flexDirection="row" columnGap={1} marginTop={1}>
            {cell('h:turn', 5, '#', 'cyan', true)}
            {cell('h:req', 4, t.reqs, 'cyan', true)}
            {cell('h:read', 7, t.read, 'green', true)}
            {cell('h:wrote', 8, t.wrote, 'yellow', true)}
            {cell('h:new', 6, t.fresh, 'cyan', true)}
            {cell('h:hit', 7, t.hit, 'magenta', true)}
          </Box>
          {turnRows.length === 0 ? (
            <Text key="none" dimColor>
              {t.noRequests}
            </Text>
          ) : null}
          {turnRows.map(row => {
            const pct = Math.round(hitRatio(row) * 100)
            return (
              <Box key={`t:${row.turn}`} flexDirection="row" columnGap={1}>
                {cell(`c:turn:${row.turn}`, 5, String(row.turn))}
                {cell(`c:req:${row.turn}`, 4, String(row.requests))}
                {cell(`c:read:${row.turn}`, 7, fmtTokens(row.read), 'green')}
                {cell(`c:wrote:${row.turn}`, 8, fmtTokens(row.write), 'yellow')}
                {cell(`c:new:${row.turn}`, 6, fmtTokens(row.fresh), 'cyan')}
                {cell(`c:hit:${row.turn}`, 7, `${pct}%`, hitColor(pct), true)}
              </Box>
            )
          })}
        </Box>
        <Text key="session" dimColor>
          {fit(`${t.session}: ${s.turn} ${t.turns} · ${s.speed === null ? '—' : `${s.speed} tok/s`} · ${t.turnCost} ${s.turnCost === null ? '—' : usd(s.turnCost)} · ${t.sessionCost} ${usd(s.total)} · ${t.context} ${s.context}%`, width)}
        </Text>
        <Box key="foot" marginTop={1}>
          <Button key="painel-close" label={t.close} onPress={() => void togglePane($, false)} />
        </Box>
      </Box>
    )
  })
}
