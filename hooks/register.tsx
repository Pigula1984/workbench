import type { Register } from 'claude-code'

import { registerStatusbar } from '../mods/statusbar/statusbar'

// One plugin, several mods: each mod is a folder under mods/ that exports a
// register function, and this module composes them. A new mod is one import
// and one call here.
export const register: Register = on => {
  registerStatusbar(on)
}
