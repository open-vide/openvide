/**
 * Minimal QR code text encoder — zero dependencies.
 * Generates a QR code as an array of strings using Unicode block characters.
 * Supports byte-mode encoding with error correction level L.
 */

// ── Galois Field GF(256) arithmetic ──

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(count: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < count; i++) {
    const next = new Uint8Array(gen.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < gen.length; j++) {
      next[j] = (next[j]! ^ gen[j]!) & 0xff;
      next[j + 1] = (next[j + 1]! ^ gfMul(gen[j]!, factor)) & 0xff;
    }
    gen = next;
  }
  return gen;
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const result = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const coef = (data[i]! ^ result[0]!) & 0xff;
    for (let j = 0; j < ecCount - 1; j++) {
      result[j] = (result[j + 1]! ^ gfMul(gen[j + 1]!, coef)) & 0xff;
    }
    result[ecCount - 1] = gfMul(gen[ecCount]!, coef);
  }
  return result;
}

// ── QR version capacity table (byte mode, EC level L) ──
// Each entry: [totalDataCodewords, ecCodewordsPerBlock, numBlocks1, dataPerBlock1, numBlocks2?, dataPerBlock2?]
const VERSION_TABLE: number[][] = [
  /*  1 */ [19, 7, 1, 19],
  /*  2 */ [34, 10, 1, 34],
  /*  3 */ [55, 15, 1, 55],
  /*  4 */ [80, 20, 1, 80],
  /*  5 */ [108, 26, 1, 108],
  /*  6 */ [136, 18, 2, 68],
  /*  7 */ [156, 20, 2, 78],
  /*  8 */ [194, 24, 2, 97],
  /*  9 */ [232, 30, 2, 116],
  /* 10 */ [274, 18, 2, 68, 2, 69],
  /* 11 */ [324, 20, 4, 81],
  /* 12 */ [370, 24, 2, 92, 2, 93],
  /* 13 */ [428, 26, 4, 107],
  /* 14 */ [461, 30, 3, 115, 1, 116],
  /* 15 */ [523, 22, 5, 87, 1, 88],
  /* 16 */ [589, 24, 5, 98, 1, 99],
  /* 17 */ [647, 28, 1, 107, 5, 108],
  /* 18 */ [721, 30, 5, 120, 1, 121],
  /* 19 */ [795, 28, 3, 113, 4, 114],
  /* 20 */ [861, 28, 3, 107, 5, 108],
  /* 21 */ [932, 28, 4, 116, 4, 117],
  /* 22 */ [1006, 28, 2, 111, 7, 112],
  /* 23 */ [1094, 30, 4, 121, 5, 122],
  /* 24 */ [1174, 30, 6, 117, 4, 118],
  /* 25 */ [1276, 26, 8, 106, 4, 107],
  /* 26 */ [1370, 28, 10, 114, 2, 115],
  /* 27 */ [1468, 30, 8, 122, 4, 123],
  /* 28 */ [1531, 30, 3, 117, 10, 118],
  /* 29 */ [1631, 30, 7, 116, 7, 117],
  /* 30 */ [1735, 30, 5, 115, 10, 116],
  /* 31 */ [1843, 30, 13, 115, 3, 116],
  /* 32 */ [1955, 30, 17, 115],
  /* 33 */ [2071, 30, 17, 115, 1, 116],
  /* 34 */ [2191, 30, 13, 115, 6, 116],
  /* 35 */ [2306, 30, 12, 121, 7, 122],
  /* 36 */ [2434, 30, 6, 121, 14, 122],
  /* 37 */ [2566, 30, 17, 122, 4, 123],
  /* 38 */ [2702, 30, 4, 122, 18, 123],
  /* 39 */ [2812, 30, 20, 117, 4, 118],
  /* 40 */ [2956, 30, 19, 118, 6, 119],
];

