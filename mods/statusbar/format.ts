import type { Color } from 'claude-code'

import type { StatusbarState } from '../../types'

export type SegmentId = 'model' | 'effort' | 'mode' | 'dir' | 'branch' | 'context' | 'fiveHour' | 'week'

export type Segment = {
  id: SegmentId
  text: string
  color: Color
  isBold?: boolean
  /** Drawn dim after the text (a reset time). */
  detail?: string
}

export const SEPARATOR = ' · '

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const isEffortLevel = (text: string): boolean =>
  (EFFORT_LEVELS as readonly string[]).includes(text)

const FAMILIES = 'opus|sonnet|haiku|fable'
// claude-sonnet-5-5, claude-haiku-4-5-20251001, claude-sonnet-4-20250514[1m]
const MODERN = new RegExp(
  `^claude-(${FAMILIES})-(\\d+)(?:-(\\d{1,2}))?(?:-\\d{8})?(\\[[^\\]]*\\])?$`,
  'i',
)
// claude-3-5-sonnet-20241022
const LEGACY = new RegExp(
  `^claude-(\\d+)(?:-(\\d{1,2}))?-(${FAMILIES})(?:-\\d{8})?(\\[[^\\]]*\\])?$`,
  'i',
)

const titleCase = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

const describeModel = (
  family: string | undefined,
  major: string | undefined,
  minor: string | undefined,
  context: string | undefined,
): string => {
  const version = minor === undefined ? major : `${major}.${minor}`
  const window = context === undefined ? '' : ` (${context.slice(1, -1).toUpperCase()})`

  return `${titleCase(family ?? '')} ${version}${window}`
}

/** `claude-sonnet-5-5` becomes `Sonnet 5.5`; an id it does not recognise stays as it is. */
export const modelLabel = (id: string): string => {
  if (/\s/.test(id)) {
    return id
  }

  const modern = MODERN.exec(id)

  if (modern) {
    return describeModel(modern[1], modern[2], modern[3], modern[4])
  }

  const legacy = LEGACY.exec(id)

  if (legacy) {
    return describeModel(legacy[3], legacy[1], legacy[2], legacy[4])
  }

  return id.replace(/^claude-/, '')
}

/** A level stays as it is, a numeric thinking budget reads `8k`. */
export const effortLabel = (effort: string | null): string | null => {
  if (effort === null || effort === '') {
    return null
  }

  if (/^\d+$/.test(effort)) {
    const budget = Number(effort)

    return budget >= 1000 ? `${Math.round(budget / 1000)}k` : effort
  }

  return effort
}

const effortColor = (effort: string): Color =>
  effort === 'high' || effort === 'xhigh' || effort === 'max' ? 'suggestion' : 'inactive'

// The words the prompt footer itself uses; the default mode is its "manual mode".
const MODES = new Map<string, { text: string; color: Color }>([
  ['default', { text: 'manual mode', color: 'inactive' }],
  ['acceptEdits', { text: '⏵⏵ accept edits', color: 'autoAccept' }],
  ['plan', { text: '⏸ plan mode', color: 'planMode' }],
  ['auto', { text: '⏵⏵ auto mode', color: 'autoAccept' }],
  ['dontAsk', { text: "⏵⏵ don't ask", color: 'warning' }],
  ['bypassPermissions', { text: '⏵⏵ bypass', color: 'error' }],
])

export const modeLabel = (mode: string): { text: string; color: Color } =>
  MODES.get(mode) ?? { text: mode, color: 'text' }

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`

/**
 * The directory with the home folder as `~`, forward slashes, and — when it is
 * longer than `maxLength` — only its tail, led by `…/`.
 */
export const shortPath = (cwd: string, home: string | null, maxLength: number): string => {
  let path = cwd.replace(/\\/g, '/')
  const base = home?.replace(/\\/g, '/').replace(/\/+$/, '')

  if (base && (path.toLowerCase() === base.toLowerCase() || path.toLowerCase().startsWith(`${base.toLowerCase()}/`))) {
    path = `~${path.slice(base.length)}`
  }

  path = path.replace(/\/+$/, '') || '/'

  if (path.length <= maxLength) {
    return path
  }

  const parts = path.split('/')
  let tail = ''

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const grown = tail === '' ? (parts[i] ?? '') : `${parts[i]}/${tail}`

    if (grown.length + 2 > maxLength) {
      break
    }

    tail = grown
  }

  if (tail === '') {
    const last = parts[parts.length - 1] ?? path

    return `…${last.slice(-(maxLength - 1))}`
  }

  return `…/${tail}`
}

export const buildSegments = (state: StatusbarState, dirMax: number): Segment[] => {
  const segments: Segment[] = []

  if (state.model) {
    segments.push({ id: 'model', text: modelLabel(state.model), color: 'claude', isBold: true })
  }

  const effort = effortLabel(state.effort)

  if (state.effort && effort) {
    segments.push({
      id: 'effort',
      text: `effort ${effort}`,
      color: effortColor(state.effort),
    })
  }

  if (state.mode) {
    const mode = modeLabel(state.mode)
    segments.push({ id: 'mode', text: mode.text, color: mode.color, isBold: state.mode !== 'default' })
  }

  if (state.cwd) {
    segments.push({ id: 'dir', text: shortPath(state.cwd, state.home, dirMax), color: 'suggestion' })
  }

  if (state.branch) {
    segments.push({ id: 'branch', text: `git:${clip(state.branch, 28)}`, color: 'merged' })
  }

  return segments
}

const widthOf = (segments: readonly Segment[]): number =>
  segments.reduce((sum, segment) => sum + segment.text.length, 0) +
  SEPARATOR.length * Math.max(0, segments.length - 1)

// What goes first when the row is too narrow: the least telling segment.
const DROP_ORDER: readonly SegmentId[] = ['effort', 'dir', 'branch', 'model', 'mode']

/** The segments that fit in `columns` cells: the directory shortens first, then segments drop. */
export const layout = (state: StatusbarState, columns: number): Segment[] => {
  for (const dirMax of [32, 20, 12]) {
    const segments = buildSegments(state, dirMax)

    if (widthOf(segments) <= columns) {
      return segments
    }
  }

  let segments = buildSegments(state, 12)

  for (const id of DROP_ORDER) {
    if (widthOf(segments) <= columns) {
      break
    }

    segments = segments.filter(segment => segment.id !== id)
  }

  return segments
}

// Green while there is room, amber past half, red past 80 %.
const percentColor = (percent: number): Color =>
  percent > 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

/** How long until `resetsAt`, rounded up to the minute: `37m`, `2h 14m`, `3d 4h`; null once it has passed. */
export const timeUntil = (resetsAt: string, now: number): string | null => {
  const ms = Date.parse(resetsAt) - now

  if (!Number.isFinite(ms) || ms <= 0) {
    return null
  }

  const minutes = Math.ceil(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rest}m`

  return `${rest}m`
}

