# workbench

One Claude Code plugin, several small mods that put live session data around
the prompt box. Each mod is a folder under `mods/`; `hooks/register.tsx`
composes them.

## Mods

### statusbar

A one-row band above the prompt (terminal and desktop surfaces):

```
Sonnet 5.5 · effort xhigh · ⏸ plan mode · ~/git/workbench · git:master
context 34% · 5h 13% ↻ 2h 14m · week 81% ↻ pon 14:00
```

| Segment | Where it comes from |
| --- | --- |
| model | `$.session.model()` at start, `classic.PostModelSwitch` on `/model`, the model of each `turn.step` |
| effort | `effortLevel` from settings (a per-model entry first), `/effort`, the effort of each `turn.step` |
| mode | `permission_mode_changed` { to_mode }, which the CLI logs for an OpenTelemetry collector on every switch (read only, passed on unchanged); the permission mode on the classic events (`UserPromptSubmit`, `Stop`, `PostToolUse`, ...); the prompt footer's brief `... mode on` flash after Shift+Tab |
| directory | `$.session.cwd()`, `classic.CwdChanged`; home shown as `~` |
| branch | `git branch --show-current`, refreshed after each turn, after Bash calls and every 5 s |
| context / 5h / week / cache | `$.session.usage()`: `context.percent` and the `five_hour` / `seven_day` rate limits with their `resetsAt` (5h as a countdown redrawn every 30 s, the week as the local day and hour), after each response, at the end of a turn, after a compaction and every 5 s; green below 50 %, amber to 80 %, red above; a value not reported yet is left out. `cache` counts down from the last main-thread response: 1 h, the TTL the CLI uses for the main thread (amber under 5 min, red when cold) |

On a narrow terminal the directory shortens first, then segments drop
(effort, directory, branch, model, mode). The band gives way to a survey.

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
