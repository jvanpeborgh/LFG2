import type { ServerModule } from "../../packages/server/src/kernel";

/**
 * Deliberately broken example: it passes the shadow run (it only fails once
 * it has been live for 3 seconds), then throws on every tick. The kernel
 * contains the errors, switches it off, and the world event is undone
 * automatically. Nobody gets disconnected.
 */
const brokenOnPurpose: ServerModule = {
  id: "example:broken-on-purpose",
  name: "Unstable portal",
  version: "1.0.0",
  author: "example",
  description: "Breaks a few seconds after arriving, to show automatic undo.",
  setup(api) {
    let alive = 0;
    api.on("tick", ({ dt }) => {
      alive += dt;
      if (alive > 3) throw new Error("the portal collapsed");
    });
  },
};

export default brokenOnPurpose;
