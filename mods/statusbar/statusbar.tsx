import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { StatusbarState } from '../../types'
import {
  effortFromSettings,
  isEffortLevel,
  CACHE_TTL_MS,
  layout,
  modeFromHint,
  modeFromSettings,
  modeFromTelemetry,
  SEPARATOR,
  usageSegments,
} from './format'
import { applyChanges, changedKeys, safely } from './state'
import type { Changes } from './state'

// Everything the band shows. The hooks keep it fresh, the render hook reads it,
// and a write redraws the band.
const bar = atom({ plugin: 'workbench', key: 'statusbar' } as const, {
  model: null,
  effort: null,
  mode: null,
  cwd: null,
  branch: null,
  home: null,
  contextPercent: null,
  fiveHourPercent: null,
  weekPercent: null,
  fiveHourResetsAt: null,
  weekResetsAt: null,
  cacheWarmUntil: null,
  costUsd: null,
} satisfies StatusbarState as StatusbarState)

const BRANCH_POLL_MS = 5000
const COUNTDOWN_REDRAW_MS = 30_000
const GIT_TIMEOUT_MS = 4000

type ModeCarrier = { permission_mode?: string | undefined; agent_id?: string | undefined }

// The `$` helpers live in this file: the engine follows `$` into functions
// declared here, never across an import.

async function patch($: EngineInterface, changes: Changes): Promise<void> {
  const keys = changedKeys(await read($, bar), changes)

  if (keys.length > 0) {
    await update($, bar, state => applyChanges(state, changes, keys))
  }
}

/**
 * The branch of the session's directory: its name, a short commit id in
 * parentheses when HEAD is detached, null outside a repository (or without git).
 *
 * `branch --show-current` rather than `rev-parse --abbrev-ref HEAD`: it also
 * names the branch of a repository that has no commit yet.
 */
async function readBranch($: EngineInterface): Promise<string | null> {
  try {
    const named = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: GIT_TIMEOUT_MS })

    if (named.exitCode !== 0) {
      return null
    }

    const name = named.stdout.trim()

    if (name !== '') {
      return name
    }

    const commit = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
    const id = commit.stdout.trim()

    return commit.exitCode === 0 && id !== '' ? `(${id})` : null
  } catch {
    return null
  }
}

// The status line's own figures: free to ask for, so asked for often.
async function refreshUsage($: EngineInterface): Promise<void> {
  await safely(async () => {
    const { context, rateLimits, cost } = await $.session.usage()
    const fiveHour = rateLimits.find(limit => limit.kind === 'five_hour')
    const week = rateLimits.find(limit => limit.kind === 'seven_day')

    await patch($, {
      contextPercent: context.percent ?? null,
      fiveHourPercent: fiveHour?.percentUsed ?? null,
      weekPercent: week?.percentUsed ?? null,
      fiveHourResetsAt: fiveHour?.resetsAt ?? null,
      weekResetsAt: week?.resetsAt ?? null,
      costUsd: cost?.usd ?? null,
    })
  })
}

async function refreshBranch($: EngineInterface): Promise<void> {
  await safely(async () => patch($, { branch: await readBranch($) }))
}

// A subagent's events carry its own mode, not the session's.
async function noteMode($: EngineInterface, e: ModeCarrier, event: string): Promise<void> {

  if (e.agent_id === undefined && e.permission_mode !== undefined) {
    await safely(() => patch($, { mode: e.permission_mode }))
  }
}

// Fills the bar once at start-up, then keeps the branch fresh on a timer.
//
// A hot reload runs this again over state the session has already built up, so the
// mode and effort are taken from the settings only while nothing better is known:
// the settings name where a session starts, not where it is by now.
async function start($: EngineInterface): Promise<void> {
  const known = await read($, bar)
  const settings = await $.settings.read().catch(() => ({}))
  const model = await $.session.model().catch(() => null)
  const cwd = await $.session.cwd().catch(() => null)
  const profile = await $.env.get('USERPROFILE').catch(() => undefined)
  const home = profile ?? (await $.env.get('HOME').catch(() => undefined))

  await patch($, {
    model,
    cwd,
    home: home ?? null,
    effort: known.effort ?? effortFromSettings(settings, model),
    mode: known.mode ?? modeFromSettings(settings) ?? 'default',
  })
  await refreshBranch($)
  await refreshUsage($)

  // Checkouts made outside this session (another terminal, an editor), a compaction,
  // a /clear, or a window that resets with the session idle show up within seconds.
  $.clock.every(BRANCH_POLL_MS, () => {
    void refreshUsage($)
    void refreshBranch($)
  })

  // The countdown to the five-hour reset moves with the clock, not with the state.
  $.clock.every(COUNTDOWN_REDRAW_MS, () => {
    $.ui.invalidate('ui.render')
  })
}

