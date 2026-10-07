import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

// Everything the band shows, buttons' labels included, in reading order.
type Drawing = { find: (query: { type: string }) => Promise<{ text: string } | undefined> }

// Everything a drawing shows, in reading order.
const shown = async (ui: Drawing) => (await ui.find({ type: 'Box' }))?.text ?? ''

const CWD = 'C:\\Users\\Admin\\git\\workbench'
const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const

type GitAnswer = { exitCode: number; stdout: string; stderr: string }

const GIT_ON_MASTER: GitAnswer = { exitCode: 0, stdout: 'master\n', stderr: '' }
const NOT_A_REPOSITORY: GitAnswer = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }

// What the engine would answer beneath the plugin, so a session can start.
// What the plugin asked the engine for.
const commandsRun: string[] = []
const copied: string[] = []
const gitSwitches: string[] = []

const startSession = async (
  $: Engine,
  on: On,
  world: { settings?: Record<string, unknown>; cwd?: string; git?: GitAnswer } = {},
) => {
  const clock = mock.clock(on)
  const cwd = world.cwd ?? CWD

  commandsRun.length = 0
  copied.length = 0
  gitSwitches.length = 0
  const git = world.git ?? GIT_ON_MASTER

  mock.env(on, { USERPROFILE: 'C:\\Users\\Admin' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.cwd', () => ({ value: cwd }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh', ...world.settings } }))
  on('process.run', (_$, e) => {
    const answer = e.argv.includes('--format=%(refname:short)')
      ? { exitCode: 0, stdout: 'master\nfeature\n', stderr: '' }
      : e.argv[1] === 'log'
        ? { exitCode: 0, stdout: 'abc1234 First commit\n', stderr: '' }
        : e.argv[1] === 'switch'
          ? (gitSwitches.push(String(e.argv[2])), { exitCode: 0, stdout: '', stderr: '' })
          : git

    return { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('command.run', (_$, e) => {
    commandsRun.push(e.args === '' ? e.command : `${e.command} ${e.args}`)

    return {}
  })
  on('ui.copy', (_$, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.CwdChanged', () => ({}))
  on('telemetry.log', () => ({ value: undefined }))
  on('classic.PostCompact', () => ({}))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 68000, window: 200000, percent: 34 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 12.5, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
        { kind: 'seven_day', percentUsed: 81, resetsAt: '2099-10-12T12:00:00Z' },
      ],
    },
  }))
  // The engine's own model request: a word of text, then the step's result.
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'hi' }

    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  await clock.settle()

  return clock
}

const mountBand = ($: Engine, props: RenderPropsOf['AbovePrompt'] = BAND) =>
  $.ui.mount({ plugin: 'workbench', surface: 'terminal', component: 'AbovePrompt', props })

test('draws model, effort, mode, directory and branch above the prompt', async ($, on) => {
  await startSession($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'workbench', surface, component: 'AbovePrompt', props: BAND })

    for (const text of [
      'Sonnet 5.5',
      'effort xhigh',
      'manual mode',
      '~/git/workbench',
      'git:master',
      'context 34%',
      '5h 13%',
      'week 81%',
    ]) {
      expect(await shown(ui), `${surface}: ${text}`).toContain(text)
    }

    expect(await shown(ui)).toMatch(/5h 13% ↻ (1h 59m|2h 0m)/)

    // Every segment keeps its color: the model's, the branch's, the percentages'.
    const colorOf = async (text: string) => (await ui.find({ type: 'Text', text }))?.props.color
    expect(await colorOf('Sonnet 5.5')).toBe('claude')
    expect(await colorOf('git:master')).toBe('merged')
    expect(await colorOf('context 34%')).toBe('success')
    expect(await colorOf('week 81%')).toBe('error')
    expect(await shown(ui)).toMatch(/week 81% ↻ \S+ \d\d:00/)

    await ui.unmount()
  }
})

test('starts in the mode the settings name', async ($, on) => {
  await startSession($, on, { settings: { permissions: { defaultMode: 'acceptEdits' } } })

  expect(await shown(await mountBand($))).toContain('⏵⏵ accept edits')
})

test('follows the permission mode the classic events carry', async ($, on) => {
  await startSession($, on)

  const ui = await mountBand($)

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' })
  expect(await shown(ui)).toContain('⏸ plan mode')
  expect(await shown(ui)).not.toContain('manual mode')

  await $.classic.Stop({ stop_hook_active: false, permission_mode: 'auto' })
  expect(await shown(ui)).toContain('⏵⏵ auto mode')
})

test('ignores the mode of a subagent', async ($, on) => {
  await startSession($, on)

  const ui = await mountBand($)

  await $.classic.PostToolUse({
    tool_name: 'Read',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
    permission_mode: 'bypassPermissions',
    agent_id: 'sub-1',
  })
  expect(await shown(ui)).not.toContain('⏵⏵ bypass')
  expect(await shown(ui)).toContain('manual mode')
})

