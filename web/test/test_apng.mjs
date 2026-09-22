/**
 * APNG 编码器往返测试（Node ≥ 18，需要全局 CompressionStream）。
 * 运行: node web/test/test_apng.mjs
 * 输出: web/test/sample.apng（可肉眼查看）
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ApngEncoder = require('../apng.js');
const { crc32 } = ApngEncoder;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const W = 12, H = 8, FPS = 12;

function solidFrame(r, g, b, a) {
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a;
  }
  return buf;
}

async function inflate(data) {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const parts = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function parseChunks(bytes) {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('签名错误');
  const chunks = [];
  let off = 8;
  while (off < bytes.length) {
    const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const data = bytes.subarray(off + 8, off + 8 + len);
    const crc = (((bytes[off + 8 + len] << 24) >>> 0) | (bytes[off + 8 + len + 1] << 16) | (bytes[off + 8 + len + 2] << 8) | bytes[off + 8 + len + 3]) >>> 0;
    const calc = crc32(bytes, off + 4, off + 8 + len);
    if (crc !== calc) throw new Error(`chunk ${type} CRC 不匹配`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${extra}`); }
}

const enc = new ApngEncoder(W, H, 3, 1, FPS);
await enc.addFrame(solidFrame(255, 0, 0, 255));
await enc.addFrame(solidFrame(0, 255, 0, 128));
await enc.addFrame(solidFrame(0, 0, 255, 0));
const bytes = await enc.finish();

console.log(`编码 3 帧 ${W}x${H}，总 ${bytes.length} 字节`);

const chunks = parseChunks(bytes);
const types = chunks.map(c => c.type).join(',');
console.log('chunks:', types);

check('chunk 顺序', chunks[0].type === 'IHDR' && chunks[1].type === 'acTL' && chunks[chunks.length - 1].type === 'IEND', types);
check('acTL 帧数=3', chunks[1].data[3] === 3 && chunks[1].data[0] === 0 && chunks[1].data[1] === 0 && chunks[1].data[2] === 0);
check('acTL plays=1', chunks[1].data[7] === 1 && chunks[1].data[4] === 0 && chunks[1].data[5] === 0 && chunks[1].data[6] === 0);
check('共有 3 个 fcTL', chunks.filter(c => c.type === 'fcTL').length === 3);
check('1 个 IDAT + 2 个 fdAT', chunks.filter(c => c.type === 'IDAT').length === 1 && chunks.filter(c => c.type === 'fdAT').length === 2);

// fcTL 序列号/延迟/dispose
const fcTLs = chunks.filter(c => c.type === 'fcTL').map(c => c.data);
check('fcTL 序列号 0,1,3（fdAT1=2 占用序号 2）', fcTLs[0][3] === 0 && fcTLs[1][3] === 1 && fcTLs[2][3] === 3);
check('fcTL 延迟 = 1/fps', fcTLs[0][21] === 1 && fcTLs[0][23] === FPS);
check('fcTL dispose=1 blend=0', fcTLs[0][24] === 1 && fcTLs[0][25] === 0);
check('fdAT 序列号第一个=2', chunks.filter(c => c.type === 'fdAT')[0].data[3] === 2);

// 像素往返：逐帧解压对比
const rawExpected = ['ff0000ff', '00ff0080', '0000ff00'];
const compressedBodies = [];
for (const c of chunks) {
  if (c.type === 'IDAT') compressedBodies.push(c.data);
  if (c.type === 'fdAT') compressedBodies.push(c.data.subarray(4));
}
for (let i = 0; i < 3; i++) {
  const raw = await inflate(compressedBodies[i]);
  check(`帧${i} 原始数据长度 = H*(W*4+1)`, raw.length === H * (W * 4 + 1));
  // filter 字节全为 0
  let filtersOk = true;
  for (let y = 0; y < H; y++) if (raw[y * (W * 4 + 1)] !== 0) filtersOk = false;
  check(`帧${i} filter 全为 None`, filtersOk);
  // 解出的像素与期望一致
  const px = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * (W * 4 + 1) + 1 + x * 4;
      px.push(Array.from(raw.subarray(o, o + 4)).map(v => v.toString(16).padStart(2, '0')).join(''));
    }
  }
  check(`帧${i} 全部像素 = ${rawExpected[i]}`, px.every(p => p === rawExpected[i]));
}

writeFileSync(path.join(__dirname, 'sample.apng'), Buffer.from(bytes));
console.log(`已写出 web/test/sample.apng (${bytes.length} B)`);

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\nAPNG 测试全部通过 ✔');