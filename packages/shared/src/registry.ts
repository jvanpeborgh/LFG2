import { hashString } from "./random";

/**
 * The content registry: every block, item, recipe, texture and entity type in
 * the world. Modules add to it through their `content` function, which runs in
 * the same order on server and client so numeric ids match on both sides.
 */

export type ToolType = "pickaxe" | "axe" | "shovel" | "sword";
export type RenderKind = "cube" | "cutout" | "cross" | "liquid" | "translucent" | "none";

/** 0 = hand, 1 = wood, 2 = stone, 3 = iron, 4 = diamond. */
export type ToolTier = 0 | 1 | 2 | 3 | 4;

export interface DropDef {
  item: string;
  count?: number;
  /** Chance 0..1 (default 1). */
  chance?: number;
}

export interface BlockFaces {
  top: string;
  bottom: string;
  side: string;
  /** Optional distinct front face (furnace). Faces +Z when placed. */
  front?: string;
}

export interface BlockDef {
  id: number;
  name: string;
  displayName: string;
  /** Collides with bodies. */
  solid: boolean;
  /** Hides neighbouring faces and blocks light. */
  opaque: boolean;
  render: RenderKind;
  faces: BlockFaces;
  /** Seconds-ish base hardness; -1 = unbreakable. */
  hardness: number;
  tool?: ToolType;
  /** Minimum tool tier needed to get drops. 0 = anything. */
  minTier: ToolTier;
  /** What breaking it gives. Default: the block itself. Empty array = nothing. */
  drops?: DropDef[];
  /** Light emitted, 0..15. */
  light: number;
  /** The colour of that light (0..1 per channel). Torches are warm; magic and neon can be anything. */
  lightColor?: [number, number, number];
  /** Falls when unsupported (sand, gravel). */
  gravity: boolean;
  /** Can be replaced by placing a block into it (air, water, tall grass). */
  replaceable: boolean;
  liquid: boolean;
  /** Breaks when the block below is removed (flowers, torches). */
  needsSupport: boolean;
  /** Block opens a window when used. */
  container?: "crafting" | "chest" | "furnace";
  /** Primary colour used for particles and map. */
  color: string;
  /** Free-form tags modules can use ("flammable", "plant", "ore", ...). */
  tags: string[];
}

export interface ToolDef {
  type: ToolType;
  tier: ToolTier;
  /** Dig speed multiplier when used on the right block. */
  speed: number;
  durability: number;
}

export interface ItemDef {
  id: number;
  name: string;
  displayName: string;
  maxStack: number;
  /** Places this block when used on a block face. */
  block?: number;
  tool?: ToolDef;
  /** Melee damage (default: hand damage). */
  damage?: number;
  /** Hunger points restored when eaten (out of 20). */
  food?: number;
  /** Seconds of furnace fuel. */
  fuel?: number;
  /** Texture name for non-block items. */
  texture?: string;
  tags: string[];
}

export interface ShapedRecipe {
  kind: "shaped";
  pattern: string[];
  key: Record<string, string>;
  result: { item: string; count: number };
}

export interface ShapelessRecipe {
  kind: "shapeless";
  ingredients: string[];
  result: { item: string; count: number };
}

export type RecipeDef = ShapedRecipe | ShapelessRecipe;

export interface SmeltingDef {
  input: string;
  output: string;
  seconds: number;
}

/** A 16×16 RGBA texture painted in code (standards: procedural first). */
export interface TexturePainter {
  readonly size: number;
  set(x: number, y: number, rgb: string | [number, number, number], alpha?: number): void;
  fill(rgb: string | [number, number, number], alpha?: number): void;
  /** Deterministic random in [0,1) for (x, y, salt). */
  rand(x: number, y: number, salt?: number): number;
  /** Shade a colour by a factor (1 = same, 0.8 = darker, 1.2 = lighter). */
  shade(rgb: string, factor: number): [number, number, number];
}

export interface TextureDef {
  name: string;
  paint(p: TexturePainter): void;
}

/** A box in an entity model, in 1/16 block units, relative to the entity's feet centre. */
export interface ModelPart {
  name: string;
  /** Size in pixels (1/16 block). */
  size: [number, number, number];
  /** Pivot position in pixels relative to feet centre. */
  pivot: [number, number, number];
  /** Box offset from pivot in pixels (box min corner). */
  offset: [number, number, number];
  color: string;
  /** Optional face colour for the +Z (front) face, e.g. a face. */
  frontColor?: string;
  /** Animation role. */
  anim?: "legL" | "legR" | "armL" | "armR" | "head" | "wingL" | "wingR";
}

export interface EntityTypeDef {
  name: string;
  displayName: string;
  /** Collision box width/height in blocks. */
  width: number;
  height: number;
  maxHealth: number;
  kind: "player" | "passive" | "hostile" | "item" | "object";
  model: ModelPart[];
  tags: string[];
  /** Generated summons: built from this spec (server and clients generate the same voxel model). */
  summon?: import("./summons/spec").SummonSpec;
}

export interface ItemStack {
  item: number;
  count: number;
  /** Uses left for tools. */
  durability?: number;
}