/** The day and local time of `resetsAt` in the host's locale (`pon 14:00`); null when it does not parse. */
export const resetDay = (resetsAt: string, locale?: string): string | null => {
  const date = new Date(resetsAt)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    .format(date)
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The second row: context window, five-hour window and weekly window used, in
 * per cent, the five-hour window with the time left until it resets and the
 * weekly one with the day and hour it resets. A value the session has not
 * reported (no response yet, or an API key with no rate-limit windows) is left
 * out; with none, the row is empty.
 */
export const usageSegments = (state: StatusbarState, now: number, locale?: string): Segment[] => {
  const percent = (value: number) => `${Math.round(value)}%`
  const segments: Segment[] = []

  if (state.contextPercent !== null) {
    segments.push({
      id: 'context',
      text: `context ${percent(state.contextPercent)}`,
      color: percentColor(state.contextPercent),
    })
  }

  if (state.fiveHourPercent !== null) {
    const left = state.fiveHourResetsAt === null ? null : timeUntil(state.fiveHourResetsAt, now)

    segments.push({
      id: 'fiveHour',
      text: `5h ${percent(state.fiveHourPercent)}`,
      color: percentColor(state.fiveHourPercent),
      ...(left === null ? {} : { detail: `↻ ${left}` }),
    })
  }

  if (state.weekPercent !== null) {
    const day = state.weekResetsAt === null ? null : resetDay(state.weekResetsAt, locale)

    segments.push({
      id: 'week',
      text: `week ${percent(state.weekPercent)}`,
      color: percentColor(state.weekPercent),
      ...(day === null ? {} : { detail: `↻ ${day}` }),
    })
  }

  return segments
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

/** The effort the settings give: the model's own entry first, then the global one. */
export const effortFromSettings = (
  settings: Readonly<Record<string, unknown>>,
  model: string | null,
): string | null => {
  const own = model === null ? undefined : record(record(settings.modelSettings)?.[model])?.effortLevel
  const level = own ?? settings.effortLevel

  return typeof level === 'string' || typeof level === 'number' ? String(level) : null
}

/** The permission mode a session starts in, per the settings. */
export const modeFromSettings = (settings: Readonly<Record<string, unknown>>): string | null => {
  const mode = record(settings.permissions)?.defaultMode

  return typeof mode === 'string' ? mode : null
}

const MODE_TOKENS = new Map(
  ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'].map(mode => [
    mode.toLowerCase(),
    mode,
  ]),
)

/**
 * A permission mode as the CLI's telemetry spells it: a plain string, or a
 * first-party choice `{ value, of }` whose tokens are lowercase (`acceptedits`,
 * maybe `accept_edits`). Undefined for anything that is not a known mode.
 */
export const modeFromTelemetry = (value: unknown): string | undefined => {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null && typeof (value as { value?: unknown }).value === 'string'
        ? (value as { value: string }).value
        : undefined

  return raw === undefined ? undefined : MODE_TOKENS.get(raw.toLowerCase().replace(/[_-]/g, ''))
}

/**
 * The permission mode the prompt footer announces, read from the hint line.
 *
 * The footer names a mode only for a moment after a Shift+Tab ("plan mode on
 * (shift+tab to cycle)", "auto mode on (...)", "accept edits on (...)", and
 * "manual mode on" for the default mode), then redraws without a label in EVERY
 * mode ("(shift+tab to cycle) · ← for agents"). So a label is news of a switch,
 * and a line without one says nothing: it is no proof of the default mode.
 *
 * Undefined when the line names no mode.
 */
export const modeFromHint = (hint: string): string | undefined => {
  const text = hint.toLowerCase()

  if (/plan mode on/.test(text)) return 'plan'
  if (/auto mode on/.test(text)) return 'auto'
  if (/accept edits on/.test(text)) return 'acceptEdits'
  if (/bypass permissions on/.test(text)) return 'bypassPermissions'
  if (/don.?t ask on/.test(text)) return 'dontAsk'
  if (/manual mode on/.test(text)) return 'default'

  return undefined
}
