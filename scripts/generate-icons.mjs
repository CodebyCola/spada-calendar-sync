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

function createRoundedBadgePng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const radius = size * 0.22;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.max(0, Math.abs(x - cx) - (size / 2 - radius));
      const dy = Math.max(0, Math.abs(y - cy) - (size / 2 - radius));
      const inRoundedRect = dx * dx + dy * dy <= radius * radius;

      if (!inRoundedRect) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      // Deep navy-blue SPADA UPNYK palette (#0F3D6E) with gold calendar bar (#F59E0B)
      const isTopBar = y >= size * 0.2 && y <= size * 0.34 && x >= size * 0.2 && x <= size * 0.8;
      const isBody = y > size * 0.34 && y <= size * 0.8 && x >= size * 0.2 && x <= size * 0.8;
      const isCheck =
        isBody &&
        ((Math.abs(y - (size * 0.62 - (x - size * 0.45) * 0.9)) < size * 0.06 &&
          x >= size * 0.43 &&
          x <= size * 0.68) ||
          (Math.abs(y - (size * 0.56 + (x - size * 0.36) * 0.9)) < size * 0.06 &&
            x >= size * 0.32 &&
            x <= size * 0.46));

      if (isTopBar) {
        raw[px] = 245;
        raw[px + 1] = 158;
        raw[px + 2] = 11;
        raw[px + 3] = 255;
      } else if (isCheck) {
        raw[px] = 15;
        raw[px + 1] = 61;
        raw[px + 2] = 110;
        raw[px + 3] = 255;
      } else if (isBody) {
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
        raw[px + 3] = 255;
      } else {
        raw[px] = 15;
        raw[px + 1] = 61;
        raw[px + 2] = 110;
        raw[px + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
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

const outDir = join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), createRoundedBadgePng(size));
}

console.log("Generated PNG icons (16, 48, 128) in public/icons/");
