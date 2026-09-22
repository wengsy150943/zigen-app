/**
 * GIF 编码器测试：结构解析（头/LSD/GCT/GCE/图像数据）+ LZW 解码往返 + 透明/调色板/延迟。
 * 运行: node web/test/test_gif.mjs
 * 输出: web/test/sample.gif（可肉眼查看）
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const GifEncoder = require('../gif.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 12, H = 8, FPS = 12;

function frame(color, alpha) {
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = color[0]; buf[i * 4 + 1] = color[1]; buf[i * 4 + 2] = color[2]; buf[i * 4 + 3] = alpha;
  }
  return buf;
}

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${extra}`); }
}

// --- GIF 结构解析 ---
function parse(bytes) {
  const enc = new TextDecoder('latin1');
  const head = enc.decode(bytes.subarray(0, 6));
  if (head !== 'GIF89a') throw new Error('头错误: ' + head);
  const w = bytes[6] | (bytes[7] << 8);
  const h = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  const gctSize = 3 * (1 << ((packed & 7) + 1));
  const gct = [];
  for (let i = 0; i < gctSize; i += 3) gct.push([bytes[13 + i], bytes[14 + i], bytes[15 + i]]);
  let off = 13 + gctSize;
  const frames = [];
  let loop = null;
  while (off < bytes.length) {
    const b = bytes[off];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const label = bytes[off + 1];
      if (label === 0xff) { // application extension
        const len = bytes[off + 2];
        const id = enc.decode(bytes.subarray(off + 3, off + 3 + len));
        if (id.startsWith('NETSCAPE')) {
          loop = bytes[off + 3 + len + 2] | (bytes[off + 3 + len + 3] << 8);
        }
        off += 3 + len;
        while (bytes[off] !== 0) off += 1 + bytes[off];
        off += 1;
      } else if (label === 0xf9) { // GCE
        const packedG = bytes[off + 3];
        const delay = bytes[off + 4] | (bytes[off + 5] << 8);
        const transIdx = bytes[off + 6];
        const hasTrans = packedG & 1;
        const disposal = (packedG >> 2) & 7;
        off += 8; // 0x21 0xF9 0x04 packed delayLo delayHi transIdx 0x00
        // 图像描述
        if (bytes[off] === 0x2c) {
          const left = bytes[off + 1] | (bytes[off + 2] << 8);
          const top = bytes[off + 3] | (bytes[off + 4] << 8);
          const iw = bytes[off + 5] | (bytes[off + 6] << 8);
          const ih = bytes[off + 7] | (bytes[off + 8] << 8);
          const minCodeSize = bytes[off + 10];
          // 收集子块
          const data = [];
          let o = off + 11;
          while (bytes[o] !== 0) { const l = bytes[o]; data.push(...bytes.subarray(o + 1, o + 1 + l)); o += 1 + l; }
          frames.push({ left, top, iw, ih, disposal, delay, transIdx, hasTrans, minCodeSize, data: new Uint8Array(data) });
          off = o + 1;
        } else throw new Error('GCE 后非图像描述符');
      } else { // 跳过未知扩展
        off += 2;
        while (bytes[off] !== 0) off += 1 + bytes[off];
        off += 1;
      }
    } else if (b === 0x2c) { // 无 GCE 的图像描述（本编码器不会出现，但容错）
      off += 10;
      const o2 = off;
      off += 1;
      while (bytes[off] !== 0) off += 1 + bytes[off];
      frames.push({ data: new Uint8Array([]), rawOff: o2 });
      off += 1;
    } else throw new Error('未知块: 0x' + b.toString(16) + ' @ ' + off);
  }
  return { w, h, gct, frames, loop, size: bytes.length };
}

// --- GIF LZW 解码（校验用，逻辑与 omggif 解码器一致） ---
function lzwDecode(data, minCodeSize, expectedLen) {
  const clear = 1 << minCodeSize, end = clear + 1;
  let codeSize = minCodeSize + 1;
  let mask = (1 << codeSize) - 1;
  const dict = []; // dict[i] = 索引数组；<clear 的初始为单元素
  for (let i = 0; i < clear; i++) dict[i] = [i];
  let next = end + 1;
  const out = [];
  let bitPos = 0;
  const readCode = () => {
    let v = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[bitPos >> 3];
      const bit = ((byte === undefined ? 0 : byte) >> (bitPos & 7)) & 1;
      v |= bit << i;
      bitPos++;
    }
    return v;
  };
  let prev = null;
  while (out.length < expectedLen) {
    const code = readCode();
    if (code === end) break;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      mask = (1 << codeSize) - 1;
      dict.length = clear;
      for (let i = 0; i < clear; i++) dict[i] = [i];
      next = end + 1;
      prev = null;
      continue;
    }
    let entry;
    if (code < next && dict[code] !== undefined) entry = dict[code];
    else if (prev !== null) entry = [...dict[prev], dict[prev][0]]; // KwKwK
    else throw new Error('非法 LZW 码 ' + code + ' (next=' + next + ')');
    out.push(...entry);
    if (prev !== null && next < 4096) {
      dict[next++] = [...dict[prev], entry[0]];
      // 与 omggif 解码器一致：插入后 next 达到 2^codeSize 则加宽
      if (next >= mask + 1 && codeSize < 12) {
        codeSize++;
        mask = (mask << 1) | 1;
      }
    }
    prev = code;
  }
  if (out.length !== expectedLen) throw new Error(`解码长度 ${out.length} != ${expectedLen}`);
  return out;
}

// --- 主测试 ---
const enc = new GifEncoder(W, H, 3, 1, FPS); // 循环一次
enc.addFrame(frame([255, 0, 0], 255));   // 帧0 红（不透明）
enc.addFrame(frame([0, 255, 0], 200));   // 帧1 绿（alpha 200 ≥ 128 → 不透明）
enc.addFrame(frame([0, 0, 255], 0));     // 帧2 蓝（全透明）
const bytes = enc.finish();
console.log(`编码 3 帧 ${W}x${H}，总 ${bytes.length} 字节`);

const g = parse(bytes);
check('头 GIF89a / 尺寸 12×8', g.w === W && g.h === H);
check('全局调色板存在（≥3 项: 透明+红+绿）', g.gct.length >= 3, `gct=${g.gct.length}`);

// 循环: numPlays=1 → 无 Netscape 扩展
check('循环一次：无 Netscape 循环扩展', g.loop === null, `loop=${g.loop}`);
// 循环无限验证
const encLoop = new GifEncoder(4, 4, 1, 0, 12);
const tiny = new Uint8Array(4 * 4 * 4);
for (let i = 0; i < 64; i += 4) { tiny[i] = 10; tiny[i + 1] = 20; tiny[i + 2] = 30; tiny[i + 3] = 255; }
encLoop.addFrame(tiny);
const bl = parse(encLoop.finish());
check('循环无限：Netscape loop=0', bl.loop === 0, `loop=${bl.loop}`);

check('3 帧 GCE 结构', g.frames.length === 3, `frames=${g.frames.length}`);
const f0 = g.frames[0];
check('延迟 = 1/fps ×100 单位（12fps → 8）', f0.delay === 8, `delay=${f0.delay}`);
check('disposal=2（帧后恢复透明）', f0.disposal === 2, `disposal=${f0.disposal}`);
check('透明标志开启、透明索引=0', f0.hasTrans === 1 && f0.transIdx === 0, `trans=${f0.hasTrans}/${f0.transIdx}`);
check('图像描述符 = 全幅 12×8', f0.left === 0 && f0.top === 0 && f0.iw === W && f0.ih === H);

// LZW 解码往返
const idx0 = lzwDecode(f0.data, f0.minCodeSize, W * H);
const ones = idx0.every(i => i !== 0);
check('帧0 全部不透明（索引≠0）', ones, 'idx=' + [...new Set(idx0)].join(','));
// 帧0 是纯红 → 调色板中应能匹配 [255,0,0]，且所有像素同一索引
const idxSet = new Set(idx0);
check('帧0 单色（同一调色板索引）', idxSet.size === 1, [...idxSet].join(','));
const c0 = g.gct[idx0[0]];
check('帧0 像素对应红色', c0 && Math.abs(c0[0] - 255) < 32 && Math.abs(c0[1]) < 32 && Math.abs(c0[2]) < 32, JSON.stringify(c0));

const idx1 = lzwDecode(g.frames[1].data, g.frames[1].minCodeSize, W * H);
check('帧1 不透明（alpha200 视为不透明）', idx1.every(i => i !== 0));
const c1 = g.gct[idx1[0]];
check('帧1 像素对应绿色', c1 && Math.abs(c1[1] - 255) < 32, JSON.stringify(c1));

const idx2 = lzwDecode(g.frames[2].data, g.frames[2].minCodeSize, W * H);
check('帧2 全透明（索引 0）', idx2.every(i => i === 0));

// 尾部
check('以 0x3b 结尾', bytes[bytes.length - 1] === 0x3b);

// --- LZW 码宽增长 / 字典重置压力测试（200×200、60 色伪随机） ---
// 40000 像素 × 60 色随机 → 字典必然填满 4096 并触发多次 clear 重置，
// 任何位宽增长时机错误都会让往返解码失败。
{
  const W2 = 200, H2 = 200, NC = 60;
  const cols = [];
  for (let i = 0; i < NC; i++) {
    cols.push([
      (i % 6) * 40 + 8,
      (Math.floor(i / 6) % 6) * 40 + 8,
      Math.floor(i / 36) * 80 + 8,
    ]); // 全部 8 的倍数 → 5bit 桶映射可精确预测
  }
  const buf2 = new Uint8Array(W2 * H2 * 4);
  // mulberry32：低位质量足够的确定性伪随机
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const used = new Set();
  for (let i = 0; i < W2 * H2; i++) {
    const ci = rnd() % NC;
    used.add(ci);
    const c = cols[ci];
    buf2[i * 4] = c[0]; buf2[i * 4 + 1] = c[1]; buf2[i * 4 + 2] = c[2]; buf2[i * 4 + 3] = 255;
  }
  check('压力用例: 伪随机覆盖全部 60 色', used.size === NC, `used=${used.size}`);
  const enc2 = new GifEncoder(W2, H2, 1, 1, 12);
  enc2.addFrame(buf2);
  const b2 = enc2.finish();
  const g2 = parse(b2);
  check('压力用例: 调色板 ≥ 61 项（60 色 + 透明）', g2.gct.length >= 61, `gct=${g2.gct.length}`);
  const fr2 = g2.frames[0];
  check('压力用例: minCodeSize = 6（64 项调色板）', fr2.minCodeSize === 6, `mcs=${fr2.minCodeSize}`);
  const idx2 = lzwDecode(fr2.data, fr2.minCodeSize, W2 * H2);
  check('压力用例: 解码像素数 = 40000', idx2.length === W2 * H2, `${idx2.length}`);
  // 逐像素比对：解码索引 → 调色板色 应等于原色经 5bit 桶取中值后的颜色
  const expect = (v) => ((v >> 3) << 3) | 4;
  let mismatch = 0;
  for (let i = 0; i < W2 * H2 && mismatch < 3; i++) {
    const c = g2.gct[idx2[i]];
    const sr = buf2[i * 4], sg = buf2[i * 4 + 1], sb = buf2[i * 4 + 2];
    if (!c || c[0] !== expect(sr) || c[1] !== expect(sg) || c[2] !== expect(sb)) mismatch++;
  }
  check('压力用例: 全部像素颜色正确（码宽增长/重置路径正确）', mismatch === 0, `mismatch=${mismatch}`);
}

writeFileSync(path.join(__dirname, 'sample.gif'), Buffer.from(bytes));
console.log(`已写出 web/test/sample.gif (${bytes.length} B)`);

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\nGIF 测试全部通过 ✔');