test('follows a model switch and a change of directory', async ($, on) => {
  await startSession($, on, { settings: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'max' } } } })

  const ui = await mountBand($)

  await $.classic.PostModelSwitch({
    from_model: 'claude-sonnet-5-5',
    to_model: 'claude-opus-5-5',
    requested_model: 'opus',
    source: 'command',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'catalog',
  })
  expect(await shown(ui)).toContain('Opus 5.5')
  expect(await shown(ui)).toContain('effort max')

  await $.classic.CwdChanged({ old_cwd: CWD, new_cwd: 'C:\\Users\\Admin\\git\\other' })
  expect(await shown(ui)).toContain('~/git/other')
})

test('takes the model and effort a main-loop request carries, not a subagent', async ($, on) => {
  await startSession($, on)

  const ui = await mountBand($)
  const request = { turnId: 't1', index: 0, messageCount: 3 }

  for await (const chunk of $.turn.step({ ...request, model: 'claude-opus-5-5', effort: 'max' })) {
    expect(chunk).toEqual({ kind: 'text', index: 0, text: 'hi' })
  }

  expect(await shown(ui)).toContain('Opus 5.5')
  expect(await shown(ui)).toContain('effort max')

  for await (const _chunk of $.turn.step({ ...request, agentId: 'sub-1', model: 'claude-haiku-4-5', effort: 'low' })) {
    // drained: the request goes through the plugin
  }

  expect(await shown(ui)).toContain('Opus 5.5')
  expect(await shown(ui)).toContain('effort max')

  for await (const _chunk of $.turn.step({ ...request, model: 'claude-haiku-4-5' })) {
    // a model without effort: the segment goes
  }

  expect(await shown(ui)).not.toMatch(/effort/)
})

test('shows the effort /effort sets', async ($, on) => {
  await startSession($, on)

  const ui = await mountBand($)

  await $.command.run({
    command: 'effort',
    args: 'low',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(await shown(ui)).toContain('effort low')
})

test('drops the branch outside a repository and gives way to a survey', async ($, on) => {
  await startSession($, on, { cwd: 'D:\\scratch', git: NOT_A_REPOSITORY })

  const ui = await mountBand($)

  expect(await shown(ui)).toContain('D:/scratch')
  expect(await shown(ui)).not.toMatch(/git:/)

  const survey = await mountBand($, { ...BAND, hasSurvey: true })

  expect(await shown(survey)).not.toContain('Sonnet 5.5')
})

// The footer names a new mode for a moment, then draws without a label in every mode.
const REST = '(shift+tab to cycle) · ← for agents'

test('follows Shift+Tab through the prompt footer and stays on the mode chosen', async ($, on) => {
  const clock = await startSession($, on)
  const band = await mountBand($)

  const footer = async (hint: string, isWorking = false) => {
    await $.ui.mount({
      plugin: 'workbench',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking, hint },
    })
    await clock.settle()
  }
  const shows = async (text: string) => {
    expect(await shown(band), text).toContain(text)
  }

  // The cycle a real session printed, each flash followed by the label-free redraw.
  await footer('auto mode on (shift+tab to cycle) · ← for agents')
  await footer(REST)
  await shows('⏵⏵ auto mode')
  await footer('manual mode on · ← for agents')
  await footer(REST)
  await shows('manual mode')
  await footer('accept edits on (shift+tab to cycle) · ← for agents')
  await footer(REST)
  await shows('⏵⏵ accept edits')
  await footer('plan mode on (shift+tab to cycle) · ← for agents')
  await footer(REST)
  await shows('⏸ plan mode')
  await footer('auto mode on (shift+tab to cycle)')
  await footer('')
  await shows('⏵⏵ auto mode')

  // A running turn draws the footer without a label too: nothing changes...
  await footer(REST, true)
  await shows('⏵⏵ auto mode')
  expect(await shown(band)).not.toContain('manual mode')

  // ...unless the person switches mid-turn, when it is named again.
  await footer('plan mode on (shift+tab to cycle)', true)
  await shows('⏸ plan mode')
})

test('a reload keeps the mode and effort the session already reached', async ($, on) => {
  await startSession($, on)

  const ui = await mountBand($)

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'auto' })
  await $.command.run({
    command: 'effort',
    args: 'low',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

  // session.start fires again when the module reloads; the settings still say default / xhigh.
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  expect(await shown(ui)).toContain('⏵⏵ auto mode')
  expect(await shown(ui)).toContain('effort low')
})

test('takes a mode switch the footer never showed from the CLI log', async ($, on) => {
  const clock = await startSession($, on)
  const band = await mountBand($)

  // What a real session did: the footer flashed plan, then the switch to auto drew nothing.
  await $.ui.mount({
    plugin: 'workbench',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'plan mode on (shift+tab to cycle) · ← for agents' },
  })
  await clock.settle()
  expect(await shown(band)).toContain('⏸ plan mode')

  await $.telemetry.log({
    to: 'collector',
    event: 'permission_mode_changed',
    attributes: { from_mode: 'plan', to_mode: 'auto', trigger: 'shift_tab' },
    loggedAt: new Date(0).toISOString(),
  })

  expect(await shown(band)).toContain('⏵⏵ auto mode')
  expect(await shown(band)).not.toContain('⏸ plan mode')
})

