import { BufferPainter, type ItemDef, type Registry } from "@lfg/shared";

export const ATLAS_TILES = 16;
export const TILE = 16;

/** All block/item textures painted into one 256×256 atlas (16×16 tiles of 16 px). */
export class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly tileIndex = new Map<string, number>();
  private icons = new Map<number, string>();

  constructor(private reg: Registry, private seed = 1) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = ATLAS_TILES * TILE;
    this.paint();
  }

  /**
   * (Re)paint every texture. Textures are code that reads the world palette,
   * so after a palette rule change this restyles the whole world.
   */
  paint(): void {
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.icons.clear();
    const seed = this.seed;
    let i = 0;
    for (const def of this.reg.textures.values()) {
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
  /**
   * A piece of creature gear: its kind's icon, repainted in the creature's colours (the base icon
   * is drawn in marker red for the main colour and marker blue for the accent).
   */
  gearIcon(itemId: number, main: string, accent: string): string {
    const key = `${itemId}:${main}:${accent}`;
    const cached = this.gearIcons.get(key);
    if (cached) return cached;
    const item = this.reg.itemById(itemId);
    if (!item?.texture) return this.icon(itemId);
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    this.drawTile(ctx, item.texture, 4, 4, 40);
    const d = ctx.getImageData(0, 0, 48, 48);
    const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const M = hex(main), A = hex(accent);
    for (let i = 0; i < d.data.length; i += 4) {
      const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
      // Marker pixels (allowing for the per-pixel shading the painter adds).
      if (r > 150 && g < 80 && b < 80) { const k = r / 255; d.data[i] = M[0] * k; d.data[i + 1] = M[1] * k; d.data[i + 2] = M[2] * k; }
      else if (b > 150 && r < 80 && g < 80) { const k = b / 255; d.data[i] = A[0] * k; d.data[i + 1] = A[1] * k; d.data[i + 2] = A[2] * k; }
    }
    ctx.putImageData(d, 0, 0);
    const url = c.toDataURL();
    this.gearIcons.set(key, url);
    return url;
  }
  private gearIcons = new Map<string, string>();

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
