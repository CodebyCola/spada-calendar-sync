import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBytes, data, crcOut]);
}

function createPromoTilePng(width, height) {
  const raw = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    const t = y / height;

    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      // Clean SPADA UPNYK navy-to-slate gradient background
      let r = Math.round(15 + t * 10);
      let g = Math.round(61 + t * 24);
      let b = Math.round(110 + t * 40);

      // Centered calendar card graphic
      const cardLeft = width * 0.34;
      const cardRight = width * 0.66;
      const cardTop = height * 0.18;
      const cardBottom = height * 0.82;
      const headerBottom = height * 0.34;

      if (x >= cardLeft && x <= cardRight && y >= cardTop && y <= cardBottom) {
        if (y <= headerBottom) {
          r = 245;
          g = 158;
          b = 11;
        } else {
          r = 248;
          g = 250;
          b = 252;

          // Subtle checklist bars inside the card
          const barLeft = cardLeft + 22;
          const barRight = cardRight - 22;
          const isBar1 = y >= height * 0.44 && y <= height * 0.49 && x >= barLeft && x <= barRight;
          const isBar2 =
            y >= height * 0.56 && y <= height * 0.61 && x >= barLeft && x <= barRight - 24;
          const isBar3 =
            y >= height * 0.68 && y <= height * 0.73 && x >= barLeft && x <= barRight - 10;

          if (isBar1 || isBar2 || isBar3) {
            r = 15;
            g = 61;
            b = 110;
          }
        }
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = join(process.cwd(), "store-assets");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "promo-small-440x280.png"), createPromoTilePng(440, 280));
console.log("Generated store-assets/promo-small-440x280.png");