async function followModel($: EngineInterface, model: string): Promise<void> {
  const settings = await $.settings.read()

  await patch($, { model, effort: effortFromSettings(settings, model) })
}

// /effort changes it between requests: take the level typed, or re-read the settings.
async function followEffortCommand($: EngineInterface, args: string): Promise<void> {
  const typed = args.trim().toLowerCase()

  if (isEffortLevel(typed)) {
    await patch($, { effort: typed })

    return
  }

  const settings = await $.settings.read()

  await patch($, { effort: effortFromSettings(settings, (await read($, bar)).model) })
}

/**
 * A band above the prompt: model, effort, permission mode, directory, branch.
 *
 * Everything the band shows lives in the `bar` atom. The hooks below only keep
 * it fresh; the render hook reads it, so a write redraws the band.
 */
export const registerStatusbar = (on: On): void => {
  let lastHint: string | undefined

  on('session.start', ($, e, next) => {
    void safely(() => start($))

    return next(e)
  })

  // The model: /model, a picker, a fallback.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await safely(() => followModel($, e.to_model))
    // Another model has no cache of this conversation yet.
    await safely(() => patch($, { cacheWarmUntil: null }))

    return next(e)
  })

  // The effort each request really carries (the engine may lower it for a model); main loop only.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await safely(() => patch($, { model: e.model, effort: e.effort === undefined ? null : String(e.effort) }))
    }

    const result = yield* next(e)

    // Each response moves the context and the rate-limit windows, and rewrites the
    // prompt cache: it stays warm a TTL from now.
    if (e.agentId === undefined) {
      await refreshUsage($)

      if (result.usage !== null) {
        await safely(() => patch($, { cacheWarmUntil: new Date(Date.now() + CACHE_TTL_MS).toISOString() }))
      }
    }

    return result
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)

    await safely(() => followEffortCommand($, e.args))

    return ran
  })

  on('classic.CwdChanged', async ($, e, next) => {
    await safely(() => patch($, { cwd: e.new_cwd }))
    void refreshBranch($)

    return next(e)
  })

  // The permission mode rides on the base fields of the classic events.
  on('classic.SessionStart', async ($, e, next) => {
    await noteMode($, e, 'SessionStart')

    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e, 'UserPromptSubmit')

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await noteMode($, e, 'PermissionRequest')

    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await noteMode($, e, 'PostToolUse')

    if (e.tool_name === 'Bash' && e.agent_id === undefined) {
      void refreshBranch($)
    }

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    await noteMode($, e, 'Stop')
    void refreshBranch($)
    void refreshUsage($)

    return next(e)
  })

  // A compaction empties most of the context window.
  on('classic.PostCompact', async ($, e, next) => {
    void refreshUsage($)

    return next(e)
  })

  // The surest word on a mode switch: every switch (Shift+Tab, a plan approved,
  // /permissions) logs `permission_mode_changed` { from_mode, to_mode } for an
  // OpenTelemetry collector. The engine raises it through the hooks whether or not
  // a collector is configured; this hook only reads it and passes it on unchanged.
  on('telemetry.log', { to: 'collector', event: 'permission_mode_changed' }, async ($, e, next) => {
    const mode = modeFromTelemetry(e.attributes.to_mode)


    if (mode !== undefined) {
      await safely(() => patch($, { mode }))
    }

    return next(e)
  })

  // Shift+Tab changes the mode between events. The footer names the new mode for a
  // moment, then draws without a label in every mode: take the flash, never the silence.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    const { hint, isWorking } = e.props

    if (hint !== lastHint) {
      lastHint = hint

      const mode = modeFromHint(hint)

      if (mode !== undefined) {
        // A render hook may not write state while it draws: write after it returns.
        $.clock.after(0, () => {
          void safely(() => patch($, { mode }))
        })
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const state = await read($, bar)
    const rows = [layout(state, e.props.bodyColumns), usageSegments(state, Date.now())].filter(row => row.length > 0)


    if (rows.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" marginTop={1}>
        {rows.map(row => (
          <Box>
            {row.map((segment, index) => (
              <Box>
                {index > 0 && <Text dimColor>{SEPARATOR}</Text>}
                <Text color={segment.color} bold={segment.isBold} wrap="truncate">
                  {segment.text}
                </Text>
                {segment.detail !== undefined && <Text dimColor wrap="truncate">{` ${segment.detail}`}</Text>}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
