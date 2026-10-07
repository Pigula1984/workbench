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

declare module 'claude-code' {
  interface PluginState {
    workbench: { statusbar: StatusbarState }
  }
}
