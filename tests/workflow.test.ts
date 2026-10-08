import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

// Everything a drawing shows, in reading order.
type Drawing = { find: (query: { type: string; text?: string }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }

const shown = async (ui: Drawing) => (await ui.find({ type: 'Box' }))?.text ?? ''
const colorOf = async (ui: Drawing, text: string) => (await ui.find({ type: 'Text', text }))?.props.color

const RUN_DIR = 'C:\\runs\\wf_1'
const SCRIPT_PATH = 'C:\\runs\\scripts\\probe.js'
const SCRIPT = `export const meta = {
  name: 'probe-progress',
  description: 'Three phases',
  phases: [{ title: 'Collect' }, { title: 'Analyze' }, { title: 'Summarize' }],
}
`

const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const

// What the engine would answer beneath the plugin: the files a run writes,
// the Workflow tool's launch, the agents it starts.
const startSession = async ($: Engine, on: On, phases: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  const files = new Map<string, string>([[SCRIPT_PATH, SCRIPT]])

  for (const [agentId, phase] of Object.entries(phases)) {
    files.set(`${RUN_DIR}\\agent-${agentId}.meta.json`, JSON.stringify({ workflowPhase: phase }))
  }

  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)

    return text === undefined ? { deny: `ENOENT: no such file, open '${e.path}'` } : { value: text }
  })
  on('tool.call', { tool: 'Workflow' }, () => ({
    result: {
      status: 'async_launched',
      taskId: 'task-1',
      taskType: 'local_workflow',
      workflowName: 'probe-progress',
      runId: 'wf_1',
      summary: 'Three phases',
      transcriptDir: RUN_DIR,
      scriptPath: SCRIPT_PATH,
    },
  }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('classic.UserPromptSubmit', () => ({}))

  return clock
}

const launch = ($: Engine) => $.tool.call({ tool: 'Workflow', script: SCRIPT })

// A workflow agent's spawn; the test's spawn answers the description as its id.
const spawn = ($: Engine, agentId: string, runId = 'wf_1') =>
  $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'Reply with one word.',
    description: agentId,
    subagentType: 'workflow-subagent',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    workflow: { runId, agentIndex: 1 },
  })

const finish = ($: Engine, agentId: string, reason: 'answer' | 'error' = 'answer') =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `turn-${agentId}`, agentId, reason })

const notify = ($: Engine, status: string) =>
  $.ui.mount({
    plugin: 'workbench',
    surface: 'terminal',
    component: 'UserMessage',
    props: {
      text: '<task-notification>',
      origin: { kind: 'task-notification' },
      isExpanded: false,
      task: { id: 'task-1', status },
    },
  })

const mountBand = ($: Engine, props: RenderPropsOf['AbovePrompt'] = BAND) =>
  $.ui.mount({ plugin: 'workbench', surface: 'terminal', component: 'AbovePrompt', props })

test('leaves the band to the statusbar while no workflow runs', async ($, on) => {
  await startSession($, on)

  expect(await shown(await mountBand($))).toBe('')
})

test('shows the steps of a running workflow, each in its color', async ($, on) => {
  await startSession($, on, { a1: 'Collect', a2: 'Collect', a3: 'Analyze', a4: 'Analyze' })

  const ui = await mountBand($)

  await launch($)
  expect(await shown(ui)).toContain('Collect -> Analyze -> Summarize')

  await spawn($, 'a1')
  await spawn($, 'a2')
  await finish($, 'a1')
  await finish($, 'a2')
  await spawn($, 'a3')
  await spawn($, 'a4')
  await finish($, 'a3')

  expect(await shown(ui)).toContain('Collect (2/2) -> Analyze (1/2) -> Summarize')
  expect(await colorOf(ui, 'Collect (2/2)')).toBe('success')
  expect(await colorOf(ui, 'Analyze (1/2)')).toBe('suggestion')
  expect(await colorOf(ui, 'Summarize')).toBe('inactive')
})

test('ignores agents that no workflow started', async ($, on) => {
  await startSession($, on)

  const ui = await mountBand($)

  await $.agent.spawn({
    tool_use_id: 'toolu_2',
    prompt: 'Look around.',
    description: 'plain-agent',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  await finish($, 'plain-agent')

  expect(await shown(ui)).toBe('')
})

test('turns the step a failed run stopped in red', async ($, on) => {
  const clock = await startSession($, on, { a1: 'Collect', a2: 'Analyze' })

  const ui = await mountBand($)

  await launch($)
  await spawn($, 'a1')
  await finish($, 'a1')
  await spawn($, 'a2')
  await finish($, 'a2', 'error')
  await notify($, 'failed')
  await clock.settle()

  expect(await shown(ui)).toContain('Collect (1/1) -> Analyze (1/1) -> Summarize')
  expect(await colorOf(ui, 'Collect (1/1)')).toBe('success')
  expect(await colorOf(ui, 'Analyze (1/1)')).toBe('error')
})

test('keeps an ended run until the person sends the next prompt', async ($, on) => {
  const clock = await startSession($, on, { a1: 'Collect' })

  const ui = await mountBand($)

  await launch($)
  await spawn($, 'a1')
  await finish($, 'a1')
  await notify($, 'completed')
  await clock.settle()

  // The notification's own turn does not clear it.
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } })
  expect(await shown(ui)).toContain('Collect (1/1) -> Analyze -> Summarize')
  expect(await colorOf(ui, 'Collect (1/1)')).toBe('success')

  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  expect(await shown(ui)).toBe('')
})

test('a running workflow stays through the next prompt', async ($, on) => {
  await startSession($, on, { a1: 'Collect' })

  const ui = await mountBand($)

  await launch($)
  await spawn($, 'a1')
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })

  expect(await shown(ui)).toContain('Collect (0/1)')
})

test('draws the steps under the statusbar rows', async ($, on) => {
  await startSession($, on, { a1: 'Collect' })

  const ui = await mountBand($)

  // The statusbar has something to show once a prompt carried the mode.
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' })
  await launch($)
  await spawn($, 'a1')

  const text = await shown(ui)

  expect(text).toContain('⏸ plan mode')
  expect(text).toContain('Collect (0/1) -> Analyze -> Summarize')
  expect(text.indexOf('plan mode')).toBeLessThan(text.indexOf('Collect'))
})

test('yields the band to a survey', async ($, on) => {
  await startSession($, on, { a1: 'Collect' })

  await launch($)
  await spawn($, 'a1')

  expect(await shown(await mountBand($, { ...BAND, hasSurvey: true }))).toBe('')
})
