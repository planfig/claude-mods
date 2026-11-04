// What the painel keeps in $.state for the session. Pure shapes; the logic is in hooks/model.ts.

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanStep = { title: string; status: StepStatus; doneAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'

/** A worker task the orchestrator planned; matched to a run by the Agent `description`. */
export type PlannedTask = { title: string; tier: string; after: number[] }

export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  tasks: PlannedTask[]
  startedAt: number
  endedAt: number | null
  /** Last change: the band shows the plan touched most recently. */
  touchedAt: number
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  /** The main-session turn it started in: the band lists only this turn's finished agents. */
  turn: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  requests: number
  /** Self-reported by the worker through the step tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type Stats = {
  turn: number
  /** Output speed of the last main-loop response, tok/s. */
  speed: number | null
  turnCost: number | null
  total: number
  context: number
  costAtStart: number
  /** When the current main-session turn began: a plan finished since then still shows. */
  turnStartedAt: number
}

export type CacheTurn = { turn: number; requests: number; read: number; write: number; fresh: number; output: number }

export type CacheView = {
  ttl: '5m' | '1h'
  ttlSource: string
  /** When the last cache entry lapses, ms since the epoch; null before any cached request. */
  expiresAt: number | null
  last: { model: string; read: number; write: number; fresh: number } | null
  turns: CacheTurn[]
}

export type Prefs = {
  isHidden: boolean
  isPaneOpen: boolean
  /** The pane folded to its header and plan, without the agent rows. */
  isCompact?: boolean
  isDoneCollapsed?: boolean
  /** The plan (or agent run) the pane last opened itself for. */
  autoOpenedFor?: string
}

declare module 'claude-code' {
  interface PluginState {
    'planfig-mods': {
      stats: Shaped<Stats>
      cache: Shaped<CacheView>
      plans: Shaped<Plan[]>
      agents: Shaped<AgentRun[]>
      prefs: Prefs
      /** The clock, bumped each second while a countdown or an agent runs. */
      now: number
    }
  }
}
