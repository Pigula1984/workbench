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

### workflow

While a dynamic workflow runs, the band above the prompt (terminal and
desktop surfaces) shows its steps under the statusbar's rows, one row per run,
after the workflow's name:

```
Report analyzes: Collect (3/3) -> Analyze (1/3) -> Summarize
```

The name is the script's `meta.name` (as the Workflow tool answers it, in bold)
with dashes and underscores read as spaces and its first letter capitalised:
`report-analyzes` reads `Report analyzes`.

| Step | Color |
| --- | --- |
| finished | green |
| current: agents still working, or the last step started while the script is between phases | blue, bold |
| not started yet | grey, no count |
| where a failed or stopped (`failed`, `killed`) run ended | red, bold |

`(finished/started)` counts the step's agents whose turn has ended against
those started so far. A run that completes shows every started step done.
A run that ended stays on screen until the next prompt you send. The band
gives way to a survey.

The two mods share the band: `hooks/register.tsx` registers the workflow mod
first, so its hook is the outer one, takes the statusbar's tree from `next(e)`
and adds its rows under it.

| What | Where it comes from |
| --- | --- |
| the steps, in order | `meta.phases` of the run's script, read from the `scriptPath` the Workflow tool answers; a phase no `meta` entry declares follows them, an agent under no phase counts under the workflow's name |
| each agent | `agent.spawn` with `workflow.runId`; its phase from `agent-<id>.meta.json` (`workflowPhase`) in the run's `transcriptDir`, read when it starts and when it ends |
| an agent finished | its `turn.complete` |
| how the run ended | the task's notification row (`UserMessage`, `task.status`) |

A resumed run keeps its finished agents; agents replayed from the run's journal
or retried after a stall raise no event, so the counts show only live ones
until the run completes. A run launched before the plugin loaded is not shown.
The engine's own progress row for the run (the squares, `2/3 · 13s · tokens`)
stays: it is drawn outside every site a plugin can hook.

## Layout

```
.claude-plugin/plugin.json   manifest (name: workbench)
hooks/hooks.json             names the one hooks module
hooks/register.tsx           composes the mods
mods/statusbar/              the statusbar mod (statusbar.tsx has every `$` call)
mods/workflow/               the workflow mod (workflow.tsx has every `$` call)
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

### Install it for every session

Clone the repository, add the clone as a marketplace and install the plugin
from it. The marketplace's entry is a relative path (`"source": "./"`), so
Claude Code reads the plugin from the clone itself, not from a copy: after a
`git pull` or an edit, `/reload-plugins` in a running session picks it up.

Windows (PowerShell):

```powershell
git clone https://github.com/Pigula1984/workbench.git $HOME\git\workbench
claude plugin marketplace add $HOME\git\workbench
claude plugin install workbench@workbench
```

macOS and Linux:

```sh
git clone https://github.com/Pigula1984/workbench.git ~/git/workbench
claude plugin marketplace add ~/git/workbench
claude plugin install workbench@workbench
```

Any folder will do in place of `git/workbench`. `/plugin` turns it off and on
again; to remove it:

```
claude plugin uninstall workbench@workbench
claude plugin marketplace remove workbench
```

Without a clone, `claude plugin marketplace add Pigula1984/workbench` adds the
GitHub repository itself; the plugin then runs a copy made at install, which
`claude plugin update workbench@workbench` refreshes.

### Try it for one session

```sh
claude --plugin-dir <path to the clone>
```

### Work on the mods

Name the clone in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of
`~/.claude/settings.json` (several folders are separated by `;` on Windows,
`:` on macOS and Linux). Every session loads it as a `--plugin-dir`, and an
interactive one watches the folder: a saved file reloads the mods at once.
Use this or the install above, not both, or the plugin loads twice.

Windows (`%USERPROFILE%\.claude\settings.json`; backslashes doubled in JSON):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<you>\\git\\workbench" } }
```

macOS:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<you>/git/workbench" } }
```

Linux:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/<you>/git/workbench" } }
```

`~` works in place of the home folder.

## Check it

```
claude plugin validate .
claude plugin test .
```
