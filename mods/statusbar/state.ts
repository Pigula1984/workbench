import type { StatusbarState } from '../../types'

// The pure half of the bar's state handling. The atom itself and every call that
// takes `$` are in statusbar.tsx, the one file the engine follows `$` through.

export type Changes = { [K in keyof StatusbarState]?: StatusbarState[K] | undefined }

/** The keys of `changes` that would alter `current`; a key left out or `undefined` is kept. */
export const changedKeys = (current: StatusbarState, changes: Changes): (keyof StatusbarState)[] =>
  (Object.keys(changes) as (keyof StatusbarState)[]).filter(
    key => changes[key] !== undefined && changes[key] !== current[key],
  )

/** `current` with `keys` taken from `changes`; `null` clears a value. */
export const applyChanges = (
  current: StatusbarState,
  changes: Changes,
  keys: readonly (keyof StatusbarState)[],
): StatusbarState => {
  const next = { ...current }

  for (const key of keys) {
    next[key] = changes[key] as never
  }

  return next
}

/** Runs `work` and swallows what it throws: an observer must never take the chain down. */
export const safely = async (work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch {
    // The bar is decoration: a failed refresh leaves the last known value on screen.
  }
}
