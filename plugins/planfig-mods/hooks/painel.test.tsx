import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const P = 'planfig-mods'
const PLAN = 'mcp__planfig-mods__painel_plan'
const STEP = 'mcp__planfig-mods__painel_step'
const T0 = Date.parse('2026-11-02T12:00:00Z')

const band = (bodyColumns = 120) => ({ component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} } as never })
const pane = { component: 'Pane' as const, requestId: 'painel', props: { title: 'Painel', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never }

// What the engine answers beneath the plugin; the read count of the next request is set per test.
let nextRead = 90_000
const prompts: string[] = []

async function session($: Engine, on: On) {
  nextRead = 90_000
  prompts.length = 0
  on('tool.register', () => ({ value: {} }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('agent.spawn', (_, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: `a${prompts.length}` } as never
  })
  // Stands for the engine's own drawing where the painel draws nothing.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: 0,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: nextRead, cache_creation_input_tokens: 9000 },
    } as never
  })
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { LANG: 'en_US.UTF-8', HOME: '/home/u' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.usage', async () => ({ value: { startedAt: T0, context: { percent: 34 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }], cost: { usd: 1.25 } } }) as never)
  on('command.register', () => ({ value: { command: 'painel' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  return clock
}

// One main-loop request that read most of its prompt from the cache.
async function request($: Engine, _on: On, turnId: string, read = 90_000) {
  nextRead = read
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) {
    // nothing streams beneath
  }
}

// Everything a drawing says: its texts, and on the desktop each Svg's alt and the words inside it.
type Found = { text?: string; props: Record<string, unknown> }
const texts = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) => {
  const words = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  for (const s of await ui.findAll({ type: 'Svg' })) {
    words.push(String(s.props.alt ?? ''))
    words.push(...[...String(s.props.source ?? '').matchAll(/>([^<>]+)</g)].map(m => (m[1] ?? '').trim()).filter(w => w && !w.includes('{')))
  }
  return words.map(w => w.replace(/ /g, ' ').replace(/&amp;/g, '&')).join(' | ')
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the top row shows turn, cost, context and the cache countdown`, async ($, on) => {
    const clock = await session($, on)
    await $.turn.start({ text: 'hi', turnId: 't1' } as never)
    await request($, on, 't1')
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)

    const ui = await $.ui.mount({ plugin: P, surface, ...band() })
    const top = await texts(ui)
    expect(top).toContain('Turn')
    expect(top).toMatch(surface === 'terminal' ? /ctx/ : /context 34%/)
    expect(top).toContain('34%')
    // 90k of 100k read from the cache; a subscription's cache lives an hour.
    expect(top).toContain('cache 90%')
    expect(top).toContain('1:00:00')
    // No plan, no agents: one row only.
    expect(await ui.find({ type: 'Text', text: /█|░/ })).toBeUndefined()
    await ui.unmount()

    await clock.advance(2 * 60_000)
    const late = await $.ui.mount({ plugin: P, surface, ...band() })
    expect(await texts(late)).toContain('58:00')
    await late.unmount()
  })

  test(`${surface}: a plan and its agents appear under the top row`, async ($, on) => {
    await session($, on)
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    const made = await $.tool.call({ tool: PLAN, id: 'ship', title: 'Ship it', stages: [{ name: 'Code', steps: [{ title: 'Parser' }, { title: 'CLI' }] }] } as never)
    expect(made).toMatchObject({ result: 'ship: 0/2, running, active "Parser"' })
    expect(await $.tool.call({ tool: PLAN, id: 'ship', next: true } as never)).toMatchObject({ result: 'ship: 1/2, running, active "CLI"' })

    await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'Do it', description: 'Wire the CLI', subagentType: 'planfig-mods:savvy-light' } as never)
    expect(await $.tool.call({ tool: STEP, done: 1, total: 3, note: 'flags', agentId: 'a1' } as never)).toMatchObject({ result: 'ok' })

    const ui = await $.ui.mount({ plugin: P, surface, ...band() })
    const all = await texts(ui)
    expect(all).toContain('Ship it · CLI')
    expect(all).toContain('1/2')
    if (surface === 'terminal') {
      expect(all).toContain('Light')
      expect(all).toContain('Wire the CLI')
      expect(all).toContain('1/3')
    } else {
      // The desktop draws the pill bar with a crew button; the agents sit in the pane, opened by itself.
      expect((await ui.find({ key: 'painel-crew' }))?.props.label).toBe('×1')
      const side = await $.ui.mount({ plugin: P, surface, ...pane })
      const rows = await texts(side)
      expect(rows).toContain('Wire the CLI')
      expect(rows).toContain('1/3 · flags')
      expect(rows).toContain('Light')
      await side.unmount()
    }
    await ui.unmount()

    // The worker finishes: still listed this turn, in green; gone from the band next turn, kept in the pane.
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'w1', agentId: 'a1', reason: 'answer' } as never)
    const after = await $.ui.mount({ plugin: P, surface, ...band() })
    if (surface === 'terminal') expect(await after.find({ type: 'Text', text: /✓/ })).toBeDefined()
    await after.unmount()
    await $.turn.start({ text: 'next', turnId: 't2' } as never)
    const next = await $.ui.mount({ plugin: P, surface, ...band() })
    expect(await texts(next)).not.toContain('Wire the CLI')
    await next.unmount()

    const detail = await $.ui.mount({ plugin: P, surface, ...pane })
    const full = await texts(detail)
    expect(full).toContain('Wire the CLI')
    expect(full).toContain('Ship it')
    expect(full).toContain('1/2')
    await detail.unmount()
  })

  test(`${surface}: the band narrows instead of wrapping`, async ($, on) => {
    await session($, on)
    await $.turn.start({ text: 'hi', turnId: 't1' } as never)
    await request($, on, 't1')
    const narrow = await $.ui.mount({ plugin: P, surface, ...band(40) })
    const text = await texts(narrow)
    expect(text).not.toContain('tok/s')
    expect(text).not.toContain('Turn')
    expect(text).toContain('34%')
    await narrow.unmount()
  })
}

test('the pane lists the cache per turn', async ($, on) => {
  await session($, on)
  for (const id of ['t1', 't2']) {
    await $.turn.start({ text: 'x', turnId: id } as never)
    await request($, on, id, id === 't1' ? 0 : 90_000)
  }
  const ui = await $.ui.mount({ plugin: P, surface: 'terminal', ...pane })
  const text = await texts(ui)
  expect(text).toContain('Prompt cache')
  expect(text).toContain('90%')
  expect(text).toContain('0%')
  await ui.unmount()
})

test('/painel band hides the band; a subagent cannot report steps for the main session', async ($, on) => {
  await session($, on)
  await $.turn.start({ text: 'x', turnId: 't1' } as never)
  expect(await $.command.run({ command: 'painel', args: 'band' } as never)).toMatchObject({ text: 'Band hidden (/painel band shows it again).' })
  const ui = await $.ui.mount({ plugin: P, surface: 'terminal', ...band() })
  expect(await ui.find({ type: 'Text', text: /Turn/ })).toBeUndefined()
  await ui.unmount()
  expect(await $.tool.call({ tool: STEP, done: 1 } as never)).toMatchObject({ result: 'ignored: only subagents report steps (the main session uses painel_plan)' })
})

test('a savvy worker gets the step brief; another agent does not', async ($, on) => {
  await session($, on)
  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'Task', description: 'One', subagentType: 'savvy-medium' } as never)
  await $.agent.spawn({ tool_use_id: 'u2', prompt: 'Task', description: 'Two', subagentType: 'Explore' } as never)
  expect(prompts[0]).toContain(STEP)
  expect(prompts[1]).toBe('Task')
})
