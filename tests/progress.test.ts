import { describe, expect, test } from 'claude-code/testing'

import {
  agentFinished,
  agentPhased,
  agentStarted,
  chain,
  cleared,
  declaredPhases,
  ended,
  launched,
  statusFromNotification,
  steps,
  unphased,
} from '../mods/workflow/progress'
import type { WorkflowRun, WorkflowState } from '../types'

const SCRIPT = `export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, verify each finding',
  phases: [
    { title: 'Collect', detail: 'one [agent] per file' },
    { title: "Analyze", model: 'haiku' },
    { title: \`Summarize\` },
  ],
}
phase('Collect')
const other = { phases: [{ title: 'not meta' }] }
`

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: 'wf_1',
  taskId: 'task-1',
  name: 'review-changes',
  transcriptDir: 'C:\\runs\\wf_1',
  phases: ['Collect', 'Analyze', 'Summarize'],
  agents: [],
  status: 'running',
  ...overrides,
})

const agent = (id: string, phase: string | null, isFinished: boolean) => ({ id, phase, isFinished })

describe('declaredPhases', () => {
  test('reads the titles of meta.phases in order, whatever the quotes', () => {
    expect(declaredPhases(SCRIPT)).toEqual(['Collect', 'Analyze', 'Summarize'])
  })

  test('is empty for a script that declares no phases', () => {
    expect(declaredPhases("export const meta = { name: 'x', description: 'y' }\nawait agent('hi')")).toEqual([])
    expect(declaredPhases('')).toEqual([])
  })

  test('keeps an escaped quote inside a title', () => {
    expect(declaredPhases("export const meta = { phases: [{ title: 'Don\\'t stop' }] }")).toEqual(["Don't stop"])
  })
})

describe('steps', () => {
  test('a running run: finished steps green, the current one active, the rest pending', () => {
    const shown = steps(
      run({
        agents: [
          agent('a1', 'Collect', true),
          agent('a2', 'Collect', true),
          agent('a3', 'Collect', true),
          agent('a4', 'Analyze', true),
          agent('a5', 'Analyze', false),
          agent('a6', 'Analyze', false),
        ],
      }),
    )

    expect(shown).toEqual([
      { title: 'Collect', finished: 3, total: 3, state: 'done' },
      { title: 'Analyze', finished: 1, total: 3, state: 'active' },
      { title: 'Summarize', finished: 0, total: 0, state: 'pending' },
    ])
  })

  test('a step stays current between phases, until a later one starts', () => {
    const shown = steps(run({ agents: [agent('a1', 'Collect', true)] }))

    expect(shown.map(step => step.state)).toEqual(['active', 'pending', 'pending'])
  })

  test('a completed run shows every started step done and whole', () => {
    // A retried agent is not raised again, so the events can leave a step short.
    const shown = steps(
      run({ status: 'completed', agents: [agent('a1', 'Collect', true), agent('a2', 'Analyze', false)] }),
    )

    expect(shown).toEqual([
      { title: 'Collect', finished: 1, total: 1, state: 'done' },
      { title: 'Analyze', finished: 1, total: 1, state: 'done' },
      { title: 'Summarize', finished: 0, total: 0, state: 'pending' },
    ])
  })

  test('a failed run is red in the step it stopped in', () => {
    const working = steps(
      run({ status: 'failed', agents: [agent('a1', 'Collect', true), agent('a2', 'Analyze', false)] }),
    )

    expect(working.map(step => step.state)).toEqual(['done', 'failed', 'pending'])

    // The script threw between agents: the last step that started is where it stopped.
    const between = steps(
      run({ status: 'failed', agents: [agent('a1', 'Collect', true), agent('a2', 'Analyze', true)] }),
    )

    expect(between.map(step => step.state)).toEqual(['done', 'failed', 'pending'])
  })

  test('a stopped run is red where it stopped, too', () => {
    const shown = steps(run({ status: 'killed', agents: [agent('a1', 'Collect', false)] }))

    expect(shown.map(step => step.state)).toEqual(['failed', 'pending', 'pending'])
  })

  test('an undeclared phase follows the declared ones; no phase counts under the workflow', () => {
    const shown = steps(
      run({
        phases: [],
        agents: [agent('a1', '', true), agent('a2', 'Verify', false), agent('a3', null, false)],
      }),
    )

    expect(shown).toEqual([
      { title: 'review-changes', finished: 1, total: 1, state: 'done' },
      { title: 'Verify', finished: 0, total: 1, state: 'active' },
    ])
  })
})

