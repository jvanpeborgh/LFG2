// A contact sheet of renders: the 3/4 view (top-left panel) of each viewer render in one grid,
// for reviewing a set of designs at a glance.
//   node scripts/contact-sheet.mjs out.jpg render1.jpg render2.jpg ...
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../packages/server/package.json", import.meta.url));
const jpeg = require("jpeg-js");
const [out, ...files] = process.argv.slice(2);
const W = 426, H = 400, cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
const sheet = Buffer.alloc(W * cols * H * rows * 4, 255);
files.forEach((f, i) => {
  const img = jpeg.decode(readFileSync(f), { useTArray: true });
  const ox = (i % cols) * W, oy = Math.floor(i / cols) * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * img.width + x) * 4, d = ((oy + y) * W * cols + ox + x) * 4;
    sheet[d] = img.data[s]; sheet[d + 1] = img.data[s + 1]; sheet[d + 2] = img.data[s + 2]; sheet[d + 3] = 255;
  }
});
writeFileSync(out, jpeg.encode({ data: sheet, width: W * cols, height: H * rows }, 85).data);
console.log(`${out}: ${files.length} renders`);
