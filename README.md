# workbench

One Claude Code plugin, several small mods that put live session data around
the prompt box. Each mod is a folder under `mods/`; `hooks/register.tsx`
composes them.

## Mods

### statusbar

A two-row band above the prompt (terminal and desktop surfaces), after one blank line:

```
Opus 5.5 · effort high · ⏵⏵ auto mode · ~/git/workbench · git:main · API $3.46
context 34% · 5h 13% ↻ 2h 14m · week 81% ↻ pon 14:00 · cache 47m
```

First row:

| Segment | Where it comes from |
| --- | --- |
| model | `$.session.model()` at start, `classic.PostModelSwitch` on `/model`, the model of each `turn.step` |
| effort | `effortLevel` from settings (a per-model entry first), `/effort`, the effort of each `turn.step` |
| mode | `permission_mode_changed` { to_mode }, which the CLI logs for an OpenTelemetry collector on every switch (read only, passed on unchanged); the permission mode on the classic events (`UserPromptSubmit`, `Stop`, `PostToolUse`, ...); the prompt footer's brief `... mode on` flash after Shift+Tab |
| directory | `$.session.cwd()`, `classic.CwdChanged`; home shown as `~` |
| branch | `git branch --show-current`, refreshed after each turn, after Bash calls and every 5 s |
| API cost | `$.session.usage().cost.usd`: what the session would have cost at API prices, as `/cost` totals it, even on a subscription; dimmed |

Second row. Context, 5h and week come from `$.session.usage()`, refreshed after each response, at the end of a turn, after a compaction and every 5 s; cache is counted by the mod itself:

| Segment | What it shows | Colors |
| --- | --- | --- |
| context | how full the context window is (`context.percent`) | green < 50 %, amber 50–80 %, red > 80 % |
| 5h | the five-hour rate-limit window used, and `↻` the time left until it resets | same |
| week | the weekly rate-limit window used, and `↻` the local day and hour it resets | same |
| cache | how long the prompt cache stays warm: a countdown of 1 h (the TTL the CLI uses for the main thread) from the last main-thread response; cleared on a model switch, since the new model has no cache yet. Plugins are not told the TTL, so this is the CLI's rule, not a reading | green, amber under 5 min, red `cache cold` |

The countdowns redraw every 30 s. A value the session has not reported yet
(before the first response, or rate limits on an API key) is left out.

On a narrow terminal the directory shortens first, then first-row segments
drop: API cost, effort, directory, branch, model, mode. The band gives way to
a survey.

## Layout

```
.claude-plugin/plugin.json   manifest (name: workbench)
hooks/hooks.json             names the one hooks module
hooks/register.tsx           composes the mods
mods/statusbar/              the statusbar mod (statusbar.tsx has every `$` call)
types/index.d.ts             the plugin's `$.state` contract
tests/                       claude plugin test .
```

The engine follows `$` only into functions declared in the same file, so each
mod keeps its `$` calls and its atoms in one file and its pure helpers
(formatting, layout) in others, where the tests reach them directly.

A new mod: add `mods/<name>/<name>.tsx` exporting `register<Name>(on)`, call it
from `hooks/register.tsx`, and declare its state under `workbench` in
`types/index.d.ts`.

## Run it

```
claude --plugin-dir C:\Users\Admin\git\workbench
```

Or install it for every session from this folder (edits show after `/reload-plugins`):

```
claude plugin marketplace add C:\Users\Admin\git\workbench
claude plugin install workbench@workbench
```

## Check it

```
claude plugin validate .
claude plugin test .
```
