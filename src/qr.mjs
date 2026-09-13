// 零依赖 QR 码生成器（字节模式，ECC L/M，版本 1-10 —— 足够放下配对 URL）
// 用途：手机扫码配对局域网地址。实现参考 ISO/IEC 18004 标准流程：
//   数据编码 → 纠错码（GF(256) Reed-Solomon）→ 交织 → 矩阵布置 → 掩码评估

const ECC_TABLE = {
  L: {
    1: [26, 7, [1, 19]],
    2: [44, 10, [1, 34]],
    3: [70, 15, [1, 55]],
    4: [100, 20, [1, 80]],
    5: [134, 26, [1, 108]],
    6: [172, 18, [2, 68]],
    7: [196, 20, [2, 78]],
    8: [242, 24, [2, 97]],
    9: [292, 30, [2, 116]],
    10: [346, 18, [2, 68, 2, 69]],
  },
  M: {
    1: [26, 10, [1, 16]],
    2: [44, 16, [1, 28]],
    3: [70, 26, [1, 44]],
    4: [100, 18, [2, 32]],
    5: [134, 24, [2, 43]],
    6: [172, 16, [4, 27]],
    7: [196, 18, [4, 31]],
    8: [242, 22, [2, 38, 2, 39]],
    9: [292, 22, [3, 36, 2, 37]],
    10: [346, 26, [4, 43, 1, 44]],
  },
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// 生成多项式 = ∏ (x + α^i)，系数从高次到低次排列（低次在前会算出错误的纠错码）
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                          // 乘以 x 项
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);    // 乘以 α^i
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

function pickVersion(byteLen, ecc) {
  for (let v = 1; v <= 10; v++) {
    const [total, ecPerBlock, groups] = ECC_TABLE[ecc][v];
    let dataCodewords = 0;
    for (let g = 0; g < groups.length; g += 2) dataCodewords += groups[g] * groups[g + 1];
    const capacityBits = dataCodewords * 8;
    const countBits = v <= 9 ? 8 : 16;
    const needed = 4 + countBits + byteLen * 8;
    if (needed <= capacityBits) return v;
  }
  throw new Error('内容过长，二维码版本超出支持范围（1-10）');
}

// 内部函数导出用于自检（不做公开 API 承诺）
export function qrDebugCodewords(text, ecc = 'M') {
  const level = ECC_TABLE[ecc] ? ecc : 'M';
  const { version, codewords } = buildCodewords(String(text), level);
  return { version, codewords, dataCodewords: codewords.slice(0, codewords.length - ECC_TABLE[level][version][1] * 0) };
}

export function qrDataBytes(text, ecc = 'M') {
  const level = ECC_TABLE[ecc] ? ecc : 'M';
  const bytes = Buffer.from(String(text), 'utf8');
  const version = pickVersion(bytes.length, level);
  const groups = ECC_TABLE[level][version][2];
  let dataCodewords = 0;
  for (let g = 0; g < groups.length; g += 2) dataCodewords += groups[g] * groups[g + 1];
  return { version, dataCodewords, data: buildDataSection(bytes, version, dataCodewords) };
}

function buildDataSection(bytes, version, dataCodewords) {
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCodewords * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  const pad = [0xec, 0x11];
  let k = 0;
  while (out.length < dataCodewords) out.push(pad[k++ % 2]);
  return out;
}

