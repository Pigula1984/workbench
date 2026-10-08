import type { Register } from 'claude-code'

import { registerStatusbar } from '../mods/statusbar/statusbar'
import { registerWorkflow } from '../mods/workflow/workflow'

// One plugin, several mods: each mod is a folder under mods/ that exports a
// register function, and this module composes them. A new mod is one import
// and one call here.
//
// A plugin's hooks nest in the order they are registered, the first outermost.
// The workflow mod goes first: its band hook wraps the statusbar's rows and
// adds the workflow's steps under them.
export const register: Register = on => {
  registerWorkflow(on)
  registerStatusbar(on)
}