// Alignment pattern positions per version (2-40)
const ALIGN_POSITIONS: number[][] = [
  [], // v1 has no alignment
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
  [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
  [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

function selectVersion(dataLen: number): number {
  // dataLen is the byte count of the payload
  for (let v = 0; v < VERSION_TABLE.length; v++) {
    const totalData = VERSION_TABLE[v]![0]!;
    // Mode indicator (4 bits) + char count indicator (8 or 16 bits depending on version) + data
    const charCountBits = v + 1 <= 9 ? 8 : 16;
    const overhead = Math.ceil((4 + charCountBits) / 8);
    if (dataLen + overhead <= totalData) return v + 1;
  }
  throw new Error(`Data too large for QR (${dataLen} bytes)`);
}

// ── Bit stream helpers ──

class BitStream {
  private bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
  }

  getLength(): number {
    return this.bits.length;
  }

  getBit(index: number): number {
    return this.bits[index]!;
  }
}

// ── Module placement ──

function createMatrix(size: number): { modules: boolean[][]; reserved: boolean[][] } {
  const modules: boolean[][] = [];
  const reserved: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    modules.push(new Array(size).fill(false));
    reserved.push(new Array(size).fill(false));
  }
  return { modules, reserved };
}

function placeFinderPattern(modules: boolean[][], reserved: boolean[][], row: number, col: number, size: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const isBlack =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      modules[rr]![cc] = isBlack;
      reserved[rr]![cc] = true;
    }
  }
}

function placeAlignmentPattern(modules: boolean[][], reserved: boolean[][], row: number, col: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      modules[row + r]![col + c] = isBlack;
      reserved[row + r]![col + c] = true;
    }
  }
}

function placeTimingPatterns(modules: boolean[][], reserved: boolean[][], size: number): void {
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0;
    if (!reserved[6]![i]) {
      modules[6]![i] = val;
      reserved[6]![i] = true;
    }
    if (!reserved[i]![6]) {
      modules[i]![6] = val;
      reserved[i]![6] = true;
    }
  }
}

function reserveFormatBits(reserved: boolean[][], size: number): void {
  // Around finder patterns
  for (let i = 0; i < 8; i++) {
    reserved[8]![i] = true;
    reserved[i]![8] = true;
    reserved[8]![size - 1 - i] = true;
    reserved[size - 1 - i]![8] = true;
  }
  reserved[8]![8] = true;
  // Dark module
  reserved[size - 8]![8] = true;
}

function reserveVersionBits(reserved: boolean[][], size: number, version: number): void {
  if (version < 7) return;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      reserved[i]![size - 11 + j] = true;
      reserved[size - 11 + j]![i] = true;
    }
  }
}

function placeDataBits(modules: boolean[][], reserved: boolean[][], size: number, bits: BitStream): void {
  let bitIdx = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip timing pattern column

    const rowRange = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rowRange) {
      for (const col of [right, right - 1]) {
        if (col < 0) continue;
        if (reserved[row]![col]) continue;
        if (bitIdx < bits.getLength()) {
          modules[row]![col] = bits.getBit(bitIdx) === 1;
          bitIdx++;
        }
        // Remaining bits stay false (0)
      }
    }
    upward = !upward;
  }
}

// ── Masking ──

type MaskFn = (row: number, col: number) => boolean;

const MASK_FUNCTIONS: MaskFn[] = [
  (r, c) => (r + c) % 2 === 0,
  (r, _) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(modules: boolean[][], reserved: boolean[][], size: number, maskIdx: number): boolean[][] {
  const fn = MASK_FUNCTIONS[maskIdx]!;
  const result = modules.map((row) => [...row]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r]![c] && fn(r, c)) {
        result[r]![c] = !result[r]![c];
      }
    }
  }
  return result;
}

