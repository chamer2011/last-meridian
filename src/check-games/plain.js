// Used if a skill has no game of its own: just the roll, with the odds laid out.

import { panel, say } from "./kit.js";

export default {
  start: () => ({ done: true, forced: false }),
  intro: () => [say("Nothing to do here but commit.", "dim")],
  view: (state, ctx) => ({
    panels: [panel("terminal", ctx.text.consoles?.terminal ?? "Console", [], { terminal: true })],
    commands: [],
    meters: [],
  }),
  act: () => null,
  edge: () => 0,
  story: () => "They went straight at it.",
};
