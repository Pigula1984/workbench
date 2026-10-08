import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { WorkflowState, WorkflowStatus } from '../../types'
import { safely } from '../statusbar/state'
import {
  agentFinished,
  agentPhased,
  agentStarted,
  ARROW,
  chain,
  cleared,
  declaredPhases,
  ended,
  launched,
  statusFromNotification,
  unphased,
} from './progress'

// Every run the hint shows. The hooks keep it fresh, the render hook reads it,
// and a write redraws the hint.
const progress = atom({ plugin: 'workbench', key: 'workflow' } as const, { runs: [] } satisfies WorkflowState as WorkflowState)

// When an agent's phase is looked for again after its start, if its meta file was not there yet.
const PHASE_RETRY_MS = [1000, 3000, 10_000]

// What the Workflow tool answers once its run is launched (its record's fields this mod reads).
type Launched = {
  status?: string
  taskId?: string
  runId?: string
  workflowName?: string
  transcriptDir?: string
  scriptPath?: string
}

// The `$` helpers live in this file: the engine follows `$` into functions
// declared here, never across an import.

async function change($: EngineInterface, fn: (state: WorkflowState) => WorkflowState): Promise<void> {
  await update($, progress, state => fn(state ?? { runs: [] }))
}

// The script is read from where the run keeps it, whichever way it was given
// (inline, by name, by path, resumed): one source for the phase titles.
async function noteLaunch($: EngineInterface, record: Launched): Promise<void> {
  if (record.status !== 'async_launched' || record.runId === undefined) {
    return
  }

  const script = record.scriptPath === undefined ? '' : await $.fs.read(record.scriptPath).catch(() => '')

  await change($, state =>
    launched(state, {
      runId: record.runId as string,
      taskId: record.taskId ?? null,
      name: record.workflowName ?? null,
      transcriptDir: record.transcriptDir ?? null,
      phases: declaredPhases(script),
    }),
  )
  await resolvePhases($)
}

// Each agent's phase is in the meta file the run writes beside its transcript
// (`agent-<id>.meta.json`, `workflowPhase`); the spawn event does not carry it.
// Looked for at a launch, at each agent's start (and shortly after), and at its end.
async function resolvePhases($: EngineInterface): Promise<void> {
  for (const { agentId, transcriptDir } of unphased(await read($, progress))) {
    try {
      const meta = JSON.parse(await $.fs.read(`${transcriptDir}/agent-${agentId}.meta.json`)) as {
        workflowPhase?: unknown
      }
      const phase = typeof meta.workflowPhase === 'string' ? meta.workflowPhase : ''

      await change($, state => agentPhased(state, agentId, phase))
    } catch {
      // Not written yet: the agent's end looks again.
    }
  }
}

async function noteEnd($: EngineInterface, taskId: string, status: WorkflowStatus): Promise<void> {
  const { runs } = await read($, progress)

  if (runs.some(run => run.taskId === taskId && run.status !== status)) {
    await change($, state => ended(state, taskId, status))
  }
}

/**
 * The steps of each workflow run in the band above the prompt, under the
 * statusbar: `Zbieranie (3/3) -> Analiza (1/2) -> Podsumowanie`, the
 * finished steps green, the current one blue, the ones to come grey, and the
 * step a failed or stopped run ended in red.
 */
export const registerWorkflow = (on: On): void => {
  // A launch (or a resume) names the run, its task, its script and its folder.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const called = await next(e)

    if (called.result !== undefined) {
      await safely(() => noteLaunch($, called.result as Launched))
    }

    return called
  }).catch(($, e, next) => next(e))

  // Each agent a run's script starts; a retry of a stalled one is not raised again.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const runId = e.workflow?.runId

    if (runId !== undefined && runId !== '' && spawned.agentId !== undefined) {
      const agentId = spawned.agentId

      await safely(async () => {
        await change($, state => agentStarted(state, runId, agentId))
        await resolvePhases($)
      })

      // In case its meta file is written after the spawn resolves.
      for (const delay of PHASE_RETRY_MS) {
        $.clock.after(delay, () => {
          void safely(() => resolvePhases($))
        })
      }
    }

    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId

    if (agentId !== undefined) {
      await safely(async () => {
        const { runs } = await read($, progress)

        if (runs.some(run => run.agents.some(agent => agent.id === agentId && !agent.isFinished))) {
          await change($, state => agentFinished(state, agentId))
          await resolvePhases($)
        }
      })
    }

    return next(e)
  })

  // How the run ended reaches the session as its task's notification.
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, ($, e, next) => {
    const { id, status } = e.props.task ?? {}

    if (id !== undefined && status !== undefined) {
      // A render hook may not write state while it draws: write after it returns.
      $.clock.after(0, () => {
        void safely(() => noteEnd($, id, statusFromNotification(status)))
      })
    }

    return next(e)
  })

  // The person's next prompt clears the runs that ended; a running one stays.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      await safely(async () => {
        const { runs } = await read($, progress)

        if (runs.some(run => run.status !== 'running')) {
          await change($, cleared)
        }
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The band above the prompt: what the hooks beneath drew (the statusbar's
  // rows, registered after this mod), then one row per run. Registered first,
  // this hook is the outer one, so it sees their tree and adds to it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e)

    if (e.props.hasSurvey) {
      return beneath
    }

    const rows = (await read($, progress)).runs.map(chain).filter(row => row.length > 0)

    if (rows.length === 0) {
      return beneath
    }

    const { Box, Text } = $.ui.resolve(e)
    // A tree beneath is kept and the steps go under it; the engine's own band
    // (nothing beneath had rows) is replaced by the steps alone.
    const isTree = beneath.type === 'Box' || beneath.type === 'Text'

    return (
      <Box flexDirection="column" marginTop={isTree ? 0 : 1}>
        {isTree && beneath}
        {rows.map(row => (
          <Box>
            {row.map((segment, index) => (
              <Box>
                {index > 0 && <Text dimColor>{ARROW}</Text>}
                <Text color={segment.color} bold={segment.isBold} wrap="truncate">
                  {segment.text}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
