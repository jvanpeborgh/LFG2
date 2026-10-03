import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { dominantColors } from "@lfg/shared";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Colours from reference images (sent by a chat through the MCP server). Only
 * the dominant colours are kept; the images themselves are never stored or
 * shown to anyone, so a reference can set a mood without copying a picture.
 */
export function colorsFromImage(base64: string, mime?: string): { colors: string[] } | { error: string } {
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(clean, "base64");
  if (!buf.length) return { error: "the image is empty" };
  if (buf.length > MAX_BYTES) return { error: "the image is over 4 MB" };
  const isPng = buf.subarray(0, 4).toString("hex") === "89504e47" || mime === "image/png";
  const isJpeg = buf.subarray(0, 2).toString("hex") === "ffd8" || mime === "image/jpeg";
  try {
    if (isPng) {
      const png = PNG.sync.read(buf);
      return { colors: dominantColors(png.data, png.width, png.height).map((c) => c.hex) };
    }
    if (isJpeg) {
      const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
      return { colors: dominantColors(img.data, img.width, img.height).map((c) => c.hex) };
    }
  } catch (e) {
    return { error: `couldn't read the image: ${e instanceof Error ? e.message : e}` };
  }
  return { error: "only PNG and JPEG images can be read; or send its main colours as reference_colors" };
}
