/**
 * apng.js — 自包含的 APNG 编码器（无第三方依赖）。
 *
 * 依赖浏览器/Node 的 CompressionStream('deflate')（zlib/RFC1950，PNG 所需格式）。
 * 所有帧采用"整帧快照"策略：每帧 fcTL 覆盖全画布，dispose_op=1（帧后清空）、
 * blend_op=0（直接覆盖），保证透明背景动画逐帧独立、无残影。
 *
 * 用法（浏览器）:
 *   const enc = new ApngEncoder(w, h, totalFrames, numPlays, fps);
 *   for (...) { await enc.addFrame(ctx.getImageData(...).data); }
 *   const bytes = await enc.finish();
 *   download(new Blob([bytes], {type:'image/apng'}))
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ApngEncoder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // ---------- 基础工具 ----------
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start || 0; i < (end === undefined ? bytes.length : end); i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function concatBytes(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  function u32be(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, false);
    return b;
  }
  function u16be(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xffff, false);
    return b;
  }

  async function deflateBytes(data) {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('当前环境不支持 CompressionStream（需 Chrome 80+ / Firefox 113+ / Safari 16.4+）');
    }
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const reader = cs.readable.getReader();
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return concatBytes(parts);
  }

  /** 构一个 PNG chunk：length + type + data + crc */
  function chunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + data.length);
    out.set(u32be(data.length), 0);
    out.set(typeBytes, 4);
    out.set(data, 8);
    const crc = crc32(out, 4, 8 + data.length);
    out.set(u32be(crc), 8 + data.length);
    return out;
  }

  // ---------- 编码器 ----------
  class ApngEncoder {
    /**
     * @param {number} width  输出宽度
     * @param {number} height 输出高度
     * @param {number} numFrames 总帧数（须先于 addFrame 传入）
     * @param {number} numPlays 0 = 无限循环，1 = 只播一次
     * @param {number} fps 帧率（delay = 1/fps 秒；1..255）
     */
    constructor(width, height, numFrames, numPlays, fps) {
      if (!(width > 0 && height > 0)) throw new Error('非法尺寸');
      if (!(fps >= 1 && fps <= 255)) throw new Error('fps 需在 1..255');
      this.w = width | 0;
      this.h = height | 0;
      this.numFrames = numFrames | 0;
      this.numPlays = numPlays | 0;
      this.fps = fps | 0;
      this.frames = [];   // {rgba: Uint8Array}
      this.seq = 0;
      this._done = false;
    }

    /**
     * 加入一帧 RGBA 像素（Uint8Array，长度 w*h*4，行优先）。
     * 内部会对每行前置 filter 字节 0（None）并做 zlib 压缩，异步返回。
     */
    async addFrame(rgba) {
      if (this._done) throw new Error('已完成编码');
      if (rgba.length !== this.w * this.h * 4) {
        throw new Error(`帧数据长度不对: ${rgba.length} != ${this.w * this.h * 4}`);
      }
      const raw = new Uint8Array(this.h * (this.w * 4 + 1));
      for (let y = 0; y < this.h; y++) {
        raw[y * (this.w * 4 + 1)] = 0; // filter: None
        raw.set(rgba.subarray(y * this.w * 4, (y + 1) * this.w * 4), y * (this.w * 4 + 1) + 1);
      }
      this.frames.push({ compressed: await deflateBytes(raw) });
    }

    async finish() {
      if (this._done) throw new Error('已 finish');
      this._done = true;
      const out = [];
      out.push(new Uint8Array(SIGNATURE));

      // IHDR
      {
        const d = new Uint8Array(13);
        d.set(u32be(this.w), 0);
        d.set(u32be(this.h), 4);
        d[8] = 8;            // bit depth
        d[9] = 6;            // color type: RGBA
        d[10] = 0;           // compression
        d[11] = 0;           // filter
        d[12] = 0;           // interlace
        out.push(chunk('IHDR', d));
      }

      // acTL
      {
        const d = new Uint8Array(8);
        d.set(u32be(this.frames.length), 0);
        d.set(u32be(this.numPlays), 4);
        out.push(chunk('acTL', d));
      }

      const delayNum = 1;
      const delayDen = this.fps;
      this.seq = 0;

      for (let i = 0; i < this.frames.length; i++) {
        // fcTL（每帧一个，共享序列号空间）
        const fc = new Uint8Array(26);
        fc.set(u32be(this.seq++), 0);
        fc.set(u32be(this.w), 4);
        fc.set(u32be(this.h), 8);
        fc.set(u32be(0), 12);       // x_offset
        fc.set(u32be(0), 16);       // y_offset
        fc.set(u16be(delayNum), 20);
        fc.set(u16be(delayDen), 22);
        fc[24] = 1;                 // dispose_op: 帧后清空（整帧快照）
        fc[25] = 0;                 // blend_op: source
        out.push(chunk('fcTL', fc));

        // 第一帧用 IDAT，其后用 fdAT（fdAT 数据区头部带序号）
        const c = this.frames[i].compressed;
        if (i === 0) {
          out.push(chunk('IDAT', c));
        } else {
          const d = new Uint8Array(4 + c.length);
          d.set(u32be(this.seq++), 0);
          d.set(c, 4);
          out.push(chunk('fdAT', d));
        }
      }

      out.push(chunk('IEND', new Uint8Array(0)));
      return concatBytes(out);
    }
  }

  ApngEncoder.crc32 = crc32;
  ApngEncoder.deflateBytes = deflateBytes;
  ApngEncoder.concatBytes = concatBytes;

  return ApngEncoder;
});