import type { ServerModule } from "../../packages/server/src/kernel";

/**
 * Example world module that adds a new rule: holding a feather in your hand
 * stops fall damage. Shows how a module changes game rules through events.
 *
 * Try it: /module install feather-fall
 */
const featherFall: ServerModule = {
  id: "example:feather-fall",
  name: "Feather fall",
  version: "1.0.0",
  author: "example",
  description: "Holding a feather cancels fall damage.",
  setup(api) {
    const feather = api.reg.item("feather").id;
    api.on("entity:damage", (e) => {
      if (e.source.kind !== "fall") return;
      const p = api.playerOf(e.entity);
      if (p?.heldStack?.item === feather) {
        e.cancelled = true;
        api.tell(p, "Your feather breaks the fall.");
      }
    });
  },
};

export default featherFall;
