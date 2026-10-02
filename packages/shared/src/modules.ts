import { Registry } from "./registry";
import type { Standards } from "./standards";
import { registerVanillaContent } from "./vanilla/content";

/**
 * A module's shared part: content (blocks, items, recipes, textures, entity
 * types) that must exist identically on the server and on every client.
 * Server logic lives in the server package; client visuals in the client.
 */
export interface ContentModule {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  content?: (reg: Registry, standards: Standards) => void;
}

export const VANILLA_CONTENT: ContentModule = {
  id: "vanilla:content",
  name: "Vanilla content",
  version: "0.1.0",
  author: "lfg",
  description: "Blocks, items, tools, recipes, smelting, textures and mob models of the base game.",
  content: registerVanillaContent,
};

/** All content modules this build knows about, by id. */
export const CONTENT_MODULES: Record<string, ContentModule> = {
  [VANILLA_CONTENT.id]: VANILLA_CONTENT,
};

/** Build a registry from an ordered list of content module ids. */
export function buildRegistry(moduleIds: string[], standards: Standards, extra: ContentModule[] = []): Registry {
  const reg = new Registry();
  const known: Record<string, ContentModule> = { ...CONTENT_MODULES };
  for (const m of extra) known[m.id] = m;
  for (const id of moduleIds) {
    const m = known[id];
    if (!m) throw new Error(`Unknown content module "${id}"`);
    reg.currentModule = id;
    m.content?.(reg, standards);
  }
  reg.currentModule = "kernel";
  return reg;
}