function buildCodewords(text, ecc) {
  const bytes = Buffer.from(text, 'utf8');
  const version = pickVersion(bytes.length, ecc);
  const [total, ecPerBlock, groups] = ECC_TABLE[ecc][version];
  let dataCodewords = 0;
  for (let g = 0; g < groups.length; g += 2) dataCodewords += groups[g] * groups[g + 1];

  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);                                  // 字节模式
  push(bytes.length, version <= 9 ? 8 : 16);        // 字符计数
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCodewords * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // 终止符
  while (bits.length % 8 !== 0) bits.push(0);
  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataBytes.push(byte);
  }
  const pad = [0xec, 0x11];
  let padIndex = 0;
  while (dataBytes.length < dataCodewords) dataBytes.push(pad[padIndex++ % 2]);

  // 分块 + 计算纠错码
  const blocks = [];
  const groupDefs = [];
  for (let g = 0; g < groups.length; g += 2) groupDefs.push([groups[g], groups[g + 1]]);
  let offset = 0;
  for (const [count, size] of groupDefs) {
    for (let i = 0; i < count; i++) {
      const data = dataBytes.slice(offset, offset + size);
      offset += size;
      blocks.push({ data, ec: rsRemainder(data, ecPerBlock) });
    }
  }

  // 交织
  const result = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) result.push(b.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of blocks) result.push(b.ec[i]);
  return { version, codewords: result };
}

function buildMatrix(version, codewords, ecc, forcedMask) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  return buildMatrixInternal(version, codewords, ecc, forcedMask, modules, reserved).matrix;
}

function buildMatrixInternal(version, codewords, ecc, forcedMask, modules, reserved) {
  const size = version * 4 + 17;

  const setFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        modules[rr][cc] = dark;
        reserved[rr][cc] = true;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) { modules[6][i] = i % 2 === 0; reserved[6][i] = true; }
    if (!reserved[i][6]) { modules[i][6] = i % 2 === 0; reserved[i][6] = true; }
  }

  // 对齐图案：只在「非三个 finder 角落」的所有交叉点绘制（会覆盖时钟线，这是标准行为）
  const alignPos = ALIGNMENT[version];
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      const last = alignPos.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const r = alignPos[i], c = alignPos[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          modules[r + dr][c + dc] = dark;
          reserved[r + dr][c + dc] = true;
        }
      }
    }
  }

  modules[size - 8][8] = true;   // 固定的暗模块
  reserved[size - 8][8] = true;

  const reserveFormat = () => {
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = true;
      reserved[size - 1 - i][8] = true;
    }
    reserved[8][6] = true; reserved[6][8] = true;
  };
  reserveFormat();

  // 版本信息（版本 ≥ 7）：18 位（6 位版本号 + 12 位 BCH 校验），对角放置两处 3×6 区块
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (version << 12) | (rem & 0xfff);
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      modules[b][a] = bit; reserved[b][a] = true;
      modules[a][b] = bit; reserved[a][b] = true;
    }
  }

  // 数据布置（之字形）
  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (reserved[row][col]) continue;
        modules[row][col] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        bitIndex++;
      }
    }
    upward = !upward;
  }

  const MASK_FN = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  const eccBits = ecc === 'L' ? 0b01 : 0b00;   // 格式信息里的纠错级别编码：L=01, M=00

  // 格式信息摆放遵循 ISO/IEC 18004（注意区分行列：第一份在左上角沿列/行交替，第二份在右上与左下）
  const drawFormat = (matrix, mask) => {
    const data = (eccBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bitsValue = ((data << 10) | rem) ^ 0x5412;
    const get = (i) => ((bitsValue >> i) & 1) === 1;
    // 第一份：左上角
    for (let i = 0; i <= 5; i++) matrix[i][8] = get(i);
    matrix[7][8] = get(6);
    matrix[8][8] = get(7);
    matrix[8][7] = get(8);
    for (let i = 9; i < 15; i++) matrix[8][14 - i] = get(i);
    // 第二份：左下（竖）与右上（横）
    for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = get(i);
    for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = get(i);
    matrix[size - 8][8] = true;   // 固定暗模块
  };

  const penalty = (matrix) => {
    let score = 0;
    for (let i = 0; i < size; i++) {
      let runColor = matrix[i][0], runLen = 1;
      for (let j = 1; j < size; j++) {
        if (matrix[i][j] === runColor) { runLen++; if (runLen === 5) score += 3; else if (runLen > 5) score++; }
        else { runColor = matrix[i][j]; runLen = 1; }
      }
      runColor = matrix[0][i]; runLen = 1;
      for (let j = 1; j < size; j++) {
        if (matrix[j][i] === runColor) { runLen++; if (runLen === 5) score += 3; else if (runLen > 5) score++; }
        else { runColor = matrix[j][i]; runLen = 1; }
      }
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = matrix[r][c];
        if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
      }
    }
    const pattern = [true, false, true, true, true, false, true];
    const matches = (arr, start) => pattern.every((p, k) => arr[start + k] === p);
    for (let i = 0; i < size; i++) {
      const row = matrix[i];
      const col = matrix.map((r) => r[i]);
      for (let j = 0; j + 7 <= size; j++) {
        if (matches(row, j)) {
          const before = row.slice(Math.max(0, j - 4), j).filter((x) => x === false).length;
          const after = row.slice(j + 7, j + 11).filter((x) => x === false).length;
          if (before >= 4 || after >= 4) score += 40;
        }
        if (matches(col, j)) {
          const before = col.slice(Math.max(0, j - 4), j).filter((x) => x === false).length;
          const after = col.slice(j + 7, j + 11).filter((x) => x === false).length;
          if (before >= 4 || after >= 4) score += 40;
        }
      }
    }
    const dark = matrix.flat().filter(Boolean).length;
    const ratio = Math.abs(dark * 100 / (size * size) - 50);
    score += Math.floor(ratio / 5) * 10;
    return score;
  };

  let best = null;
  const masks = forcedMask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask];
  for (const mask of masks) {
    const candidate = modules.map((row, r) => row.map((v, c) => (reserved[r][c] ? v : (v !== MASK_FN[mask](r, c)))));
    drawFormat(candidate, mask);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { score, mask, matrix: candidate };
  }
  return { ...best, reserved };
}

