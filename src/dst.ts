import type { StitchPoint } from "./types";

const MM_TO_DST = 10;

function encodeDelta(delta: number, bits: [number, number, number]): number {
  let value = 0;
  let remaining = Math.round(delta);
  const weights = [1, 9, 27];
  for (let i = 2; i >= 0; i -= 1) {
    const weight = weights[i];
    if (remaining >= weight) {
      value |= bits[i];
      remaining -= weight;
    } else if (remaining <= -weight) {
      value |= bits[i] << 1;
      remaining += weight;
    }
  }
  return value;
}

function encodeRecord(dxTenthMm: number, dyTenthMm: number, command: StitchPoint["cmd"]): [number, number, number] {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0x03;

  b0 |= encodeDelta(dxTenthMm, [0x01, 0x04, 0x10]);
  b1 |= encodeDelta(dxTenthMm, [0x01, 0x04, 0x10]) >> 1;
  b0 |= encodeDelta(-dyTenthMm, [0x02, 0x08, 0x20]);
  b1 |= encodeDelta(-dyTenthMm, [0x02, 0x08, 0x20]) >> 1;

  if (command === "jump" || command === "trim") {
    b2 = 0x83;
  } else if (command === "color_change") {
    b2 = 0xc3;
  } else {
    b2 = 0x03;
  }

  return [b0 & 0xff, b1 & 0xff, b2 & 0xff];
}

function headerLine(label: string, value: string) {
  return `${label}:${value}`.padEnd(16, " ");
}

export function exportDst(stitches: StitchPoint[]): Blob {
  let x = 0;
  let y = 0;
  let stitchCount = 0;
  let colorCount = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  const bytes: number[] = [];

  for (const stitch of stitches) {
    if (stitch.cmd === "color_change") {
      bytes.push(...encodeRecord(0, 0, "color_change"));
      colorCount += 1;
      continue;
    }
    if (stitch.x === undefined || stitch.y === undefined) {
      continue;
    }
    const nextX = Math.round(stitch.x * MM_TO_DST);
    const nextY = Math.round(stitch.y * MM_TO_DST);
    const dx = nextX - x;
    const dy = nextY - y;
    bytes.push(...encodeRecord(dx, dy, stitch.cmd));
    x = nextX;
    y = nextY;
    stitchCount += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  bytes.push(0x00, 0x00, 0xf3);

  const header =
    headerLine("LA", "MVP") +
    headerLine("ST", String(stitchCount).padStart(7, "0")) +
    headerLine("CO", String(Math.max(colorCount + 1, 1)).padStart(3, "0")) +
    headerLine("+X", String(maxX).padStart(5, "0")) +
    headerLine("-X", String(Math.abs(minX)).padStart(5, "0")) +
    headerLine("+Y", String(maxY).padStart(5, "0")) +
    headerLine("-Y", String(Math.abs(minY)).padStart(5, "0")) +
    headerLine("AX", String(x).padStart(6, "0")) +
    headerLine("AY", String(y).padStart(6, "0")) +
    headerLine("MX", "000000") +
    headerLine("MY", "000000") +
    "PD:******".padEnd(16, " ");

  const headerBytes = new TextEncoder().encode(header.padEnd(512, " "));
  const bodyBytes = Uint8Array.from(bytes);
  return new Blob([headerBytes, bodyBytes], { type: "application/octet-stream" });
}