function penaltyScore(modules: boolean[][], size: number): number {
  let score = 0;

  // Rule 1: consecutive same-colored modules in row/col
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r]![c] === modules[r]![c - 1]) {
        count++;
        if (count === 5) score += 3;
        else if (count > 5) score += 1;
      } else {
        count = 1;
      }
    }
  }
  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r]![c] === modules[r - 1]![c]) {
        count++;
        if (count === 5) score += 3;
        else if (count > 5) score += 1;
      } else {
        count = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const val = modules[r]![c];
      if (val === modules[r]![c + 1] && val === modules[r + 1]![c] && val === modules[r + 1]![c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3 & 4 skipped for simplicity (they have minimal impact on mask selection)

  return score;
}

// ── Format & version info ──

const FORMAT_INFO_TABLE: number[] = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed,
  0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
];

function placeFormatBits(modules: boolean[][], size: number, maskIdx: number): void {
  // EC level L = 01, mask pattern = maskIdx
  const formatIdx = (0b01 << 3) | maskIdx;
  const info = FORMAT_INFO_TABLE[formatIdx]!;

  // First copy: around top-left finder
  const bits: boolean[] = [];
  for (let i = 14; i >= 0; i--) {
    bits.push(((info >> i) & 1) === 1);
  }

  // Horizontal (row 8)
  const hPositions = [0, 1, 2, 3, 4, 5, 7, 8, size - 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1];
  for (let i = 0; i < 15; i++) {
    modules[8]![hPositions[i]!] = bits[i]!;
  }

  // Vertical (col 8)
  const vPositions = [0, 1, 2, 3, 4, 5, 7, 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1];
  // The vertical pattern is read in reverse order
  for (let i = 0; i < 15; i++) {
    modules[vPositions[14 - i]!]![8] = bits[i]!;
  }

  // Dark module (always set)
  modules[size - 8]![8] = true;
}

// Version info BCH codes for versions 7-40
const VERSION_INFO: number[] = [
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d,
  0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532, 0x149a6, 0x15683, 0x168c9,
  0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
  0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64,
  0x27541, 0x28c69,
];

function placeVersionBits(modules: boolean[][], size: number, version: number): void {
  if (version < 7) return;
  const info = VERSION_INFO[version - 7]!;
  for (let i = 0; i < 18; i++) {
    const bit = ((info >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = (size - 11) + (i % 3);
    modules[row]![col] = bit;
    modules[col]![row] = bit;
  }
}

// ── Main encoder ──

export function encodeQR(data: string): string[] {
  const bytes = Buffer.from(data, "utf-8");
  const version = selectVersion(bytes.length);
  const vInfo = VERSION_TABLE[version - 1]!;
  const totalDataCodewords = vInfo[0]!;
  const ecPerBlock = vInfo[1]!;
  const numBlocks1 = vInfo[2]!;
  const dataPerBlock1 = vInfo[3]!;
  const numBlocks2 = vInfo.length > 4 ? vInfo[4]! : 0;
  const dataPerBlock2 = vInfo.length > 5 ? vInfo[5]! : 0;
  const size = version * 4 + 17;

  // Build data bit stream
  const charCountBits = version <= 9 ? 8 : 16;
  const bs = new BitStream();
  bs.put(0b0100, 4); // Byte mode indicator
  bs.put(bytes.length, charCountBits);
  for (const byte of bytes) {
    bs.put(byte, 8);
  }
  // Terminator
  const totalBits = totalDataCodewords * 8;
  const terminatorLen = Math.min(4, totalBits - bs.getLength());
  bs.put(0, terminatorLen);
  // Pad to byte boundary
  while (bs.getLength() % 8 !== 0) {
    bs.put(0, 1);
  }
  // Pad codewords
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bs.getLength() < totalBits) {
    bs.put(padBytes[padIdx % 2]!, 8);
    padIdx++;
  }

  // Extract data bytes
  const dataBytes = new Uint8Array(totalDataCodewords);
  for (let i = 0; i < totalDataCodewords; i++) {
    let val = 0;
    for (let bit = 0; bit < 8; bit++) {
      val = (val << 1) | bs.getBit(i * 8 + bit);
    }
    dataBytes[i] = val;
  }

  // Split into blocks and generate EC
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;

  for (let i = 0; i < numBlocks1; i++) {
    const data = dataBytes.slice(offset, offset + dataPerBlock1);
    blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
    offset += dataPerBlock1;
  }
  for (let i = 0; i < numBlocks2; i++) {
    const data = dataBytes.slice(offset, offset + dataPerBlock2);
    blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
    offset += dataPerBlock2;
  }

  // Interleave data codewords
  const allBits = new BitStream();
  const maxDataLen = Math.max(dataPerBlock1, dataPerBlock2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.data.length) {
        allBits.put(block.data[i]!, 8);
      }
    }
  }
  // Interleave EC codewords
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of blocks) {
      allBits.put(block.ec[i]!, 8);
    }
  }

  // Remainder bits (version-dependent)
  const remainderBits = [0,7,7,7,7,7,0,0,0,0,0,0,0,3,3,3,3,3,3,3,4,4,4,4,4,4,4,3,3,3,3,3,3,3,0,0,0,0,0,0,0];
  for (let i = 0; i < (remainderBits[version] ?? 0); i++) {
    allBits.put(0, 1);
  }

  // Build the QR matrix
  const { modules, reserved } = createMatrix(size);

  // Finder patterns
  placeFinderPattern(modules, reserved, 0, 0, size);
  placeFinderPattern(modules, reserved, 0, size - 7, size);
  placeFinderPattern(modules, reserved, size - 7, 0, size);

  // Alignment patterns
  if (version >= 2) {
    const positions = ALIGN_POSITIONS[version - 1]!;
    for (const r of positions) {
      for (const c of positions) {
        // Skip if overlapping with finder patterns
        if (r <= 8 && c <= 8) continue;
        if (r <= 8 && c >= size - 8) continue;
        if (r >= size - 8 && c <= 8) continue;
        placeAlignmentPattern(modules, reserved, r, c);
      }
    }
  }

  // Timing patterns
  placeTimingPatterns(modules, reserved, size);

  // Reserve format & version areas
  reserveFormatBits(reserved, size);
  reserveVersionBits(reserved, size, version);

  // Place data bits
  placeDataBits(modules, reserved, size, allBits);

  // Try all 8 mask patterns, pick the one with lowest penalty
  let bestMask = 0;
  let bestScore = Infinity;
  let bestResult: boolean[][] = modules;

  for (let m = 0; m < 8; m++) {
    const masked = applyMask(modules, reserved, size, m);
    placeFormatBits(masked, size, m);
    placeVersionBits(masked, size, version);
    const score = penaltyScore(masked, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      bestResult = masked;
    }
  }

  // Ensure format/version bits are placed on best result
  placeFormatBits(bestResult, size, bestMask);
  placeVersionBits(bestResult, size, version);

  // Convert to text using Unicode block characters
  // Each pair of rows maps to one text line using ▀ ▄ █ and space
  const lines: string[] = [];
  const quietZone = 4; // quiet zone modules
  const totalSize = size + quietZone * 2;

  // Helper to check if a module is dark (with quiet zone offset)
  const isDark = (r: number, c: number): boolean => {
    const qr = r - quietZone;
    const qc = c - quietZone;
    if (qr < 0 || qr >= size || qc < 0 || qc >= size) return false;
    return bestResult[qr]![qc]!;
  };

  for (let r = 0; r < totalSize; r += 2) {
    let line = "";
    for (let c = 0; c < totalSize; c++) {
      const top = isDark(r, c);
      const bottom = r + 1 < totalSize ? isDark(r + 1, c) : false;

      if (top && bottom) {
        line += "\u2588"; // █ full block
      } else if (top && !bottom) {
        line += "\u2580"; // ▀ upper half
      } else if (!top && bottom) {
        line += "\u2584"; // ▄ lower half
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }

  return lines;
}