// 调试用：导出模块矩阵、功能模块保留图、版本、掩码
export function qrDebugLayout(text, { ecc = 'M', mask = null } = {}) {
  const level = ECC_TABLE[ecc] ? ecc : 'M';
  const { version, codewords } = buildCodewords(String(text), level);
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const out = buildMatrixInternal(version, codewords, level, mask, modules, reserved);
  return { version, size, modules: out.matrix, reserved: out.reserved, codewords, mask: out.mask };
}

export function qrMatrix(text, { ecc = 'M', mask = null } = {}) {
  const level = ECC_TABLE[ecc] ? ecc : 'M';
  const { version, codewords } = buildCodewords(String(text), level);
  return buildMatrix(version, codewords, level, mask);
}

// 供测试/调试：返回版本与掩码信息
export function qrInfo(text, { ecc = 'M' } = {}) {
  const { version } = buildCodewords(String(text), ECC_TABLE[ecc] ? ecc : 'M');
  return { version };
}

// 生成 SVG（给网页用，深浅色都自适应）
export function qrSvg(text, { ecc = 'M', scale = 4, border = 2, dark = '#111827', light = 'transparent' } = {}) {
  const matrix = qrMatrix(text, { ecc });
  const size = matrix.length;
  const dim = (size + border * 2) * scale;
  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim + '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">');
  if (light !== 'transparent') parts.push('<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!matrix[r][c]) continue;
      parts.push('<rect x="' + ((c + border) * scale) + '" y="' + ((r + border) * scale) + '" width="' + scale + '" height="' + scale + '" fill="' + dark + '"/>');
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

// 终端里打印（用半块字符，宽高各减半）
export function qrAscii(text, { ecc = 'M', border = 2 } = {}) {
  const matrix = qrMatrix(text, { ecc });
  const size = matrix.length;
  const at = (r, c) => (r >= 0 && r < size && c >= 0 && c < size ? matrix[r][c] : false);
  const lines = [];
  const blank = ' '.repeat(size + border * 2);
  for (let i = 0; i < border; i++) lines.push(blank);
  for (let r = -border; r < size + border; r += 2) {
    let line = '';
    for (let c = -border; c < size + border; c++) {
      const top = at(r, c), bottom = at(r + 1, c);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  for (let i = 0; i < border; i++) lines.push(blank);
  return lines.join('\n');
}
