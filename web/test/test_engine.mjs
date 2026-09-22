/**
 * 时间轴引擎测试（Node 直接运行，无浏览器依赖）。
 * 场景模拟: 谜面 "十八口" → 十+八=木 → 木+口=杏 → 揭示谜底
 * 运行: node web/test/test_engine.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../engine.js');

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${extra}`); }
}
const hasNaN = o => JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? 'NaN!' : v)).includes('NaN');

// --- 组装时间轴 ---
const spread = 120;
const timeline = E.buildTimeline({
  initialItems: [
    { id: 'c0', glyph: '十', x: 380, y: 200, color: '#2f9e44', fontSize: 56 },
    { id: 'c1', glyph: '八', x: 500, y: 200, color: '#2f9e44', fontSize: 56 },
    { id: 'c2', glyph: '口', x: 620, y: 200, color: '#2f9e44', fontSize: 56 },
  ],
  scenes: [
    // 十 → 一 丨
    E.sceneDecompose({ charId: 'c0', parts: [{ id: 'p0', glyph: '一' }, { id: 'p1', glyph: '丨' }], spread }),
    // 一 + 丨 → 木 （直接合并部件）
    E.sceneMerge({ partIds: ['p0', 'p1'], result: { id: 'm0', glyph: '木' }, cx: 500, cy: 260 }),
    // 木 + 口 → 杏
    E.sceneMerge({ partIds: ['m0', 'c2'], result: { id: 'm1', glyph: '杏' }, cx: 500, cy: 280 }),
    // 结果滑到展示位
    E.sceneSlide({ id: 'm1', tx: 500, ty: 300 }),
    // 揭示谜底
    E.sceneReveal({ chars: [{ id: 'a0', glyph: '杏' }], cx: 500, cy: 420, spacing: 100, dimIds: ['c0', 'c1', 'c2', 'p0', 'p1', 'm0', 'm1'], label: '谜 底' }),
  ],
  overlays: [{ text: '谜面：十八口', x: 500, y: 40, fontSize: 20, fill: '#868e96' }],
});

const dur = timeline.duration;
console.log(`时间轴总时长: ${dur.toFixed(2)}s，场景数: ${timeline.scenes.length}`);
check('时长 > 0 且 = 各场景之和', Math.abs(dur - timeline.scenes.reduce((a, s) => a + s.duration, 0)) < 1e-9);

// --- t=0 ---
let fs = timeline.stateAt(0);
check('t=0 三字可见', fs.items.filter(i => i.opacity > 0.5).length === 3, JSON.stringify(fs.items.map(i => i.glyph)));
check('t=0 无 NaN', !hasNaN(fs));
const p0at0 = fs.items.find(i => i.id === 'p0');
check('t=0 部件未出现', p0at0 === undefined);

// --- 拆解中段：部件离开字中心 ---
const tDecMid = timeline.scenes[0].duration / 2;
fs = timeline.stateAt(tDecMid);
const p0 = fs.items.find(i => i.id === 'p0');
const p1 = fs.items.find(i => i.id === 'p1');
check('拆解中段部件已出现', p0 && p1);
if (p0) {
  const d0 = Math.hypot(p0.x - 380, p0.y - 200);
  check('拆解中段部件已飞离 (>0 且 <spread)', d0 > 5 && d0 < spread, `d=${d0.toFixed(1)}`);
}

// --- 拆解结束：部件到位、原字消失 ---
const tDecEnd = timeline.scenes[0].duration;
fs = timeline.stateAt(tDecEnd);
check('拆解结束原字消失（已不可见）', fs.items.find(i => i.id === 'c0') === undefined);
for (const pid of ['p0', 'p1']) {
  const p = fs.items.find(i => i.id === pid);
  const d = Math.hypot(p.x - 380, p.y - 200);
  check(`拆解结束 ${pid} 停在环上 (≈${spread})`, d > spread - 1 && d < spread + 1, `d=${d.toFixed(2)}`);
}

// --- 合并1结束：m0 出现、部件消失 ---
let acc = timeline.scenes[0].duration + timeline.scenes[1].duration;
fs = timeline.stateAt(acc);
check('合并1结束 m0(木) 可见', (fs.items.find(i => i.id === 'm0') || {}).opacity === 1);
check('合并1结束 p0 消失（已不可见）', fs.items.find(i => i.id === 'p0') === undefined);

// --- 合并2结束：m1(杏) 出现 ---
acc += timeline.scenes[2].duration;
fs = timeline.stateAt(acc);
check('合并2结束 m1(杏) 可见', (fs.items.find(i => i.id === 'm1') || {}).opacity === 1);

// --- 末尾：谜底揭示 ---
fs = timeline.stateAt(dur);
const a0 = fs.items.find(i => i.id === 'a0');
check('末尾谜底字出现且不透明', a0 && a0.opacity === 1, JSON.stringify(a0 || null));
check('末尾存在"谜 底"标签', fs.items.some(i => i.id === '__answerLabel'));
check('末尾谜面覆盖层可见', fs.overlays.length === 1 && fs.overlays[0].text.includes('十八口'));
check('末尾无 NaN', !hasNaN(fs));

// --- 确定性 & 中段采样 ---
const s1 = JSON.stringify(timeline.stateAt(dur * 0.63));
const s2 = JSON.stringify(timeline.stateAt(dur * 0.63));
check('同 t 状态确定', s1 === s2);
const mid = timeline.stateAt(acc + timeline.scenes[3].duration / 2);
check('slide 中段是中间位置', (mid.items.find(i => i.id === 'm1') || { y: -1 }).y > 280 && (mid.items.find(i => i.id === 'm1') || { y: -1 }).y < 300);

// --- 随机长程采样防 NaN/爆值 ---
let allOk = true;
for (let i = 0; i <= 200; i++) {
  const st = timeline.stateAt((dur * i) / 200);
  if (hasNaN(st)) { allOk = false; console.error(`  t=${(dur * i / 200).toFixed(2)} 出现 NaN`); break; }
  for (const it of st.items) {
    if (it.opacity < -0.001 || it.opacity > 1.001 || it.scale < 0 || it.scale > 3) {
      allOk = false; console.error(`  t=${(dur * i / 200).toFixed(2)} ${it.id} opacity=${it.opacity} scale=${it.scale}`); break;
    }
  }
}
check('200 点采样全部合法（无 NaN/越界）', allOk);

// --- t 越界行为 ---
const over = timeline.stateAt(dur + 10);
check('t 超过总时长后画面保持末帧', JSON.stringify(over.items.map(i => [i.id, i.opacity])).includes('a0'));

// --- 位移+变形场景 sceneDisplaceMorph ---
const tl2 = E.buildTimeline({
  initialItems: [
    { id: 'r1', glyph: '杏', x: 500, y: 262, color: '#0c8599', fontSize: 54 },
  ],
  scenes: [
    E.sceneDisplaceMorph({ fromId: 'r1', toId: 'a0', toGlyph: '杏', toX: 500, toY: 412, color: '#9c36b5', fontSize: 62 }),
  ],
  overlays: [],
});
const disDur = tl2.scenes[0].duration;
const disEarly = tl2.stateAt(disDur * 0.15);
const r1mid = disEarly.items.find(i => i.id === 'r1');
check('位移早段源字位于起点与终点之间', r1mid && r1mid.y > 262 && r1mid.y < 412, `y=${r1mid ? r1mid.y.toFixed(1) : 'missing'}`);
const disMid = tl2.stateAt(disDur * 0.5);
const a0mid = disMid.items.find(i => i.id === 'a0');
check('位移中段目标字已在槽位淡入', a0mid && a0mid.x === 500 && a0mid.y === 412 && a0mid.opacity > 0, JSON.stringify(a0mid || null));
const disEnd = tl2.stateAt(disDur);
check('位移结束源字消失', disEnd.items.find(i => i.id === 'r1') === undefined);
const a0end = disEnd.items.find(i => i.id === 'a0');
check('位移结束目标字完全显示在谜底位', a0end && a0end.x === 500 && a0end.y === 412 && a0end.opacity === 1 && a0end.glyph === '杏', JSON.stringify(a0end || null));
check('位移结束无 NaN', !hasNaN(disEnd));

// --- 定格场景 sceneHold：不产生任何画面变化，只延长时长 ---
const snap = fs => fs.items.map(i => [i.id, i.x, i.y, i.opacity, i.scale, i.glyph].join('@')).sort().join('|');
const tl3 = E.buildTimeline({
  initialItems: tl2.stateAt(tl2.duration).items, // 接着位移走完的画面
  scenes: [E.sceneHold({ duration: 0.5 })],
  overlays: [],
});
check('hold 默认时长 0.5s，总时长随之增加', tl3.scenes[0].duration === 0.5 && tl3.duration === 0.5, `dur=${tl3.duration}`);
check('hold 期间画面逐项不变', snap(tl3.stateAt(0.001)) === snap(tl3.stateAt(0.25)) && snap(tl3.stateAt(0.25)) === snap(tl3.stateAt(0.5)), snap(tl3.stateAt(0.001)));
check('hold 不新增单元', tl3.stateAt(0.5).items.length === tl3.stateAt(0.001).items.length);
check('hold 不引入 NaN', !hasNaN(tl3.stateAt(0.3)));
check('超过总时长后保持末帧（定格不会被重置）', snap(tl3.stateAt(9)) === snap(tl3.stateAt(0.5)));
check('位移末帧与定格末帧一致（接在位移后就是干净的收尾）', snap(tl3.stateAt(0.5)) === snap(tl2.stateAt(tl2.duration)));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n引擎测试全部通过 ✔');