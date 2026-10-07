import { describe, expect, test } from 'claude-code/testing'

import {
  buildSegments,
  effortFromSettings,
  effortLabel,
  layout,
  modeFromHint,
  modeFromSettings,
  modeFromTelemetry,
  modelLabel,
  usageSegments,
  CACHE_TTL_MS,
  resetDay,
  timeUntil,
  shortPath,
} from '../mods/statusbar/format'
import type { StatusbarState } from '../types'

const FULL: StatusbarState = {
  model: 'claude-sonnet-5-5',
  effort: 'xhigh',
  mode: 'plan',
  cwd: 'C:\\Users\\Admin\\git\\workbench',
  branch: 'master',
  home: 'C:\\Users\\Admin',
  contextPercent: 34,
  fiveHourPercent: 12.5,
  weekPercent: 81,
  fiveHourResetsAt: '2026-10-12T14:14:00Z',
  weekResetsAt: '2026-10-12T12:00:00Z',
  cacheWarmUntil: '2026-10-12T12:47:00Z',
}

describe('modelLabel', () => {
  test('names current and dated model ids', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  })

  test('names legacy ids and a context-window suffix', () => {
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelLabel('claude-sonnet-4-5[1m]')).toBe('Sonnet 4.5 (1M)')
  })

  test('leaves aliases and display names alone', () => {
    expect(modelLabel('sonnet')).toBe('sonnet')
    expect(modelLabel('Sonnet 5.5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-something-new')).toBe('something-new')
  })
})

describe('effortLabel', () => {
  test('keeps a level and shortens a budget', () => {
    expect(effortLabel('xhigh')).toBe('xhigh')
    expect(effortLabel('8000')).toBe('8k')
    expect(effortLabel('512')).toBe('512')
    expect(effortLabel(null)).toBeNull()
    expect(effortLabel('')).toBeNull()
  })
})

describe('shortPath', () => {
  test('replaces the home folder with ~ and uses forward slashes', () => {
    expect(shortPath('C:\\Users\\Admin\\git\\workbench', 'C:\\Users\\Admin', 40)).toBe('~/git/workbench')
    expect(shortPath('c:\\users\\admin', 'C:\\Users\\Admin\\', 40)).toBe('~')
    expect(shortPath('D:\\work\\app', 'C:\\Users\\Admin', 40)).toBe('D:/work/app')
  })

  test('keeps the tail of a long path', () => {
    const long = 'C:\\Users\\Admin\\git\\workbench\\mods\\statusbar\\deep'

    expect(shortPath(long, 'C:\\Users\\Admin', 22)).toBe('…/mods/statusbar/deep')
    expect(shortPath('/very/long/directory/name', null, 8)).toBe('…/name')
    expect(shortPath('/averyveryverylongname', null, 8)).toBe('…ongname')
  })
})

describe('settings', () => {
  test('effort: the model entry wins over the global one', () => {
    const settings = {
      effortLevel: 'high',
      modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'xhigh' } },
    }

    expect(effortFromSettings(settings, 'claude-sonnet-5-5')).toBe('xhigh')
    expect(effortFromSettings(settings, 'claude-opus-5-5')).toBe('high')
    expect(effortFromSettings(settings, null)).toBe('high')
    expect(effortFromSettings({}, 'claude-opus-5-5')).toBeNull()
    expect(effortFromSettings({ effortLevel: { odd: true } }, null)).toBeNull()
  })

  test('mode: the default mode, when there is one', () => {
    expect(modeFromSettings({ permissions: { defaultMode: 'acceptEdits' } })).toBe('acceptEdits')
    expect(modeFromSettings({ permissions: {} })).toBeNull()
    expect(modeFromSettings({})).toBeNull()
  })
})

describe('modeFromHint', () => {
  test('reads the mode a real footer flashes after a Shift+Tab', () => {
    expect(modeFromHint('plan mode on (shift+tab to cycle) · ← for agents')).toBe('plan')
    expect(modeFromHint('auto mode on (shift+tab to cycle) · ← for agents')).toBe('auto')
    expect(modeFromHint('accept edits on (shift+tab to cycle) · ← for agents')).toBe('acceptEdits')
    expect(modeFromHint('manual mode on · ← for agents')).toBe('default')
    expect(modeFromHint('plan mode on (shift+tab to cycle)')).toBe('plan')
  })

  test('says nothing about a footer without a label: that is every mode at rest', () => {
    expect(modeFromHint('(shift+tab to cycle) · ← for agents')).toBeUndefined()
    expect(modeFromHint('(shift+tab to cycle)')).toBeUndefined()
    expect(modeFromHint('← for agents')).toBeUndefined()
    expect(modeFromHint('esc to interrupt')).toBeUndefined()
    expect(modeFromHint('')).toBeUndefined()
  })
})

describe('modeFromTelemetry', () => {
  test('reads a mode as a string or as a choice, in any spelling of its tokens', () => {
    expect(modeFromTelemetry('auto')).toBe('auto')
    expect(modeFromTelemetry('acceptEdits')).toBe('acceptEdits')
    expect(modeFromTelemetry('accept_edits')).toBe('acceptEdits')
    expect(modeFromTelemetry({ value: 'bypasspermissions', of: [] })).toBe('bypassPermissions')
    expect(modeFromTelemetry('default')).toBe('default')
  })

  test('ignores what is not a mode', () => {
    expect(modeFromTelemetry('turbo')).toBeUndefined()
    expect(modeFromTelemetry(undefined)).toBeUndefined()
    expect(modeFromTelemetry(3)).toBeUndefined()
    expect(modeFromTelemetry({ value: 7 })).toBeUndefined()
  })
})

