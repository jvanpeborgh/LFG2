import { hash32 } from "./random";
import type { TexturePainter } from "./registry";

export const TEXTURE_SIZE = 16;

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Paints into a plain RGBA buffer so textures can be generated anywhere (worker, server, tests). */
export class BufferPainter implements TexturePainter {
  readonly size = TEXTURE_SIZE;
  readonly data = new Uint8ClampedArray(TEXTURE_SIZE * TEXTURE_SIZE * 4);

  constructor(private seed: number) {}

  set(x: number, y: number, rgb: string | [number, number, number], alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const [r, g, b] = typeof rgb === "string" ? parseHex(rgb) : rgb;
    const i = (y * this.size + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = alpha;
  }

  fill(rgb: string | [number, number, number], alpha = 255): void {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, rgb, alpha);
  }

  rand(x: number, y: number, salt = 0): number {
    return hash32(this.seed, x, y, salt) / 4294967296;
  }

  shade(rgb: string, factor: number): [number, number, number] {
    const [r, g, b] = parseHex(rgb);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
    return [f(r), f(g), f(b)];
  }
}
