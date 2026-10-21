import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Keep the raster icons in sync with public/favicon.svg.
const asset = (name) => new URL(`../public/${name}`, import.meta.url);
const svg = await readFile(asset("favicon.svg"));
const render = (size) => sharp(svg, { density: 72 * size / 32 }).resize(size, size);
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => render(size).png().toBuffer()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;

for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}

await writeFile(asset("favicon.ico"), Buffer.concat([directory, ...images]));
await writeFile(asset("apple-touch-icon.png"), await render(180)
  .flatten({ background: "#8251d4" })
  .png()
  .toBuffer());
