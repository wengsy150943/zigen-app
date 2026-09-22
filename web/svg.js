/**
 * svg.js — 画面状态 -> SVG 标记（预览与 APNG 逐帧导出共用，保证所见即所得）。
 * 纯字符串构建，无 DOM，Node 可测。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Svg = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => Math.round(v * 100) / 100;

  /** 仅画布内部（不含 <svg> 根） */
  function svgInner(fs) {
    const parts = [];
    for (const it of fs.items) {
      parts.push(
        `<g transform="translate(${num(it.x)} ${num(it.y)}) scale(${num(it.scale)})" opacity="${num(it.opacity)}">` +
        `<text x="0" y="0" font-size="${it.fontSize}" fill="${it.color}" text-anchor="middle" dominant-baseline="central">${esc(it.glyph)}</text></g>`
      );
    }
    for (const o of fs.overlays) {
      parts.push(
        `<text x="${num(o.x)}" y="${num(o.y)}" font-size="${o.fontSize}" fill="${o.fill}" opacity="${num(o.opacity)}" text-anchor="${o.anchor || 'middle'}" dominant-baseline="central">${esc(o.text)}</text>`
      );
    }
    return parts.join('');
  }

  /**
   * @param fs   engine stateAt 的输出
   * @param w/h  输出尺寸（数字或 '100%'）
   * @param cfg  {W,H,fontFamily}
   */
  function svgForState(fs, w, h, cfg) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${cfg.W} ${cfg.H}" font-family="${cfg.fontFamily}">${svgInner(fs)}</svg>`;
  }

  return { svgInner, svgForState, esc, num };
});