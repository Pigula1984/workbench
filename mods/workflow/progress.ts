import type { Color } from 'claude-code'

import type { WorkflowRun, WorkflowState, WorkflowStatus } from '../../types'

// The pure half of the workflow mod: reading a script's phases, the state's
// transitions and the chain the prompt hint draws. The atom and every call that
// takes `$` are in workflow.tsx.

export const ARROW = ' -> '

/** How one step of the chain is drawn: finished, running now, not started, or where the run stopped. */
export type StepState = 'done' | 'active' | 'pending' | 'failed'

export type Step = {
  title: string
  /** Agents of the phase whose turn ended. */
  finished: number
  /** Agents of the phase started so far. */
  total: number
  state: StepState
}

export type ChainSegment = { text: string; color: Color; isBold: boolean }

const COLORS: Record<StepState, Color> = {
  done: 'success',
  active: 'suggestion',
  pending: 'inactive',
  failed: 'error',
}

// The index just past the bracket that closes the one opened before `from`;
// string literals are skipped, so a `]` in a title does not close the list.
const closingBracket = (source: string, from: number): number => {
  let depth = 1
  let quote: string | null = null

  for (let index = from; index < source.length; index++) {
    const char = source[index]

    if (quote !== null) {
      if (char === '\\') {
        index++
      } else if (char === quote) {
        quote = null
      }
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if (char === '[') {
      depth++
    } else if (char === ']' && --depth === 0) {
      return index
    }
  }

  return source.length
}

/**
 * The phase titles a workflow script's `meta.phases` declares, in order; none
 * when it declares none. `meta` is a pure literal by the Workflow tool's rule,
 * so the source names them as written.
 */
export const declaredPhases = (script: string): string[] => {
  const meta = /\bmeta\s*=\s*\{/.exec(script)

  if (meta === null) {
    return []
  }

  const key = /\bphases\s*:\s*\[/g
  key.lastIndex = meta.index
  const list = key.exec(script)

  if (list === null) {
    return []
  }

  const start = list.index + list[0].length
  const body = script.slice(start, closingBracket(script, start))

  return [...body.matchAll(/\btitle\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(match =>
    (match[2] ?? '').replace(/\\(.)/g, '$1'),
  )
}

const emptyRun = (runId: string): WorkflowRun => ({
  runId,
  taskId: null,
  name: null,
  transcriptDir: null,
  phases: [],
  agents: [],
  status: 'running',
})

const withRun = (state: WorkflowState, runId: string, change: (run: WorkflowRun) => WorkflowRun): WorkflowState => {
  const known = state.runs.some(run => run.runId === runId)

  return {
    runs: known
      ? state.runs.map(run => (run.runId === runId ? change(run) : run))
      : [...state.runs, change(emptyRun(runId))],
  }
}

export type Launch = Pick<WorkflowRun, 'runId' | 'taskId' | 'name' | 'transcriptDir' | 'phases'>

/**
 * A Workflow call started (or resumed) a run. A resume keeps the run's id: the
 * agents that finished stay counted, the ones it cut short start over.
 */
export const launched = (state: WorkflowState, launch: Launch): WorkflowState =>
  withRun(state, launch.runId, run => ({
    ...run,
    ...launch,
    agents: run.status === 'running' ? run.agents : run.agents.filter(agent => agent.isFinished),
    status: 'running',
  }))

/** One of the run's `agent()` calls started an agent. */
export const agentStarted = (state: WorkflowState, runId: string, agentId: string): WorkflowState =>
  withRun(state, runId, run =>
    run.agents.some(agent => agent.id === agentId)
      ? run
      : { ...run, agents: [...run.agents, { id: agentId, phase: null, isFinished: false }] },
  )

const withAgent = (
  state: WorkflowState,
  agentId: string,
  change: (agent: WorkflowRun['agents'][number]) => WorkflowRun['agents'][number],
): WorkflowState => ({
  runs: state.runs.map(run =>
    run.agents.some(agent => agent.id === agentId)
      ? { ...run, agents: run.agents.map(agent => (agent.id === agentId ? change(agent) : agent)) }
      : run,
  ),
})

/** The agent's meta file named its phase (`''` for none). */
export const agentPhased = (state: WorkflowState, agentId: string, phase: string): WorkflowState =>
  withAgent(state, agentId, agent => ({ ...agent, phase }))

/** The agent's turn ended, answered or not. */
export const agentFinished = (state: WorkflowState, agentId: string): WorkflowState =>
  withAgent(state, agentId, agent => ({ ...agent, isFinished: true }))

/** A task notification's word for how a task ended, as a run's status. */
export const statusFromNotification = (status: string): WorkflowStatus =>
  status === 'completed' ? 'completed' : status === 'killed' ? 'killed' : 'failed'

/** The run's task ended; a task this mod does not track changes nothing. */
export const ended = (state: WorkflowState, taskId: string, status: WorkflowStatus): WorkflowState => ({
  runs: state.runs.map(run => (run.taskId === taskId ? { ...run, status } : run)),
})

/** The runs still running: the person's next prompt clears the ones that ended. */
export const cleared = (state: WorkflowState): WorkflowState => ({
  runs: state.runs.filter(run => run.status === 'running'),
})

/** The agents whose phase is not known yet, with the folder their meta file is in. */
export const unphased = (state: WorkflowState): { agentId: string; transcriptDir: string }[] =>
  state.runs.flatMap(run =>
    run.transcriptDir === null
      ? []
      : run.agents
          .filter(agent => agent.phase === null)
          .map(agent => ({ agentId: agent.id, transcriptDir: run.transcriptDir as string })),
  )

/**
 * The run's steps in order: the phases `meta` declares, then any other phase an
 * agent was filed under. An agent filed under none counts toward a step named
 * after the workflow; one whose phase is not read yet is not counted.
 *
 * While the run goes on, a step with agents still working is active, and so is
 * a finished step no later step has started after (the script is between
 * phases). A run that completed shows every started step done. One that failed
 * or was stopped shows the steps before the one it stopped in done and that one
 * red: the first with an agent unfinished, else the last that started.
 */
export const steps = (run: WorkflowRun): Step[] => {
  const titles = [...run.phases]
  const counts = new Map<string, { finished: number; total: number }>()

  for (const agent of run.agents) {
    if (agent.phase === null) {
      continue
    }

    const title = agent.phase === '' ? (run.name ?? 'workflow') : agent.phase

    if (!titles.includes(title)) {
      titles.push(title)
    }

    const count = counts.get(title) ?? { finished: 0, total: 0 }

    counts.set(title, {
      finished: count.finished + (agent.isFinished ? 1 : 0),
      total: count.total + 1,
    })
  }

  const counted = titles.map(title => ({ title, ...(counts.get(title) ?? { finished: 0, total: 0 }) }))
  const lastStarted = counted.reduce((last, step, index) => (step.total > 0 ? index : last), -1)

  if (run.status === 'completed') {
    return counted.map(step =>
      step.total > 0 ? { ...step, finished: step.total, state: 'done' } : { ...step, state: 'pending' },
    )
  }

  if (run.status !== 'running') {
    const unfinished = counted.findIndex(step => step.finished < step.total)
    const stop = unfinished >= 0 ? unfinished : Math.max(lastStarted, 0)

    return counted.map((step, index) => ({
      ...step,
      state: index === stop ? 'failed' : index < stop && step.total > 0 ? 'done' : 'pending',
    }))
  }

  return counted.map((step, index) => ({
    ...step,
    state:
      step.total === 0
        ? 'pending'
        : step.finished < step.total || index >= lastStarted
          ? 'active'
          : 'done',
  }))
}

/** The chain the prompt hint draws for one run: one segment per step, its count beside a started one. */
export const chain = (run: WorkflowRun): ChainSegment[] =>
  steps(run).map(step => ({
    text: step.total > 0 ? `${step.title} (${step.finished}/${step.total})` : step.title,
    color: COLORS[step.state],
    isBold: step.state === 'active' || step.state === 'failed',
  }))