describe('chain', () => {
  test('names each step, its count once started, in its state color', () => {
    const segments = chain(
      run({
        status: 'failed',
        agents: [
          agent('a1', 'Collect', true),
          agent('a2', 'Collect', true),
          agent('a3', 'Collect', true),
          agent('a4', 'Analyze', true),
          agent('a5', 'Analyze', false),
        ],
      }),
    )

    expect(segments).toEqual([
      { text: 'Collect (3/3)', color: 'success', isBold: false },
      { text: 'Analyze (1/2)', color: 'error', isBold: true },
      { text: 'Summarize', color: 'inactive', isBold: false },
    ])
  })

  test('the current step is blue and bold', () => {
    const [first] = chain(run({ agents: [agent('a1', 'Collect', false)] }))

    expect(first).toEqual({ text: 'Collect (0/1)', color: 'suggestion', isBold: true })
  })
})

describe('the state', () => {
  const empty: WorkflowState = { runs: [] }
  const launch = {
    runId: 'wf_1',
    taskId: 'task-1',
    name: 'review-changes',
    transcriptDir: 'C:\\runs\\wf_1',
    phases: ['Collect'],
  }

  test('follows a run from launch to end', () => {
    let state = launched(empty, launch)
    state = agentStarted(state, 'wf_1', 'a1')
    state = agentStarted(state, 'wf_1', 'a1')

    expect(state.runs[0]?.agents).toEqual([agent('a1', null, false)])
    expect(unphased(state)).toEqual([{ agentId: 'a1', transcriptDir: 'C:\\runs\\wf_1' }])

    state = agentPhased(state, 'a1', 'Collect')
    state = agentFinished(state, 'a1')

    expect(state.runs[0]?.agents).toEqual([agent('a1', 'Collect', true)])
    expect(unphased(state)).toEqual([])

    state = ended(state, 'task-1', 'failed')
    expect(state.runs[0]?.status).toBe('failed')
    expect(cleared(state).runs).toEqual([])
  })

  test('an agent seen before its launch opens the run, and the launch fills it in', () => {
    const state = launched(agentStarted(empty, 'wf_1', 'a1'), launch)

    expect(state.runs).toHaveLength(1)
    expect(state.runs[0]?.taskId).toBe('task-1')
    expect(state.runs[0]?.agents).toEqual([agent('a1', null, false)])
  })

  test('a resume keeps the finished agents and drops the ones cut short', () => {
    let state = launched(empty, launch)
    state = agentStarted(agentStarted(state, 'wf_1', 'a1'), 'wf_1', 'a2')
    state = ended(agentFinished(state, 'a1'), 'task-1', 'failed')
    state = launched(state, { ...launch, taskId: 'task-2' })

    expect(state.runs[0]?.status).toBe('running')
    expect(state.runs[0]?.taskId).toBe('task-2')
    expect(state.runs[0]?.agents.map(each => each.id)).toEqual(['a1'])
  })

  test('clearing keeps a run still going', () => {
    const state = launched(empty, launch)

    expect(cleared(state)).toEqual(state)
  })

  test('reads a notification status', () => {
    expect(statusFromNotification('completed')).toBe('completed')
    expect(statusFromNotification('killed')).toBe('killed')
    expect(statusFromNotification('failed')).toBe('failed')
    expect(statusFromNotification('something else')).toBe('failed')
  })
})
