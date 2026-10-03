import type { ServerModule } from "../kernel";
import { building } from "./vanilla/building";
import { builds } from "./vanilla/builds";
import { combat } from "./vanilla/combat";
import { commands } from "./vanilla/commands";
import { containers } from "./vanilla/containers";
import { explosives } from "./vanilla/explosives";
import { items } from "./vanilla/items";
import { mobs } from "./vanilla/mobs";
import { nature } from "./vanilla/nature";
import { powers } from "./vanilla/powers";
import { progression } from "./vanilla/progression";
import { scenarios } from "./vanilla/scenarios";
import { summons } from "./vanilla/summons";
import { survival } from "./vanilla/survival";

/**
 * The base game, as modules. Order matters only for handlers with equal
 * priority. Agent-written modules will be added to (or replace entries in)
 * this list at runtime.
 */
export const VANILLA_MODULES: ServerModule[] = [
  nature,
  building,
  explosives,
  items,
  survival,
  combat,
  mobs,
  containers,
  progression,
  powers,
  summons,
  scenarios,
  builds,
  commands,
];
