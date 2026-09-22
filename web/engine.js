/**
 * engine.js — 字谜离合动画的时间轴引擎（纯函数，无 DOM）。
 *
 * 核心概念:
 *  - 场景(Scene): 一段有确定时长的动画，如"拆解一个字""两部件合并""谜底揭示"。
 *  - 世界(World): id -> 图形单元 {id,glyph,x,y,opacity,scale,color,fontSize}。
 *  - stateAt(t): 给定全局时间 t(秒)，返回该时刻的完整画面状态。
 *    引擎按场景顺序累积状态，因此任意 t 处的画面都是确定的 ——
 *    预览(60fps 播放)与 APNG 逐帧导出(img 渲染)共用同一套计算，保证所见即所得。
 *
 * 可与模块化环境互操作（浏览器 <script> / Node require）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 基础数学 ----------
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, u) { return a + (b - a) * u; }

  const Easing = {
    linear: u => u,
    easeInCubic: u => u * u * u,
    easeOutCubic: u => 1 - Math.pow(1 - u, 3),
    easeInOutCubic: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    easeOutBack: u => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
    },
  };

  // ---------- 场景工厂 ----------

  /**
   * 拆解：字素字原地淡出，部件从字中心飞散到落点。
   * opts: {charId, parts:[{id,glyph}], spread, drop, duration}
   *  - 默认按圆周散落（spread 为半径）;
   *  - 提供 drop:{y, gap?, centerX?} 时统一拆到字下方横排：部件 i 落在
   *    ((centerX ?? cx) + (i-(n-1)/2)*gap, drop.y)，gap 缺省 64。
   *    centerX 只改**落点**的中心：部件仍从字心 (cx,cy) 起飞，但整组落到不越界的位置
   *    —— 来源字贴近画布边缘、部件又多时，按字心排开会把两侧部件推出画布。
   *  - 提供 drop:{positions:[{x,y}…]} 时逐部件指定落点（呼叫方自己算好每个部件的去处，
   *    例如"停到它即将被合并进去的那次合并的落点附近"），此时忽略 y/gap/centerX。
   */
  function sceneDecompose(opts) {
    const dur = opts.duration != null ? opts.duration : 1.3;
    const parts = opts.parts;
    const n = parts.length;
    return {
      type: 'decompose',
      duration: dur,
      ids: [opts.charId].concat(parts.map(p => p.id)),
      apply(world, u, ctx) {
        const c = world[opts.charId];
        if (!c) return;
        const cx = opts.cx != null ? opts.cx : c.x;
        const cy = opts.cy != null ? opts.cy : c.y;
        const spread = opts.spread != null ? opts.spread : 120;
        const drop = opts.drop; // {y, gap?, centerX?} 统一拆到字下方横排，或 {positions} 逐部件指定
        const uFly = clamp01(u / 0.55);
        for (let i = 0; i < n; i++) {
          const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          const pinned = drop && drop.positions ? drop.positions[i] : null;
          const tx = pinned ? pinned.x
            : drop
              ? (drop.centerX != null ? drop.centerX : cx) + (i - (n - 1) / 2) * (drop.gap != null ? drop.gap : 64)
              : cx + Math.cos(ang) * spread;
          const ty = pinned ? pinned.y
            : drop ? drop.y : cy + Math.sin(ang) * spread;
          const ent = ctx.ensure(parts[i].id, {
            glyph: parts[i].glyph, x: cx, y: cy, opacity: 0, scale: 1,
            color: opts.partColor || '#0c8599', fontSize: opts.partFontSize || 44,
          });
          const k = Easing.easeOutCubic(uFly);
          ent.x = lerp(cx, tx, k);
          ent.y = lerp(cy, ty, k);
          ent.scale = 1;
          ent.opacity = Math.min(1, uFly * 5); // 前 1/5 快速淡入
        }
        // 字素字在部件飞出后淡出
        const uFade = clamp01((u - 0.45) / 0.5);
        c.opacity = 1 - uFade;
        c.scale = 1 - 0.12 * uFade;
      },
    };
  }

  /**
   * 合并：若干部件汇聚到合并点并淡出，合成结果字在合并点弹出。
   * opts: {partIds, result:{id,glyph}, cx, cy, color, duration}
   */
  function sceneMerge(opts) {
    const dur = opts.duration != null ? opts.duration : 1.2;
    const mx = opts.cx != null ? opts.cx : 500;
    const my = opts.cy != null ? opts.cy : 260;
    return {
      type: 'merge',
      duration: dur,
      ids: opts.partIds.concat([opts.result.id]),
      apply(world, u, ctx) {
        const uIn = clamp01(u / 0.55);
        for (const pid of opts.partIds) {
          const e = world[pid];
          const s = ctx.startPos[pid];
          if (!e || !s) continue;
          const k = Easing.easeInCubic(uIn);
          e.x = lerp(s.x, mx, k);
          e.y = lerp(s.y, my, k);
          e.scale = 1 - 0.18 * uIn;
          e.opacity = 1 - clamp01((u - 0.4) / 0.28);
        }
        const res = ctx.ensure(opts.result.id, {
          glyph: opts.result.glyph, x: mx, y: my, opacity: 0, scale: 0.4,
          color: opts.color || '#2f9e44', fontSize: opts.fontSize || 58,
        });
        const uOut = clamp01((u - 0.42) / 0.5);
        res.opacity = Easing.easeOutCubic(uOut);
        res.scale = lerp(0.4, 1, Easing.easeOutBack(clamp01(uOut * 1.25)));
        res.x = mx;
        res.y = my;
      },
    };
  }

  /**
   * 平移：单元从当前位置移动到目标位置。
   * opts: {id, tx, ty, duration}
   */
  function sceneSlide(opts) {
    const dur = opts.duration != null ? opts.duration : 0.7;
    return {
      type: 'slide',
      duration: dur,
      ids: [opts.id],
      apply(world, u, ctx) {
        const e = world[opts.id];
        const s = ctx.startPos[opts.id];
        if (!e || !s) return;
        const k = Easing.easeInOutCubic(u);
        e.x = lerp(s.x, opts.tx, k);
        e.y = lerp(s.y, opts.ty, k);
      },
    };
  }

  /**
   * 位移出谜底：合成结果从当前位置平移（easeOutCubic）到谜底槽位，
   * 途中源字淡出、目标字在槽位淡入放大，完成"位移 + 变形"。
   * opts: {fromId, toId, toGlyph, toX, toY, color, fontSize, duration}
   */
  function sceneDisplaceMorph(opts) {
    const dur = opts.duration != null ? opts.duration : 1.4;
    return {
      type: 'displace',
      duration: dur,
      ids: [opts.fromId, opts.toId],
      apply(world, u, ctx) {
        const src = world[opts.fromId];
        const s = ctx.startPos[opts.fromId];
        if (!src || !s) return;
        const uMove = clamp01(u / 0.55);
        const k = Easing.easeOutCubic(uMove);
        src.x = lerp(s.x, opts.toX, k);
        src.y = lerp(s.y, opts.toY, k);
        src.scale = 1 - 0.12 * uMove;
        src.opacity = 1 - clamp01((u - 0.4) / 0.35); // 40% 后源字淡出
        const dst = ctx.ensure(opts.toId, {
          glyph: opts.toGlyph, x: opts.toX, y: opts.toY,
          opacity: 0, scale: 0.7,
          color: opts.color || '#9c36b5', fontSize: opts.fontSize || 62,
        });
        const uIn = clamp01((u - 0.35) / 0.5);
        dst.opacity = Easing.easeOutCubic(uIn);
        dst.scale = lerp(0.7, 1, Easing.easeOutBack(clamp01(uIn * 1.25)));
        dst.x = opts.toX;
        dst.y = opts.toY;
      },
    };
  }

  /**
   * 揭示谜底：谜底各字依次弹出，同时压暗背景单元。
   * opts: {chars:[{id,glyph,x?,y?}], cx, cy, spacing, color, dimIds, label(文字), duration}
   *   chars 里带 x/y 时按逐字坐标放置（多行谜底用），否则按 cx/cy/spacing 单行居中。
   */
  function sceneReveal(opts) {
    const dur = opts.duration != null ? opts.duration : 1.6;
    const chars = opts.chars;
    const n = chars.length;
    const spacing = opts.spacing != null ? opts.spacing : 150;
    const x0 = (opts.cx != null ? opts.cx : 0) - ((n - 1) * spacing) / 2;
    const posOf = (c, i) => (c.x != null
      ? { x: c.x, y: c.y != null ? c.y : opts.cy }
      : { x: x0 + i * spacing, y: opts.cy });
    return {
      type: 'reveal',
      duration: dur,
      ids: chars.map(c => c.id),
      apply(world, u, ctx) {
        chars.forEach((c, i) => {
          const p = posOf(c, i);
          const ent = ctx.ensure(c.id, {
            glyph: c.glyph, x: p.x, y: p.y,
            opacity: 0, scale: 1.8, color: opts.color || '#9c36b5', fontSize: opts.fontSize || 64,
          });
          const win = clamp01(u * n - i);          // 逐字交错
          ent.opacity = clamp01(win / 0.28);
          ent.scale = lerp(1.8, 1, Easing.easeOutBack(clamp01(win / 0.75)));
          ent.x = p.x;
          ent.y = p.y;
        });
        // "谜 底" 小标签
        if (opts.label != null) {
          const lb = ctx.ensure('__answerLabel', {
            glyph: opts.label, x: opts.cx, y: opts.cy - 58,
            opacity: 0, scale: 1, color: '#9775fa', fontSize: 20,
          });
          const win = n > 0 ? clamp01(u * n * 1.2 - 0.2) : clamp01(u * 1.4 - 0.15);
          lb.opacity = clamp01(win / 0.3);
          lb.x = opts.cx;
          lb.y = opts.cy - 58;
        }
        // 压暗非关键单元
        if (opts.dimIds && opts.dimIds.length) {
          const d = clamp01((u - 0.25) / 0.45);
          for (const id of opts.dimIds) {
            const e = world[id];
            if (e) e.opacity = e.opacity * (1 - 0.7 * d);
          }
        }
      },
    };
  }

  /**
   * 定格：画面完全不变，只留出可读的停留时间（也让循环播放的 GIF 收尾不突兀）。
   * 刻意不产生任何视觉变化 —— 它只用来"让最后一帧看得清"，不要拿它补时长。
   * opts: {duration}
   */
  function sceneHold(opts) {
    const dur = opts && opts.duration != null ? opts.duration : 0.5;
    return { type: 'hold', duration: dur, ids: [], apply() {} };
  }

  // ---------- 时间轴 ----------

  /**
   * 组装时间轴。
   * @param {object} opts
   *   initialItems: [{id,glyph,x,y,opacity,scale,color,fontSize}] 初始单元（谜面各字）
   *   scenes:       场景数组（将按顺序播放）
   *   overlays:     常驻/随时间变化的文字覆盖层 [{text,x,y,fontSize,fill,opacity?,opacityAt?(t)}]
   */
  function buildTimeline(opts) {
    const scenes = opts.scenes || [];
    const overlays = opts.overlays || [];
    const initialItems = opts.initialItems || [];
    const duration = scenes.reduce((a, s) => a + s.duration, 0);

    function makeWorld() {
      const w = {};
      for (const it of initialItems) {
        w[it.id] = {
          id: it.id, glyph: it.glyph,
          x: it.x, y: it.y,
          opacity: it.opacity != null ? it.opacity : 1,
          scale: it.scale != null ? it.scale : 1,
          color: it.color || '#343a40',
          fontSize: it.fontSize != null ? it.fontSize : 56,
          visible: it.visible !== false,
        };
      }
      return w;
    }

    function stateAt(t) {
      const world = makeWorld();
      let acc = 0;
      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        if (t <= acc) break;
        const u = clamp01((t - acc) / sc.duration);
        const startPos = {};
        for (const id of sc.ids) {
          const e = world[id];
          if (e) startPos[id] = { x: e.x, y: e.y, opacity: e.opacity, scale: e.scale };
        }
        sc.apply(world, u, {
          ensure(id, def) {
            let e = world[id];
            if (!e) { e = Object.assign({ id, visible: true }, def); world[id] = e; }
            return e;
          },
          startPos,
          sceneIndex: i,
        });
        if (u >= 1) acc += sc.duration;
        else break;
      }

      const items = [];
      for (const id in world) {
        const e = world[id];
        if (e.visible === false || e.opacity <= 0.004) continue;
        items.push({ id, glyph: e.glyph, x: e.x, y: e.y, opacity: e.opacity, scale: e.scale, color: e.color, fontSize: e.fontSize });
      }
      const ov = overlays.map(o => ({
        text: o.text, x: o.x, y: o.y, fontSize: o.fontSize, fill: o.fill,
        opacity: o.opacityAt ? o.opacityAt(t) : (o.opacity != null ? o.opacity : 1),
      })).filter(o => o.opacity > 0.004);

      return { t, items, overlays: ov };
    }

    return { duration, scenes, stateAt };
  }

  return { Easing, clamp01, lerp, sceneDecompose, sceneMerge, sceneSlide, sceneDisplaceMorph, sceneReveal, sceneHold, buildTimeline };
});