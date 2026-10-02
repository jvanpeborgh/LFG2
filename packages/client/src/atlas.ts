import { BufferPainter, type ItemDef, type Registry } from "@lfg/shared";

export const ATLAS_TILES = 16;
export const TILE = 16;

/** All block/item textures painted into one 256×256 atlas (16×16 tiles of 16 px). */
export class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly tileIndex = new Map<string, number>();
  private icons = new Map<number, string>();

  constructor(private reg: Registry, seed = 1) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = ATLAS_TILES * TILE;
    const ctx = this.canvas.getContext("2d")!;
    let i = 0;
    for (const def of reg.textures.values()) {
      if (i >= ATLAS_TILES * ATLAS_TILES) throw new Error("Texture atlas is full");
      const p = new BufferPainter(seed + i * 7919);
      def.paint(p);
      const img = new ImageData(new Uint8ClampedArray(p.data), TILE, TILE);
      ctx.putImageData(img, (i % ATLAS_TILES) * TILE, Math.floor(i / ATLAS_TILES) * TILE);
      this.tileIndex.set(def.name, i);
      i++;
    }
  }

  tile(name: string): number {
    return this.tileIndex.get(name) ?? 0;
  }

  /** Draw a tile into a 2D context. */
  drawTile(ctx: CanvasRenderingContext2D, name: string, dx: number, dy: number, size: number): void {
    const t = this.tile(name);
    ctx.drawImage(this.canvas, (t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE, TILE, TILE, dx, dy, size, size);
  }

  /** A data-URL icon for an item: an isometric cube for blocks, the flat sprite otherwise. */
  icon(itemId: number): string {
    const cached = this.icons.get(itemId);
    if (cached) return cached;
    const item = this.reg.itemById(itemId);
    const url = item ? this.renderIcon(item) : "";
    this.icons.set(itemId, url);
    return url;
  }

  private renderIcon(item: ItemDef): string {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const block = item.block !== undefined ? this.reg.blockById(item.block) : undefined;
    if (block && (block.render === "cube" || block.render === "cutout" || block.render === "translucent" || block.render === "liquid")) {
      const s = 16;
      // Top face.
      ctx.save();
      ctx.setTransform(1.5, 0.75, -1.5, 0.75, 24, 0);
      this.drawTile(ctx, block.faces.top, 0, 0, s);
      ctx.restore();
      // Left face (front).
      ctx.save();
      ctx.setTransform(1.5, 0.75, 0, 1.5, 0, 12);
      this.drawTile(ctx, block.faces.front ?? block.faces.side, 0, 0, s);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, s, s);
      ctx.restore();
      // Right face.
      ctx.save();
      ctx.setTransform(1.5, -0.75, 0, 1.5, 24, 24);
      this.drawTile(ctx, block.faces.side, 0, 0, s);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, s, s);
      ctx.restore();
    } else {
      const tex = block ? block.faces.side : item.texture ?? "";
      this.drawTile(ctx, tex, 4, 4, 40);
    }
    return c.toDataURL();
  }
}
