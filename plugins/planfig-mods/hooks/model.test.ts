import { expect, test } from 'claude-code/testing'

import { accountOf, addToTurns, cacheLevel, costOf, decideTtl, editPlan, fromSavvyProgress, observeTtl, progressOf, tierFor, tierOf } from './model.ts'
import type { Plan } from '../types'

const S = (name: string, ...titles: string[]) => ({ name, steps: titles.map(title => ({ title })) })
const statuses = (p: Plan | string) => (typeof p === 'string' ? p : p.stages.flatMap(s => s.steps.map(st => `${st.title}:${st.status}`)).join(' '))
const make = (input: Record<string, unknown>, prev: Plan | null = null, at = 1000) => editPlan(input, prev, at, 'x')

test('the cache TTL follows Claude Code’s order, then the account', () => {
  expect(decideTtl('auto', {}, undefined, 'subscription')).toEqual({ ttl: '1h', source: 'subscription default' })
  expect(decideTtl('auto', {}, undefined, 'other').ttl).toBe('5m')
  expect(decideTtl('auto', { force5m: '1', enable1h: '1' }, '1h', 'subscription').ttl).toBe('5m')
  expect(decideTtl('auto', { ttlVar: '1h' }, '5m', 'other').ttl).toBe('1h')
  expect(decideTtl('5m', { enable1h: '1' }, undefined, 'subscription').ttl).toBe('5m')
  expect(accountOf([{ kind: 'five_hour', percentUsed: 40 }])).toBe('subscription')
  expect(accountOf([{ kind: 'five_hour', percentUsed: 100 }])).toBe('credits')
  expect(accountOf([])).toBe('other')
})

test('a hit after more than five minutes proves the one-hour cache', () => {
  const prev = { model: 'm', startedAt: 0, read: 50_000, write: 1000, fresh: 10 }
  expect(observeTtl(prev, { model: 'm', startedAt: 20 * 60_000, read: 50_000, write: 500, fresh: 10 }, undefined)).toBe('1h')
  expect(observeTtl(prev, { model: 'm', startedAt: 20 * 60_000, read: 0, write: 51_000, fresh: 10 }, undefined)).toBe('5m')
  expect(observeTtl(prev, { model: 'm', startedAt: 20 * 60_000, read: 0, write: 51_000, fresh: 10 }, '1h')).toBe('1h')
  expect(observeTtl(prev, { model: 'm', startedAt: 60_000, read: 0, write: 51_000, fresh: 10 }, undefined)).toBe(undefined)
})

test('the countdown turns amber at a third and red at a sixth of the lifetime', () => {
  expect(cacheLevel(30 * 60, '1h')).toBe('ok')
  expect(cacheLevel(20 * 60, '1h')).toBe('warn')
  expect(cacheLevel(10 * 60, '1h')).toBe('alert')
  expect(cacheLevel(0, '1h')).toBe('expired')
  expect(cacheLevel(90, '5m')).toBe('warn')
})

test('requests add up per turn', () => {
  const s = { model: 'm', startedAt: 0, read: 10, write: 2, fresh: 1, output: 5 }
  const rows = addToTurns(addToTurns(addToTurns([], 1, s), 1, s), 2, s)
  expect(rows).toEqual([
    { turn: 1, requests: 2, read: 20, write: 4, fresh: 2, output: 10 },
    { turn: 2, requests: 1, read: 10, write: 2, fresh: 1, output: 5 },
  ])
})

test('prices and tiers', () => {
  const u = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(costOf('claude-opus-5-5', u)).toBe(4)
  expect(costOf('claude-haiku-5-5', u)).toBe(0.5)
  expect(tierOf('planfig-mods:savvy-careful')).toBe('careful')
  expect(tierOf('savvy-nope')).toBe('')
  expect(tierOf('Explore')).toBe('')
  expect(tierFor(120)).toBe(0)
  expect(tierFor(30)).toBe(4)
})

test('plan ops: create, next, done, active, failed', () => {
  const a = make({ title: 'Task', stages: [S('One', 'A', 'B'), S('Two', 'C')] })
  expect(statuses(a)).toBe('A:active B:pending C:pending')
  const b = make({ next: true }, a as Plan)
  expect(statuses(b)).toBe('A:done B:active C:pending')
  const c = make({ done: ['B'] }, b as Plan)
  expect(statuses(c)).toBe('A:done B:done C:active')
  const d = make({ failed: 'C', note: 'tests red' }, c as Plan)
  expect(typeof d !== 'string' && d.state).toBe('error')
  const e = make({ active: 'C' }, d as Plan)
  expect(statuses(e)).toBe('A:done B:done C:active')
  const f = make({ next: true }, e as Plan)
  expect(typeof f !== 'string' && f.state).toBe('done')
  expect(progressOf(f as Plan)).toMatchObject({ done: 3, total: 3, ratio: 1 })
})

test('a step the plan does not have is refused with its steps', () => {
  const a = make({ title: 'Task', stages: [S('One', 'A', 'B')] }) as Plan
  expect(make({ done: ['Z'] }, a)).toBe('painel_plan: "x" has no step "Z". Its steps: A, B')
  expect(make({ next: true }, null)).toBe('painel_plan: no plan "x" yet; create it with title and stages.')
})

test('a resent plan keeps its finished steps; a finished plan under a new title starts over', () => {
  const a = make({ next: true }, make({ title: 'Task', stages: [S('One', 'A', 'B')] }) as Plan) as Plan
  const grown = make({ title: 'Task', stages: [S('One', 'A', 'B', 'D')] }, a)
  expect(statuses(grown)).toBe('A:done B:active D:pending')
  const done = make({ state: 'done' }, a) as Plan
  const other = make({ title: 'Another', stages: [S('One', 'A')] }, done)
  expect(statuses(other)).toBe('A:active')
})

test('worker tasks make the steps, and the old savvy-progress call maps onto them', () => {
  const tasks = [{ title: 'Write parser', tier: 'careful' }, { title: 'Wire CLI', tier: 'savvy-light', after: [1] }]
  const a = make({ title: 'Ship', tasks }) as Plan
  expect(statuses(a)).toBe('Write parser:active Wire CLI:pending')
  expect(a.tasks).toEqual([
    { title: 'Write parser', tier: 'careful', after: [] },
    { title: 'Wire CLI', tier: 'light', after: [1] },
  ])
  const b = make(fromSavvyProgress({ done: 1 }, a), a)
  expect(statuses(b)).toBe('Write parser:done Wire CLI:active')
  const c = make(fromSavvyProgress({ finished: true }, b as Plan), b as Plan)
  expect(typeof c !== 'string' && c.state).toBe('done')
  const blank = make(fromSavvyProgress({ title: 'Flow', total: 3, done: 1 }, null))
  expect(statuses(blank)).toBe('Task 1:done Task 2:active Task 3:pending')
})

test('odd input cannot break the plan', () => {
  const a = make({ title: '\u001b[31mred', stages: [{ name: 5, steps: [{ title: '' }, null, 'x'] }], tasks: [{ title: 'T', tier: '__proto__' }] })
  expect(typeof a !== 'string' && a.title).toBe('[31mred')
  expect(statuses(a)).toBe('Step:active')
  expect(typeof a !== 'string' && a.tasks[0]?.tier).toBe('')
})
