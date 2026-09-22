/**
 * svg.js 渲染测试：走 studio+engine 完整流程，检验 SVG 标记结构。
 * 运行: node web/test/test_svg.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Studio = require('../studio.js');
const Svg = require('../svg.js');

const CFG = {
  W: 640, H: 210, charY: 70, charFS: 56,
  mergeX: 320, mergeY: 155,
  answerFS: 62, labelFS: 22, labelX: 30,
  fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif",
};

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${extra}`); }
}

// —— 完整示例流程 ——
const st = Studio.createState('十八口');
for (const c of st.chars) Studio.assignRole(st, c.id, 'zi');
Studio.confirmMerge(st, ['m0', 'm1'], '木');
Studio.confirmMerge(st, ['r0', 'm2'], '杏');
st.answer = '杏';
const tl = Studio.buildTimelineFromState(st, CFG);

// 采样 12 帧构建 SVG
const frames = [];
for (let i = 0; i < 12; i++) {
  const fs = tl.stateAt((tl.duration * i) / 11);
  frames.push({ t: (tl.duration * i) / 11, fs, svg: Svg.svgForState(fs, 640, 210, CFG) });
}

// 结构
for (const { t, svg } of frames) {
  const tag = `t=${t.toFixed(2)}`;
  check(`${tag} 以 <svg 开头`, svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), tag);
  check(`${tag} 以 </svg> 结尾`, svg.endsWith('</svg>'), tag);
  const openG = (svg.match(/<g /g) || []).length;
  const closeG = (svg.match(/<\/g>/g) || []).length;
  check(`${tag} <g> 标签配对`, openG === closeG, `${openG}/${closeG}`);
  check(`${tag} 无 NaN`, !svg.includes('NaN'));
  check(`${tag} 无 undefined`, !svg.includes('undefined'));
}

// 末帧内容
const endSvg = frames[11].svg;
check('末帧含谜底字 杏', endSvg.includes('>杏</text>') || endSvg.includes('杏'), endSvg.slice(0, 200));
check('末帧无独立"谜 底"标签行（谜底并入行2）', !endSvg.includes('谜 底'));
// 行标签（覆盖层）：行1 左端「谜面」常显；行2 左端「谜底」第三阶段淡入
check('末帧含行1左端「谜面」标签', endSvg.includes('>谜面</text>'), endSvg.slice(0, 300));
check('末帧含行2左端「谜底」标签', endSvg.includes('>谜底</text>'), endSvg.slice(0, 300));
check('首帧含「谜面」标签', frames[0].svg.includes('>谜面</text>'));
check('首帧不含「谜底」标签（第三阶段才出现）', !frames[0].svg.includes('>谜底</text>'));
check('末帧含 viewBox 640 210', endSvg.includes('viewBox="0 0 640 210"'));
check('font-family 属性引号正确', /font-family="'PingFang SC',/.test(endSvg), endSvg.match(/font-family="[^"]*"/)[0]);

// 缩放输出（1280x420，即 2x）
const fsEnd = tl.stateAt(tl.duration);
const big = Svg.svgForState(fsEnd, 1280, 420, CFG);
check('2x 输出宽度 1280', big.includes('width="1280"') && big.includes('height="420"'));

// 长谜面：画布高度取时间轴算出的 H（换行后加高），viewBox 与输出尺寸同步
{
  const stLong = Studio.createState('一口咬掉牛尾巴二人土上坐田土日月'); // 16 字
  for (const c of stLong.chars) Studio.assignRole(stLong, c.id, 'zi');
  stLong.answer = '告';
  const tlLong = Studio.buildTimelineFromState(stLong, CFG);
  const cfgLong = Object.assign({}, CFG, { H: tlLong.H });
  const svgLong = Svg.svgForState(tlLong.stateAt(0), 640, tlLong.H, cfgLong);
  check('长谜面 viewBox 高度 = 时间轴 H', svgLong.includes(`viewBox="0 0 640 ${tlLong.H}"`), `H=${tlLong.H}`);
  check('长谜面 H > 210（已换行加高）', tlLong.H > 210, 'H=' + tlLong.H);
  check('长谜面 height 属性跟随 H', svgLong.includes(`height="${tlLong.H}"`));
  // 两行谜面：第 1、9 个字 y 不同（说明确实换行了）
  const itemsLong = tlLong.stateAt(0).items;
  check('长谜面首行与次行 y 不同', Math.round(itemsLong[0].y) !== Math.round(itemsLong[8].y), `${itemsLong[0].y} vs ${itemsLong[8].y}`);
}

// 转义
check('esc 转义 & < >', Svg.esc('A&B<C>D') === 'A&amp;B&lt;C&gt;D');
const odd = Svg.svgForState({ t: 0, items: [{ id: 'x', glyph: 'A&B', x: 10, y: 20, opacity: 1, scale: 1, color: '#000', fontSize: 20 }], overlays: [] }, 100, 100, CFG);
check('markup 中特殊字符已转义', odd.includes('A&amp;B'), odd);

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\nsvg 渲染测试全部通过 ✔');