describe('layout', () => {
  test('lays out the five segments in the order asked for', () => {
    const segments = layout(FULL, 120)

    expect(segments.map(segment => segment.id)).toEqual(['model', 'effort', 'mode', 'dir', 'branch'])
    expect(segments.map(segment => segment.text)).toEqual([
      'Sonnet 5.5',
      'effort xhigh',
      '⏸ plan mode',
      '~/git/workbench',
      'git:master',
    ])
  })

  test('leaves out what is not known', () => {
    const segments = layout({ ...FULL, effort: null, branch: null, cwd: null }, 120)

    expect(segments.map(segment => segment.id)).toEqual(['model', 'mode'])
    expect(layout({ ...FULL, model: null, effort: null, mode: null, cwd: null, branch: null }, 120)).toEqual([])
  })

  test('shortens the directory, then drops segments, to fit a narrow row', () => {
    const deep = { ...FULL, cwd: 'C:\\Users\\Admin\\git\\workbench\\mods\\statusbar\\deep\\deeper' }
    const wide = layout(deep, 90)
    const narrow = layout(deep, 40)
    const tiny = layout(deep, 24)

    expect(wide.map(segment => segment.id)).toEqual(['model', 'effort', 'mode', 'dir', 'branch'])
    expect(narrow.length).toBeLessThan(5)
    expect(tiny.map(segment => segment.id)).toEqual(['model', 'mode'])

    for (const [segments, columns] of [[wide, 90], [narrow, 40], [tiny, 24]] as const) {
      const width = segments.reduce((sum, segment) => sum + segment.text.length, 0) + 3 * (segments.length - 1)

      expect(width).toBeLessThanOrEqual(columns)
    }
  })

  test('colors the mode by what it is', () => {
    const colorOf = (mode: string) => buildSegments({ ...FULL, mode }, 32).find(s => s.id === 'mode')?.color

    expect(colorOf('plan')).toBe('planMode')
    expect(colorOf('auto')).toBe('autoAccept')
    expect(colorOf('bypassPermissions')).toBe('error')
    expect(colorOf('default')).toBe('inactive')
  })
})

// Monday 12 October 2026, 12:00 UTC.
const NOW = Date.parse('2026-10-12T12:00:00Z')

describe('reset times', () => {
  test('count down to a reset, rounded up to the minute', () => {
    expect(timeUntil('2026-10-12T14:14:00Z', NOW)).toBe('2h 14m')
    expect(timeUntil('2026-10-12T12:36:30Z', NOW)).toBe('37m')
    expect(timeUntil('2026-10-15T16:00:00Z', NOW)).toBe('3d 4h')
    expect(timeUntil('2026-10-12T11:00:00Z', NOW)).toBeNull()
    expect(timeUntil('soon', NOW)).toBeNull()
  })

  test('name the day and hour of a reset', () => {
    expect(resetDay('2026-10-12T12:00:00Z', 'pl-PL')).toMatch(/^pon \d\d:00$/)
    expect(resetDay('2026-10-16T09:30:00Z', 'en-GB')).toMatch(/^Fri \d\d:30$/)
    expect(resetDay('never')).toBeNull()
  })
})

describe('usageSegments', () => {
  test('shows context, five-hour and weekly use in per cent, colored by how full', () => {
    const segments = usageSegments(FULL, NOW, 'pl-PL')

    expect(segments.map(segment => segment.text)).toEqual(['context 34%', '5h 13%', 'week 81%', 'cache 47m'])
    expect(segments.map(segment => segment.color)).toEqual(['success', 'success', 'error', 'success'])
    expect(segments[0]?.detail).toBeUndefined()
    expect(segments[1]?.detail).toBe('↻ 2h 14m')
    expect(segments[2]?.detail).toMatch(/^↻ pon \d\d:00$/)
    expect(usageSegments({ ...FULL, contextPercent: 50 }, NOW)[0]?.color).toBe('warning')
  })

  test('leaves out what the session has not reported', () => {
    const bare = { ...FULL, fiveHourResetsAt: null, weekResetsAt: null, cacheWarmUntil: null }

    expect(usageSegments(bare, NOW).map(segment => segment.detail)).toEqual([undefined, undefined, undefined])
    expect(usageSegments({ ...FULL, fiveHourPercent: null, weekPercent: null, cacheWarmUntil: null }, NOW).map(s => s.id)).toEqual(['context'])
    expect(usageSegments({ ...FULL, contextPercent: null, fiveHourPercent: null, weekPercent: null, cacheWarmUntil: null }, NOW)).toEqual([])
  })
})

describe('cache segment', () => {
  const cache = (cacheWarmUntil: string | null) =>
    usageSegments({ ...FULL, cacheWarmUntil }, NOW).find(segment => segment.id === 'cache')

  test('counts down green, turns amber under five minutes, red once cold', () => {
    expect(cache('2026-10-12T12:47:00Z')).toMatchObject({ text: 'cache 47m', color: 'success' })
    expect(cache('2026-10-12T12:04:00Z')).toMatchObject({ text: 'cache 4m', color: 'warning' })
    expect(cache('2026-10-12T11:59:00Z')).toMatchObject({ text: 'cache cold', color: 'error' })
    expect(cache(null)).toBeUndefined()
  })

  test('the main thread is cached for an hour', () => {
    expect(CACHE_TTL_MS).toBe(3_600_000)
  })
})
