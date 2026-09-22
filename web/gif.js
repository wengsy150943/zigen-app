/**
 * gif.js — 自包含的 GIF89a 编码器（无第三方依赖），用于浏览器原生导出透明背景 GIF 动画。
 *
 * 与 apng.js 的权衡（GIF 格式固有限制，README 有说明）：
 *   - 透明只有 1 位（每像素要么全透明要么不透明，无半透明）；alpha ≥ 128 视为不透明；
 *   - 真彩色需量化到 ≤256 色调色板（本编码器用加权中位切分全局调色板，
 *     文字边缘可能有轻微色带/锯齿，属 GIF 固有表现）。
 *
 * 用法（浏览器；接口与 ApngEncoder 对齐，addFrame/finish 均同步）:
 *   const enc = new GifEncoder(w, h, totalFrames, numPlays, fps);
 *   enc.addFrame(ctx.getImageData(...).data);
 *   const bytes = enc.finish();
 *
 * LZW 与位宽增长逻辑移植自 omggif（Dean McNamee, MIT），已在 test/test_gif.mjs
 * 与 PIL 之间做过往返校验。
 *
 * 帧策略：整帧快照；disposal=2（帧后恢复背景=透明）、每帧独立 GCE。
 * 循环: numPlays=0 → Netscape 循环 0（无限）；numPlays=1 → 无循环扩展（播一次）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GifEncoder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALPHA_THRESHOLD = 128; // alpha ≥ 128 视为不透明
  const MAX_COLORS = 255;      // 透明色占索引 0，颜色最多 255 个

  // ---------------- 加权中位切分（5bit/通道空间，32768 桶） ----------------
  // counts: Uint32Array(32768)，索引 = (r<<10)|(g<<5)|b（各占 5bit）
  // 返回 ≤ maxColors 个 [r,g,b]（8bit 取桶中值）
  function medianCutToPalette(counts, maxColors) {
    const buckets = [];
    for (let i = 0; i < 32768; i++) {
      const n = counts[i];
      if (!n) continue;
      buckets.push({ r: (i >> 10) & 31, g: (i >> 5) & 31, b: i & 31, count: n });
    }
    if (buckets.length === 0) buckets.push({ r: 0, g: 0, b: 0, count: 1 }); // 全透明兜底

    const boxes = [buckets];
    while (boxes.length < maxColors) {
      let bi = -1, best = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length > 1 && boxes[i].length > best) { best = boxes[i].length; bi = i; }
      }
      if (bi < 0) break; // 无更多可分 box
      const box = boxes.splice(bi, 1)[0];
      // 跨度最大的通道
      let ch = 'r', spread = -1;
      for (const c of ['r', 'g', 'b']) {
        let mn = 32, mx = -1;
        for (const bk of box) {
          if (bk[c] < mn) mn = bk[c];
          if (bk[c] > mx) mx = bk[c];
        }
        if (mx - mn > spread) { spread = mx - mn; ch = c; }
      }
      box.sort((a, b) => a[ch] - b[ch]);
      let total = 0;
      for (const bk of box) total += bk.count;
      let acc = 0, cut = -1;
      for (let i = 0; i < box.length; i++) {
        acc += box[i].count;
        if (acc >= total / 2) { cut = i + 1; break; }
      }
      if (cut <= 0 || cut >= box.length) cut = Math.ceil(box.length / 2);
      boxes.push(box.slice(0, cut), box.slice(cut));
    }
    return boxes.map(box => {
      let r = 0, g = 0, b = 0, n = 0;
      for (const bk of box) { r += bk.r * bk.count; g += bk.g * bk.count; b += bk.b * bk.count; n += bk.count; }
      if (!n) n = 1;
      return [((r / n) << 3) | 4, ((g / n) << 3) | 4, ((b / n) << 3) | 4]; // 5bit→8bit 取中值
    });
  }

  // ---------------- GIF LZW 编码（LSB-first 位打包，码宽 2..12 动态增长） ----------------
  // 移植自 omggif 的 GifWriterOutputLZWCodeStream 核心：
  //   先 emit 当前码 →（表满则 emit clear 并重置）→ 否则按 nextCode ≥ 2^codeSize 加宽 → 再插入新表项。
  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const codeMask = clearCode - 1;
    const eoiCode = clearCode + 1;
    let nextCode = eoiCode + 1;
    let curCodeSize = minCodeSize + 1;

    const out = [];
    let cur = 0, curShift = 0;
    const emitCode = (c) => {
      cur |= c << curShift;
      curShift += curCodeSize;
      while (curShift >= 8) { out.push(cur & 0xff); cur >>= 8; curShift -= 8; }
    };

    emitCode(clearCode); // 规范要求首码为 clear
    let ibCode = indices[0] & codeMask; // 当前匹配串的码
    let codeTable = new Map();          // key = (前缀码 << 8) | 尾字节

    for (let i = 1; i < indices.length; i++) {
      const k = indices[i] & codeMask;
      const key = (ibCode << 8) | k;
      const found = codeTable.get(key);
      if (found === undefined) {
        emitCode(ibCode);
        if (nextCode === 4096) { // 表满：发 clear，双端同步重置
          emitCode(clearCode);
          nextCode = eoiCode + 1;
          curCodeSize = minCodeSize + 1;
          codeTable = new Map();
        } else {
          // 关键：先按「即将插入的码号」判断是否需要加宽，再插入
          if (nextCode >= (1 << curCodeSize)) curCodeSize++;
          codeTable.set(key, nextCode++);
        }
        ibCode = k;
      } else {
        ibCode = found;
      }
    }
    emitCode(ibCode);
    emitCode(eoiCode);
    while (curShift > 0) { out.push(cur & 0xff); cur >>= 8; curShift -= 8; }

    return new Uint8Array(out);
  }

  // ---------------- 编码器 ----------------
  class GifEncoder {
    /**
     * @param {number} width/height 输出尺寸
     * @param {number} numFrames 总帧数
     * @param {number} numPlays 0=无限循环，1=只播一次
     * @param {number} fps 帧率（GIF 延迟单位 1/100s，取整）
     */
    constructor(width, height, numFrames, numPlays, fps) {
      if (!(width > 0 && height > 0)) throw new Error('非法尺寸');
      if (!(fps >= 1 && fps <= 100)) throw new Error('fps 需在 1..100');
      this.w = width | 0;
      this.h = height | 0;
      this.numFrames = numFrames | 0;
      this.numPlays = numPlays | 0;
      this.fps = fps | 0;
      this.frames = []; // 每帧 RGBA 快照
      this._done = false;
    }

    addFrame(rgba) {
      if (this._done) throw new Error('已完成编码');
      if (rgba.length !== this.w * this.h * 4) {
        throw new Error(`帧数据长度不对: ${rgba.length} != ${this.w * this.h * 4}`);
      }
      this.frames.push(new Uint8Array(rgba));
    }

    finish() {
      if (this._done) throw new Error('已 finish');
      this._done = true;
      const W = this.w, H = this.h, N = this.frames.length;
      if (N === 0) throw new Error('无帧可编码');

      // 1) 统计不透明像素颜色（5bit/通道）
      const counts = new Uint32Array(32768);
      for (const f of this.frames) {
        for (let i = 0; i < f.length; i += 4) {
          if (f[i + 3] >= ALPHA_THRESHOLD) {
            counts[((f[i] >> 3) << 10) | ((f[i + 1] >> 3) << 5) | (f[i + 2] >> 3)]++;
          }
        }
      }

      // 2) 中位切分 → 颜色调色板（索引 0 留给透明）
      const colors = medianCutToPalette(counts, MAX_COLORS);
      const palette = [[0, 0, 0], ...colors];

      // 3) 5bit 桶 → 最近调色板索引 LUT（排除透明 idx0）
      const lut = new Uint16Array(32768);
      for (let i = 0; i < 32768; i++) {
        const r = ((i >> 10) & 31) << 3, g = ((i >> 5) & 31) << 3, b = (i & 31) << 3;
        let best = 1, bd = Infinity;
        for (let p = 1; p < palette.length; p++) {
          const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = p; }
        }
        lut[i] = best;
      }

      // 4) 调色板大小取 2 的幂：p 位码 → GCT 2^p 项，size 字段 = p-1
      //    GIF 实践要求码宽 ≥ 2（否则 clear/eoi 占满码空间）
      let p = 2;
      while ((1 << p) < palette.length) p++;
      const tableSize = 1 << p;
      const minCodeSize = p;
      const delayCenti = Math.max(1, Math.round(100 / this.fps));

      const encoder = new TextEncoder();
      const out = [];
      out.push(encoder.encode('GIF89a'));
      // 逻辑屏幕描述符
      {
        const d = new Uint8Array(7);
        d[0] = W & 255; d[1] = (W >> 8) & 255;
        d[2] = H & 255; d[3] = (H >> 8) & 255;
        d[4] = 0x80 | (((p - 1) & 7) << 4) | ((p - 1) & 7); // GCT 标志 + 色深 + GCT size
        d[5] = 0; // 背景色索引 = 透明
        d[6] = 0;
        out.push(d);
      }
      // 全局调色板（补齐到 tableSize 项）
      {
        const gct = new Uint8Array(tableSize * 3);
        for (let i = 0; i < tableSize; i++) {
          const c = palette[i] || [0, 0, 0];
          gct[i * 3] = c[0]; gct[i * 3 + 1] = c[1]; gct[i * 3 + 2] = c[2];
        }
        out.push(gct);
      }
      // Netscape 循环扩展（仅无限循环）
      if (this.numPlays === 0) {
        out.push(new Uint8Array([0x21, 0xff, 0x0b,
          ...encoder.encode('NETSCAPE2.0'),
          0x03, 0x01, 0x00, 0x00, 0x00]));
      }

      // 5) 逐帧：GCE + 图像描述符 + LZW 数据（子块 ≤255 字节）
      for (const f of this.frames) {
        const idx = new Uint8Array(W * H);
        for (let i = 0, q = 0; i < f.length; i += 4, q++) {
          idx[q] = f[i + 3] >= ALPHA_THRESHOLD
            ? lut[((f[i] >> 3) << 10) | ((f[i + 1] >> 3) << 5) | (f[i + 2] >> 3)]
            : 0;
        }
        // 图形控制扩展：packed = disposal(2)<<2 | transparency(1) = 0x09
        out.push(new Uint8Array([0x21, 0xf9, 0x04, 0x09,
          delayCenti & 255, (delayCenti >> 8) & 255, 0x00, 0x00]));
        // 图像描述符（整帧，无局部调色板）
        out.push(new Uint8Array([0x2c, 0, 0, 0, 0,
          W & 255, (W >> 8) & 255, H & 255, (H >> 8) & 255, 0x00]));
        // LZW 数据
        const packed = lzwEncode(idx, minCodeSize);
        out.push(new Uint8Array([minCodeSize]));
        let off = 0;
        while (off < packed.length) {
          const len = Math.min(255, packed.length - off);
          const sub = new Uint8Array(1 + len);
          sub[0] = len;
          sub.set(packed.subarray(off, off + len), 1);
          out.push(sub);
          off += len;
        }
        out.push(new Uint8Array([0x00]));
      }
      out.push(new Uint8Array([0x3b])); // trailer

      let total = 0;
      for (const c of out) total += c.length;
      const res = new Uint8Array(total);
      let o = 0;
      for (const c of out) { res.set(c, o); o += c.length; }
      return res;
    }
  }

  return GifEncoder;
});