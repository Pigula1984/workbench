/**
 * What the statusbar mod knows about the session. `null` is "not known yet"
 * (or, for `branch`, "not in a git repository"): the bar leaves that segment out.
 */
export type StatusbarState = {
  /** The main loop's model id as the engine reports it (`claude-sonnet-5-5`). */
  model: string | null
  /** A level (`xhigh`) or a numeric thinking budget, as text. */
  effort: string | null
  /** A permission mode: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. */
  mode: string | null
  /** The session's directory, absolute. */
  cwd: string | null
  /** The checked-out branch; a short commit id in parentheses when detached. */
  branch: string | null
  /** The user's home directory, to shorten paths with `~`. */
  home: string | null
  /** How full the context window is, 0 to 100. */
  contextPercent: number | null
  /** How much of the five-hour rate-limit window is used, 0 to 100. */
  fiveHourPercent: number | null
  /** How much of the weekly rate-limit window is used, 0 to 100. */
  weekPercent: number | null
  /** When the five-hour window resets, ISO 8601. */
  fiveHourResetsAt: string | null
  /** When the weekly window resets, ISO 8601. */
  weekResetsAt: string | null
  /** When the main thread's prompt cache goes cold, ISO 8601: its last response plus the cache's lifetime. */
  cacheWarmUntil: string | null
  /** What the session would have cost at API prices, in US dollars, as /cost totals it. */
  costUsd: number | null
}

/** Where a workflow run stands: running, or how it ended as its task notification says. */
export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'killed'

/** One agent a workflow script's `agent()` started. */
export type WorkflowAgent = {
  /** The id `agent.spawn` answered, which the agent's `turn.complete` carries. */
  id: string
  /** The phase the run filed it under; `''` for none, `null` until its meta file is read. */
  phase: string | null
  /** True once its turn ended, answered or not. */
  isFinished: boolean
}

/** One run of the Workflow tool, keyed by its `runId` (a resume keeps it). */
export type WorkflowRun = {
  runId: string
  /** The background task's id, which its notification names; null until the launch is seen. */
  taskId: string | null
  /** `meta.name` of the script. */
  name: string | null
  /** Where the run keeps its agents' transcripts and meta files. */
  transcriptDir: string | null
  /** The phase titles the script's `meta.phases` declares, in order. */
  phases: string[]
  agents: WorkflowAgent[]
  status: WorkflowStatus
}

/** What the workflow mod knows: the runs of this session it still shows. */
export type WorkflowState = {
  runs: WorkflowRun[]
}

declare module 'claude-code' {
  interface PluginState {
    workbench: { statusbar: StatusbarState; workflow: WorkflowState }
  }
}