type PartialBlock = Partial<Omit<BlockDef, "id" | "name" | "faces">> & { faces: BlockFaces | string };
type PartialItem = Partial<Omit<ItemDef, "id" | "name">>;

export class Registry {
  readonly blocks: BlockDef[] = [];
  readonly items: ItemDef[] = [];
  readonly recipes: RecipeDef[] = [];
  readonly smelting: SmeltingDef[] = [];
  readonly textures = new Map<string, TextureDef>();
  readonly entityTypes = new Map<string, EntityTypeDef>();
  private blockByName = new Map<string, BlockDef>();
  private itemByName = new Map<string, ItemDef>();
  /** Which module registered each thing (for the inspector). */
  readonly origin = new Map<string, string>();
  /** Module currently registering content. */
  currentModule = "kernel";

  constructor() {
    this.addBlock("air", {
      displayName: "Air",
      solid: false,
      opaque: false,
      render: "none",
      faces: "none",
      hardness: -1,
      replaceable: true,
      drops: [],
    });
  }

  addBlock(name: string, def: PartialBlock): BlockDef {
    if (this.blockByName.has(name)) throw new Error(`Block "${name}" already registered`);
    const faces = typeof def.faces === "string" ? { top: def.faces, bottom: def.faces, side: def.faces } : def.faces;
    const block: BlockDef = {
      id: this.blocks.length,
      name,
      displayName: def.displayName ?? name,
      solid: def.solid ?? true,
      opaque: def.opaque ?? true,
      render: def.render ?? "cube",
      faces,
      hardness: def.hardness ?? 1,
      tool: def.tool,
      minTier: def.minTier ?? 0,
      drops: def.drops,
      light: def.light ?? 0,
      lightColor: def.lightColor,
      gravity: def.gravity ?? false,
      replaceable: def.replaceable ?? false,
      liquid: def.liquid ?? false,
      needsSupport: def.needsSupport ?? false,
      container: def.container,
      color: def.color ?? "#888888",
      tags: def.tags ?? [],
    };
    if (block.id > 0xfff) throw new Error("Too many block types");
    this.blocks.push(block);
    this.blockByName.set(name, block);
    this.origin.set(`block:${name}`, this.currentModule);
    if (name !== "air") {
      this.addItem(name, { displayName: block.displayName, block: block.id, maxStack: 64 });
    }
    return block;
  }

  addItem(name: string, def: PartialItem): ItemDef {
    if (this.itemByName.has(name)) throw new Error(`Item "${name}" already registered`);
    const item: ItemDef = {
      id: this.items.length + 1, // 0 is reserved for "nothing"
      name,
      displayName: def.displayName ?? name,
      maxStack: def.tool ? 1 : def.maxStack ?? 64,
      block: def.block,
      tool: def.tool,
      damage: def.damage,
      food: def.food,
      fuel: def.fuel,
      texture: def.texture,
      tags: def.tags ?? [],
    };
    this.items.push(item);
    this.itemByName.set(name, item);
    this.origin.set(`item:${name}`, this.currentModule);
    return item;
  }

  addRecipe(recipe: RecipeDef): void {
    this.recipes.push(recipe);
  }

  addSmelting(def: SmeltingDef): void {
    this.smelting.push(def);
  }

  addTexture(def: TextureDef): void {
    this.textures.set(def.name, def);
  }

  addEntityType(def: EntityTypeDef): void {
    this.entityTypes.set(def.name, def);
    this.origin.set(`entity:${def.name}`, this.currentModule);
  }

  block(name: string): BlockDef {
    const b = this.blockByName.get(name);
    if (!b) throw new Error(`Unknown block "${name}"`);
    return b;
  }

  hasBlock(name: string): boolean {
    return this.blockByName.has(name);
  }

  blockId(name: string): number {
    return this.block(name).id;
  }

  blockById(id: number): BlockDef {
    return this.blocks[id] ?? this.blocks[0];
  }

  item(name: string): ItemDef {
    const it = this.itemByName.get(name);
    if (!it) throw new Error(`Unknown item "${name}"`);
    return it;
  }

  hasItem(name: string): boolean {
    return this.itemByName.has(name);
  }

  itemById(id: number): ItemDef | undefined {
    return this.items[id - 1];
  }

  itemForBlock(blockId: number): ItemDef | undefined {
    const b = this.blocks[blockId];
    return b ? this.itemByName.get(b.name) : undefined;
  }

  stack(name: string, count = 1): ItemStack {
    const def = this.item(name);
    const s: ItemStack = { item: def.id, count };
    if (def.tool) s.durability = def.tool.durability;
    return s;
  }

  /** Fingerprint of the registry so client and server can check they match. */
  fingerprint(): number {
    const parts = [
      ...this.blocks.map((b) => `b${b.id}:${b.name}`),
      ...this.items.map((i) => `i${i.id}:${i.name}`),
      // Generated summon types are sent to clients as they appear (and on join), so they're not part
      // of the content both sides must already share.
      ...[...this.entityTypes.values()].filter((e) => !e.summon).map((e) => `e:${e.name}`),
    ];
    return hashString(parts.join("|"));
  }
}
