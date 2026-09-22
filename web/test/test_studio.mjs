/**
 * studio.js 制作流程端到端测试（Node，无浏览器）。
 * 场景A: 谜面 "十八口" → 直接合并 十+八=木 → 木+口=杏 → 谜底 杏
 * 场景B: 谜面 "木口"   → 木 的三条拆法摊平为 十,人,八,一,小 → 十+人=木 → 木+口=杏
 * 运行: node web/test/test_studio.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Studio = require('../studio.js');
const DECOMP_DATA = require('../data/decomp.js');

const CFG = {
  W: 640, H: 210, charY: 70, charFS: 56,
  mergeX: 320, mergeY: 155,
  answerFS: 62, labelFS: 22, labelX: 30,
};

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${extra}`); }
}
const hasNaN = fs => JSON.stringify(fs, (k, v) => (typeof v === 'number' && !isFinite(v) ? 'NaN!' : v)).includes('NaN');
function sampleOk(tl) {
  for (let i = 0; i <= 300; i++) {
    const fs = tl.stateAt((tl.duration * i) / 300);
    if (hasNaN(fs)) return `t=${(tl.duration * i / 300).toFixed(2)} 出现 NaN`;
    for (const it of fs.items) {
      if (it.opacity < -0.001 || it.opacity > 1.001 || it.scale < 0 || it.scale > 3) return `t=${i / 300} ${it.id} 非法值`;
    }
  }
  return null;
}

// ============ 场景 A：字素字直接合并 ============
console.log('— 场景 A：十八口 —');
const stA = Studio.createState('十八口');
check('谜面 3 字', stA.chars.length === 3);
check('初始角色全为 none', stA.chars.every(c => c.role === 'none'));

for (const c of stA.chars) Studio.assignRole(stA, c.id, 'zi');
check('角色标注生效', stA.chars.every(c => c.role === 'zi'));

const cand1 = Studio.findCandidates(['十', '八']);
check('候选(十,八) exact 含 木', cand1.exact.includes('木'), JSON.stringify(cand1));
Studio.confirmMerge(stA, ['m0', 'm1'], '木');
Studio.confirmMerge(stA, ['r0', 'm2'], '杏');
check('合成记录 2 条', stA.merges.length === 2 && stA.merges[1].glyph === '杏');

stA.answer = '杏';
const tlA = Studio.buildTimelineFromState(stA, CFG);
check('场景序列 = merge,merge,hold（合成结果直接落位，无位移阶段）', tlA.scenes.map(s => s.type).join(',') === 'merge,merge,hold', tlA.scenes.map(s => s.type).join(','));
check('A: 不含 displace（省掉整个位移阶段）', !tlA.scenes.some(s => s.type === 'displace'), tlA.scenes.map(s => s.type).join(','));
check('A: 不含空 reveal（末段不是无变化的死时间）', !tlA.scenes.some(s => s.type === 'reveal'), tlA.scenes.map(s => s.type).join(','));
check('A: 总时长 = 2 次合并 + 0.5s 定格 = 2.9s', Math.abs(tlA.duration - 2.9) < 0.01, tlA.duration.toFixed(2));
const badA = sampleOk(tlA);
check('300 点采样全部合法', !badA, badA || '');
const endA = tlA.stateAt(tlA.duration);
check('A: 末尾谜底字可见', endA.items.some(i => i.glyph === '杏' && i.opacity === 1));
check('A: 承担谜底的是合成结果本身（不再另造 a0）', tlA.answerUnits[0] === 'r1' && !endA.items.some(i => i.id === 'a0'), JSON.stringify(tlA.answerUnits));
check('A: r1 直接落在谜底槽位（行2 中心，无横移）', endA.items.some(i => i.id === 'r1' && i.glyph === '杏' && i.x === 320 && i.y === 155 && i.opacity === 1));
check('A: r0(木) 是 r1 的输入，已被合并消耗 -> 末帧只剩谜底', !endA.items.some(i => i.id === 'r0') && endA.items.filter(i => i.opacity > 0.5).length === 1, endA.items.map(i => i.id).join(','));
check('A: 末尾无"谜 底"独立标签（谜底并入行2）', !endA.items.some(i => i.id === '__answerLabel'));
// 行标签：行1 左端常显「谜面」；行2 左端在"谜底开始成形"时淡入
const ovA0 = tlA.stateAt(0).overlays;
check('A: 起始即显示行1左端「谜面」标签', ovA0.some(o => o.text === '谜面' && o.x === 30 && o.y === 70 && o.opacity === 1), JSON.stringify(ovA0));
check('A: 起始不显示「谜底」标签（落位后才出现）', !ovA0.some(o => o.text === '谜底'), JSON.stringify(ovA0));
check('A: 末尾「谜底」标签在行2左端', endA.overlays.some(o => o.text === '谜底' && o.x === 30 && o.y === 155 && o.opacity === 1), JSON.stringify(endA.overlays));
// 落位标记：中间产物 r0 会被 r1 当输入用，所以它一出现就在谜底位上（"谜底开始成形"=t0）
check('A: 中间产物与最终结果都标记为落在谜底位', tlA.scenes[0].landsOnAnswer === true && tlA.scenes[1].landsOnAnswer === true, tlA.scenes.map(s => s.landsOnAnswer).join(','));
check('A: 「谜底」标签在第 0.4s 内淡入', tlA.stateAt(0.2).overlays.some(o => o.text === '谜底' && o.opacity > 0.4 && o.opacity < 1)
  && tlA.stateAt(0.5).overlays.some(o => o.text === '谜底' && o.opacity > 0.99));
// 落位合并的全过程都在槽位（不再有"合并点 → 槽位"的横向移动）
const midA = tlA.stateAt(tlA.scenes[0].duration + tlA.scenes[1].duration * 0.5).items.find(i => i.id === 'r1');
check('A: 落位合并中段 r1 始终停在谜底槽位 x（不横移）', midA && midA.x === 320 && midA.y === 155, `x=${midA ? midA.x.toFixed(1) : 'missing'}`);
// 回归：中间产物 r0(木) 从出现到被消耗，x 一次都不变（曾经先弹在合并层 275 再横滑到 320）
{
  const xs = [];
  for (let k = 0; k <= 24; k++) {
    const it = tlA.stateAt((tlA.duration * k) / 24).items.find(i => i.id === 'r0');
    if (it) xs.push(+it.x.toFixed(3));
  }
  check('A: 中间产物 r0 全程停在谜底位（无"先拼出、再位移"二段运动）',
    xs.length >= 5 && xs.every(x => x === 320), [...new Set(xs)].join(','));
}

// 定格场景必须真的"什么都不做"：起止画面逐项一致
{
  const holdA = tlA.scenes[tlA.scenes.length - 1];
  const tH = tlA.duration - holdA.duration;
  const s1 = tlA.stateAt(tH + 0.01), s2 = tlA.stateAt(tlA.duration);
  const key = fs => fs.items.map(i => [i.id, i.x.toFixed(3), i.y.toFixed(3), i.opacity.toFixed(3), i.scale.toFixed(3)].join('@')).sort().join('|');
  check('A: hold 场景无任何画面变化', holdA.type === 'hold' && key(s1) === key(s2), key(s1) + ' vs ' + key(s2));
}

// ============ 场景 B：全部拆法摊平 + 部件合并 ============
console.log('— 场景 B：木口（木 拆成 十+八）—');
const stB = Studio.createState('木口');
Studio.assignRole(stB, 'm0', 'zi');
Studio.assignRole(stB, 'm1', 'zi');
check('B: 木 的部件 = 三条拆法一次摊平（不区分拆法；跨拆法同字形只留一块：十 只出现一次）',
  stB.parts.filter(p => p.from === 'm0').map(p => p.glyph).join(',') === '十,人,八,一,小',
  stB.parts.filter(p => p.from === 'm0').map(p => p.glyph).join(','));
check('B: 部件 id 唯一', new Set(stB.parts.map(p => p.id)).size === stB.parts.length);

Studio.confirmMerge(stB, ['m0-p0', 'm0-p1'], '木');
Studio.confirmMerge(stB, ['r0', 'm1'], '杏');
stB.answer = '杏';
const tlB = Studio.buildTimelineFromState(stB, CFG);
const typesB = tlB.scenes.map(s => s.type).join(',');
check('B: 场景序列 = decompose,merge,merge,hold', typesB === 'decompose,merge,merge,hold', typesB);
const badB = sampleOk(tlB);
check('B: 300 点采样全部合法', !badB, badB || '');
// 拆解中段部件应出现在环上
const tDec1 = tlB.scenes[0].duration / 2;
const midB = tlB.stateAt(tDec1);
check('B: 拆解中段部件可见', midB.items.some(i => i.id === 'm0-p0' && i.opacity > 0.3));

// ============ 场景 C：多段谜底配对（木口艹化 → 杏花） ============
console.log('— 场景 C：木口艹化 → 杏花（多段谜底）—');
const stC = Studio.createState('木口艹化');
for (const c of stC.chars) Studio.assignRole(stC, c.id, 'zi');
Studio.confirmMerge(stC, ['m0', 'm1'], '杏');
Studio.confirmMerge(stC, ['m2', 'm3'], '花');
stC.answer = '杏花';
const autoC = Studio.autoPair(stC);
check('C: 自动配对 = 杏→槽0, 花→槽1', autoC.r0 === 0 && autoC.r1 === 1, JSON.stringify(autoC));
const tlC = Studio.buildTimelineFromState(stC, CFG);
check('C: 场景序列 = merge,merge,hold', tlC.scenes.map(s => s.type).join(',') === 'merge,merge,hold', tlC.scenes.map(s => s.type).join(','));
const badC = sampleOk(tlC);
check('C: 300 点采样全部合法', !badC, badC || '');
const endC = tlC.stateAt(tlC.duration);
const u0c = endC.items.find(i => i.id === tlC.answerUnits[0]);
const u1c = endC.items.find(i => i.id === tlC.answerUnits[1]);
check('C: 两段谜底各自落位（杏@245 花@395，行2）', u0c && u1c && u0c.glyph === '杏' && u1c.glyph === '花' && u0c.x === 245 && u1c.x === 395 && u0c.y === 155 && u1c.y === 155, JSON.stringify([u0c, u1c]));
check('C: 两个合成结果就是末帧的谜底单元', tlC.answerUnits[0] === 'r0' && tlC.answerUnits[1] === 'r1', JSON.stringify(tlC.answerUnits));

// --- 手动配对覆盖自动配对（交换槽位：杏→槽1、花→槽0） ---
Studio.pairResult(stC, 'r0', 1);
Studio.pairResult(stC, 'r1', 0);
const effC = Studio.effectivePairs(stC);
check('C: 手动配对生效', effC.r0 === 1 && effC.r1 === 0, JSON.stringify(effC));
const tlC2 = Studio.buildTimelineFromState(stC, CFG);
check('C: 交换后 r0 落在槽1、r1 落在槽0', tlC2.answerUnits[0] === 'r1' && tlC2.answerUnits[1] === 'r0', JSON.stringify(tlC2.answerUnits));
check('C: 交换后第一个合并场景就落在谜底槽位', tlC2.scenes[0].landsOnAnswer === true, 'scene0=' + tlC2.scenes[0].type);
const r0mid = tlC2.stateAt(tlC2.scenes[0].duration * 0.6).items.find(i => i.id === 'r0');
check('C: 交换后 r0 合并全程在 395（不横移）', r0mid && r0mid.x === 395, `x=${r0mid ? r0mid.x.toFixed(1) : 'missing'}`);
const endC2 = tlC2.stateAt(tlC2.duration);
// 关键：显示的是"该槽位的谜底字"，所以即使交换配对也不会把谜底顺序弄反
const fC2 = [0, 1].map(slot => {
  const u = endC2.items.find(i => i.id === tlC2.answerUnits[slot]);
  return u ? u.glyph + '@' + Math.round(u.x) : null;
}).join(' ');
check('C: 交换配对后槽位仍按谜底顺序显示（杏@245 花@395）', fC2 === '杏@245 花@395', fC2);

// --- 解除配对：被解的结果滑行归位、对应谜底字改弹出 ---
Studio.unpairResult(stC, 'r1');
const effC2 = Studio.effectivePairs(stC);
check('C: 解除后仅 r0 配对', Object.keys(effC2).length === 1 && effC2.r0 === 1, JSON.stringify(effC2));
const tlC3 = Studio.buildTimelineFromState(stC, CFG);
check('C: 解除后序列 merge,merge,reveal,hold（有未配对谜底字才揭示）', tlC3.scenes.map(s => s.type).join(',') === 'merge,merge,reveal,hold', tlC3.scenes.map(s => s.type).join(','));
check('C: 解除后 slot0 由 reveal 弹出、slot1 由 r0 落位', tlC3.answerUnits[0] === 'a0' && tlC3.answerUnits[1] === 'r0', JSON.stringify(tlC3.answerUnits));
const endC3 = tlC3.stateAt(tlC3.duration);
check('C: a0(杏)弹出、r0 落位显示花', endC3.items.some(i => i.id === 'a0' && i.glyph === '杏' && i.opacity === 1) && endC3.items.some(i => i.id === 'r0' && i.glyph === '花' && i.x === 395 && i.opacity === 1));

// --- 中间产物不能承担谜底（它会被后续合并吸收，末帧会凭空少一个字） ---
Studio.pairResult(stC, 'r0', 0);
Studio.pairResult(stC, 'r1', 1);
const stF = Studio.createState('十八口');
for (const c of stF.chars) Studio.assignRole(stF, c.id, 'zi');
Studio.confirmMerge(stF, ['m0', 'm1'], '木');   // r0 —— 会被 r1 吃掉
Studio.confirmMerge(stF, ['r0', 'm2'], '杏');   // r1
stF.answer = '杏子';
const liveF = Studio.liveMerges(stF).map(m => m.id);
check('P: 活着的合成结果只有 r1（r0 被吸收）', liveF.join(',') === 'r1', JSON.stringify(liveF));
const autoF = Studio.autoPair(stF);
check('P: 自动配对不会把中间产物 r0 配给「子」', autoF.r0 === undefined && autoF.r1 === 0, JSON.stringify(autoF));
const tlF = Studio.buildTimelineFromState(stF, CFG);
check('P: 没有来源的谜底字仍会弹出（杏落位 + 子 reveal）', tlF.answerUnits[0] === 'r1' && tlF.answerUnits[1] === 'a1', JSON.stringify(tlF.answerUnits));
check('P: 末帧两个谜底字都在（旧实现末帧只剩「杏」）', endAnswerString(tlF) === '杏子', endAnswerString(tlF));
check('P: 中间产物 r0 全程不冒充谜底字', !tlF.stateAt(tlF.duration).items.some(i => i.id === 'r0' && i.opacity > 0.5));

// --- 谜底一个颜色：落位的合成结果 / 兜底弹出 / 「谜底」行标签 都是 ANSWER_COLOR ---
const colorOf = (tl, id) => {
  const set = new Set();
  for (let i = 0; i <= 120; i++) {
    const it = tl.stateAt((tl.duration * i) / 120).items.find(x => x.id === id);
    if (it) set.add(it.color);
  }
  return [...set];
};
check('P: reveal 弹出的谜底字与落位合成结果同色（不再"先青后紫"）',
  colorOf(tlF, 'a1').join() === colorOf(tlF, 'r1').join(), colorOf(tlF, 'a1') + ' vs ' + colorOf(tlF, 'r1'));
const labelF = tlF.stateAt(tlF.duration).overlays.find(o => o.text === '谜底');
check('P: 「谜底」行标签也用同一个谜底色', !!labelF && labelF.fill === colorOf(tlF, 'r1')[0], labelF && labelF.fill);
let colorShift = 0;
for (const it of tlF.stateAt(tlF.duration).items) if (!it.color) colorShift++;
check('P: 没有任何单元在动画中换色', colorShift === 0);

// --- 手动只配一段：空槽由"字形对得上的活结果"补位，不再多出末尾 reveal ---
const stP = Studio.createState('千古');
for (const c of stP.chars) Studio.assignRole(stP, c.id, 'zi');
Studio.confirmMerge(stP, ['m0-p0', 'm1-p0'], '千');
Studio.confirmMerge(stP, ['m0-p1', 'm1-p1'], '古');
stP.answer = '千古';
Studio.pairResult(stP, 'r0', 0);
const effP = Studio.effectivePairs(stP);
check('Q: 手动配了 r0，空槽仍自动补上字形相同的 r1（古→槽1）', effP.r0 === 0 && effP.r1 === 1, JSON.stringify(effP));
const tlP = Studio.buildTimelineFromState(stP, CFG);
check('Q: 不再有多余的 reveal 段（旧实现 merge,merge,reveal,hold 6.5s）',
  tlP.scenes.map(s => s.type).join(',') === 'decompose,decompose,merge,merge,hold', tlP.scenes.map(s => s.type).join(','));
check('Q: 末帧两个谜底字都在且都在谜底槽位', endAnswerString(tlP) === '千古', endAnswerString(tlP));
const endP = endAnswerUnits(tlP);
check('Q: 两个谜底字位置 = 槽位（245 / 395），同一行同色',
  endP[0].x === 245 && endP[1].x === 395 && endP[0].color === endP[1].color, JSON.stringify(endP.map(u => [u.x, u.color])));
// 显式解除是明确的"别放这里"：不能被自动补位吃掉，但颜色同样统一
Studio.unpairResult(stP, 'r1');
const effP2 = Studio.effectivePairs(stP);
const tlP2 = Studio.buildTimelineFromState(stP, CFG);
check('Q: 手动解除过的结果不参与补位（解除有效）', effP2.r1 === undefined, JSON.stringify(effP2));
check('Q: 解除后该槽由 reveal 兜底，颜色仍是谜底色',
  tlP2.scenes.map(s => s.type).join(',') === 'decompose,decompose,merge,merge,reveal,hold' && colorOf(tlP2, 'a1')[0] === '#0c8599',
  tlP2.scenes.map(s => s.type).join(',') + ' ' + colorOf(tlP2, 'a1'));

// ============ 场景 R：手写拆法（拆字库没收录 / 拆得不对时自己写）============
console.log('— 场景 R：手写拆法 —');
check('R: parseParts 支持空格/顿号/连写', Studio.parseParts('木 口').join() === '木,口'
  && Studio.parseParts('木、口').join() === '木,口' && Studio.parseParts('木口').join() === '木,口');
check('R: 不去重（林 = 木+木 是两个部件实例）', Studio.parseParts('木木').join() === '木,木');
check('R: 超过 8 个部件按 8 个截断', Studio.parseParts('一二三四五六七八九十').length === Studio.MAX_PARTS);
check('R: 空白输入解析为空（调用方据此报错，不静默写空）', Studio.parseParts('   ').length === 0);

const stR = Studio.createState('龘');            // 拆字库未收录
check('R: 龘 确实不在拆字库里', !DECOMP_DATA['龘']);
for (const c of stR.chars) Studio.assignRole(stR, c.id, 'zi');
check('R: 未收录的字本来没有部件', stR.parts.length === 0);
Studio.setManualParts(stR, 'm0', '龙 龙 龙');
check('R: 手写拆法生成部件实例（重复部件各算一个）',
  stR.parts.map(p => p.id + ':' + p.glyph).join(',') === 'm0-p0:龙,m0-p1:龙,m0-p2:龙', JSON.stringify(stR.parts));
check('R: 手写拆法排在变体列表最前', Studio.variantsOf(stR, 'm0')[0].join('') === '龙龙龙');
check('R: 未收录的字靠手写拆法就能被选为输入', Studio.mergableItems(stR).some(x => x.id === 'm0-p1'), JSON.stringify(Studio.mergableItems(stR)));

const stR2 = Studio.createState('古');           // 拆字库有拆法（十+口）
for (const c of stR2.chars) Studio.assignRole(stR2, c.id, 'zi');
check('R: 拆字库原本的拆法在', stR2.parts.map(p => p.glyph).join('') === '十口');
Studio.setManualParts(stR2, 'm0', '木 口');
check('R: 手写部件排在前面、拆字库多出的部件一并摊出（不区分拆法，口 只留一块）',
  stR2.parts.map(p => p.glyph).join('') === '木口十', stR2.parts.map(p => p.glyph).join(''));
check('R: 手写部件能直接参与候选检索', Studio.findCandidates(['木', '口']).exact.includes('杏'), JSON.stringify(Studio.findCandidates(['木', '口'])));
check('R: 拆字库的拆法仍留在列表里（随时用回）',
  Studio.variantsOf(stR2, 'm0').length === 2 && Studio.variantsOf(stR2, 'm0')[1].join('') === '十口');

stR2.answer = '杏';
Studio.confirmMerge(stR2, ['m0-p0', 'm0-p1'], '杏');
const tlR = Studio.buildTimelineFromState(stR2, CFG);
const decR = tlR.scenes.find(s => s.type === 'decompose');
const midR = decR ? tlR.stateAt(decR.duration / 2).items.map(i => i.glyph) : [];
check('R: 拆解场景拆出的是手写部件（木/口）', midR.includes('木') && midR.includes('口'), midR.join(','));
check('R: 手写部件参与合并后末帧谜底 = 杏', endAnswerString(tlR) === '杏', endAnswerString(tlR));
const usedR = Studio.usedIdsOf(stR2);
check('R: 整字被用后手写部件一并锁定', usedR.has('m0') && usedR.has('m0-p0') && usedR.has('m0-p1'), [...usedR].join(','));
Studio.clearManualParts(stR2, 'm0');
check('R: 清掉手写拆法后回到拆字库（十+口）', stR2.parts.map(p => p.glyph).join('') === '十口' && !stR2.manual.m0);
check('R: 手写拆法为空数组等同清除', (() => {
  const st = Studio.createState('古');
  Studio.setManualParts(st, 'm0', '木 口');
  Studio.setManualParts(st, 'm0', []);
  return !st.manual.m0;
})());

// --- 级联删除清除被杀结果的配对，保留其他 ---
Studio.pairResult(stC, 'r0', 0);
Studio.pairResult(stC, 'r1', 1);
Studio.deleteMergeCascade(stC, 'r0');
check('C: 级联删除后 r0 配对清除、r1 保留', stC.pairs.r0 === undefined && stC.pairs.r1 === 1, JSON.stringify(stC.pairs));

// ============ 场景 双扣：一个谜底字位挂多个合成结果 ============
console.log('— 场景 双扣：一个字位多个来源 —');
// (a) 同字形双扣：一+大=天、二+人=天，谜底就一个「天」→ 两个结果都扣向槽0
const stDk = Studio.createState('一大二人');
for (const c of stDk.chars) Studio.assignRole(stDk, c.id, 'zi');
Studio.confirmMerge(stDk, ['m0', 'm1'], '天');   // r0
Studio.confirmMerge(stDk, ['m2', 'm3'], '天');   // r1
stDk.answer = '天';
Studio.pairResult(stDk, 'r0', 0);
Studio.pairResult(stDk, 'r1', 0);                // 不再是"先来的把后来的挤掉"
const effDk = Studio.effectivePairs(stDk);
check('双扣(a): 两个结果都配到同一个字位（pairs 同槽挂多个 id）', effDk.r0 === 0 && effDk.r1 === 0, JSON.stringify(effDk));
check('双扣(a): pairs 允许同一槽位出现两次', Object.values(stDk.pairs).filter(v => v === 0).length === 2, JSON.stringify(stDk.pairs));
const tlDk = Studio.buildTimelineFromState(stDk, CFG);
check('双扣(a): 序列 merge,merge,hold（两个都落位、无末尾 reveal）', tlDk.scenes.map(s => s.type).join(',') === 'merge,merge,hold', tlDk.scenes.map(s => s.type).join(','));
check('双扣(a): 两个 merge 场景都标记 landsOnAnswer（都不被挤去末尾弹出）', tlDk.scenes.filter(s => s.type === 'merge').length === 2 && tlDk.scenes.filter(s => s.type === 'merge').every(s => s.landsOnAnswer === true));
check('双扣(a): 没有被挤去末尾 reveal', !tlDk.scenes.some(s => s.type === 'reveal'));
check('双扣(a): 末帧谜底字就位', endAnswerString(tlDk) === '天', endAnswerString(tlDk));
const badDk = sampleOk(tlDk);
check('双扣(a): 300 点采样全部合法', !badDk, badDk || '');

// (b) 异字形双扣（部件共同组成谜底字）：舌、辛 共同组成「辞」
const stDk2 = Studio.createState('舌辛');
for (const c of stDk2.chars) Studio.assignRole(stDk2, c.id, 'zi');
Studio.confirmMerge(stDk2, ['m0'], '舌');         // r0（单选提取）
Studio.confirmMerge(stDk2, ['m1'], '辛');         // r1
stDk2.answer = '辞';
Studio.pairResult(stDk2, 'r0', 0);
Studio.pairResult(stDk2, 'r1', 0);
const effDk2 = Studio.effectivePairs(stDk2);
check('双扣(b): 两个结果都配到谜底「辞」的槽0', effDk2.r0 === 0 && effDk2.r1 === 0, JSON.stringify(effDk2));
const tlDk2 = Studio.buildTimelineFromState(stDk2, CFG);
check('双扣(b): 序列 merge,merge,hold（无 reveal）', tlDk2.scenes.map(s => s.type).join(',') === 'merge,merge,hold', tlDk2.scenes.map(s => s.type).join(','));
check('双扣(b): 两个 merge 都落位', tlDk2.scenes.filter(s => s.type === 'merge').every(s => s.landsOnAnswer === true));
const centerId = tlDk2.answerUnits[0];
const endDk2 = tlDk2.stateAt(tlDk2.duration);
const centerItem = endDk2.items.find(i => i.id === centerId);
check('双扣(b): 中心来源显示谜底字「辞」', centerItem && centerItem.glyph === '辞', centerItem && centerItem.glyph);
const otherId = centerId === 'r0' ? 'r1' : 'r0';
const otherMerge = stDk2.merges.find(x => x.id === otherId);
const otherItem = endDk2.items.find(i => i.id === otherId);
check('双扣(b): 另一来源显示自身字形（舌/辛），两条路径都看得见', otherItem && otherItem.glyph !== '辞' && otherItem.glyph === otherMerge.glyph, otherItem && otherItem.glyph);
const badDk2 = sampleOk(tlDk2);
check('双扣(b): 300 点采样全部合法', !badDk2, badDk2 || '');

// (c) 解除一个不影响另一个：双扣里 ✕ 只去掉被点的那个来源
Studio.unpairResult(stDk, 'r0');
const effDk3 = Studio.effectivePairs(stDk);
check('双扣(c): 解除其中一个不影响另一个', effDk3.r0 === undefined && effDk3.r1 === 0, JSON.stringify(effDk3));
const tlDk3 = Studio.buildTimelineFromState(stDk, CFG);
check('双扣(c): 解除后只剩 r1 落位、无多余的 reveal 段', tlDk3.answerUnits[0] === 'r1' && !tlDk3.scenes.some(s => s.type === 'reveal'), JSON.stringify(tlDk3.answerUnits));
check('双扣(c): 解除后仍无 NaN', !sampleOk(tlDk3), sampleOk(tlDk3) || '');

// (d) 自动配对：同字形可叠到同一槽；异字形绝不抢占已被别的字形占用的槽
const stDk4 = Studio.createState('一大二人');
for (const c of stDk4.chars) Studio.assignRole(stDk4, c.id, 'zi');
Studio.confirmMerge(stDk4, ['m0', 'm1'], '天');
Studio.confirmMerge(stDk4, ['m2', 'm3'], '天');
stDk4.answer = '天';
const autoDk = Studio.autoPair(stDk4);
check('双扣(自动): 两个相同字形结果都自动配到同一槽', autoDk.r0 === 0 && autoDk.r1 === 0, JSON.stringify(autoDk));
const stDk5 = Studio.createState('杏杏');
for (const c of stDk5.chars) Studio.assignRole(stDk5, c.id, 'zi');
Studio.confirmMerge(stDk5, ['m0'], '杏');
Studio.confirmMerge(stDk5, ['m1'], '杏');
stDk5.answer = '杏花';
const autoDk2 = Studio.autoPair(stDk5);
check('双扣(自动): 异字谜底下两个相同字形仍叠到同一槽、不误占花槽', autoDk2.r0 === 0 && autoDk2.r1 === 0, JSON.stringify(autoDk2));


// ============ 场景 D：多字提取合并 + 单次使用约束 ============
console.log('— 场景 D：多人成众 + 使用约束 —');
// 三人成众：三个整字一次合并（>2 项，从多个字提取）
const stD2 = Studio.createState('人人人');
for (const c of stD2.chars) Studio.assignRole(stD2, c.id, 'zi');
check('D: 三「人」整字均可选', ['m0', 'm1', 'm2'].every(id => Studio.mergableItems(stD2).some(x => x.id === id)));
const candZ = Studio.findCandidates(['人', '人', '人']);
check('D: 候选 exact 含 众', candZ.exact.includes('众'), JSON.stringify(candZ));
const resZ = Studio.confirmMerge(stD2, ['m0', 'm1', 'm2'], '众');
check('D: 三项合并成功', resZ.ok, JSON.stringify(resZ));
const availD = Studio.mergableItems(stD2);
check('D: 合并后三个人字素全部锁定', !availD.some(x => x.id === 'm0' || x.id === 'm1' || x.id === 'm2'));
const resDup = Studio.confirmMerge(stD2, ['m0', 'm1'], '从');
check('D: 重复使用被拒绝', resDup.ok === false && resDup.reason.includes('一次'), JSON.stringify(resDup));
stD2.answer = '众';
const tlD2 = Studio.buildTimelineFromState(stD2, CFG);
check('D: 整字合并无拆解场景，序列 merge,hold', tlD2.scenes.map(s => s.type).join(',') === 'merge,hold', tlD2.scenes.map(s => s.type).join(','));
const badD2 = sampleOk(tlD2);
check('D: 300 点采样全部合法', !badD2, badD2 || '');
const endD2 = tlD2.stateAt(tlD2.duration);
check('D: 谜底 众 落在谜底位', endD2.items.some(i => i.id === tlD2.answerUnits[0] && i.glyph === '众' && i.opacity === 1));
Studio.deleteMergeCascade(stD2, 'r0');
check('D: 删除合并后整字恢复可用', ['m0', 'm1', 'm2'].every(id => Studio.mergableItems(stD2).some(x => x.id === id)));

// 字素部分提取 → 软锁定：整字锁定，未用部件保留可用
const stE2 = Studio.createState('木口');
Studio.assignRole(stE2, 'm0', 'zi');
Studio.assignRole(stE2, 'm1', 'zi');
check('E: 木 的部件含 十,人（全部拆法摊平）',
  stE2.parts.filter(p => p.from === 'm0').map(p => p.glyph).join(',').includes('十,人'),
  stE2.parts.filter(p => p.from === 'm0').map(p => p.glyph).join(','));
Studio.confirmMerge(stE2, ['m0-p0', 'm1'], '古'); // 木的「十」+ 口 → 古
const itemsE = Studio.mergableItems(stE2);
check('E: 部分提取后 木 整字锁定', !itemsE.some(x => x.id === 'm0'));
check('E: 部分提取后 木 剩余部件(人)仍可用（软锁定）', itemsE.some(x => x.id === 'm0-p1'));
const resE2 = Studio.confirmMerge(stE2, ['m0-p1', 'm1'], '困');
check('E: 已消耗的 口 不可再用', resE2.ok === false && resE2.reason.includes('一次'), JSON.stringify(resE2));
// 只用木的一个部件时，时间轴只拆出被用的部件
stE2.answer = '古';
const tlE2 = Studio.buildTimelineFromState(stE2, CFG);
const decE = tlE2.scenes.find(s => s.type === 'decompose');
check('E: 拆解场景只包含被用部件(十)', decE && decE.ids.join(',') === 'm0,m0-p0', decE ? decE.ids.join(',') : '无拆解');
// 三木成森（三个整字候选）
const stF2 = Studio.createState('木木木');
for (const c of stF2.chars) Studio.assignRole(stF2, c.id, 'zi');
const candS = Studio.findCandidates(['木', '木', '木']);
check('F: 三木候选 exact 含 森', candS.exact.includes('森'), JSON.stringify(candS));

// ============ 场景 G：千古（跨字提取 + 软锁定闭环） ============
console.log('— 场景 G：千古 —');
const stG = Studio.createState('千古');
for (const c of stG.chars) Studio.assignRole(stG, c.id, 'zi');
check('G: 四个部件实例均可选', ['m0-p0', 'm0-p1', 'm1-p0', 'm1-p1'].every(id => Studio.mergableItems(stG).some(x => x.id === id)));
const rG1 = Studio.confirmMerge(stG, ['m0-p0', 'm1-p0'], '千'); // 丿(千) + 十(古)
check('G: 跨字提取 丿(千)+十(古)=千 成功', rG1.ok, JSON.stringify(rG1));
const usedG = Studio.usedIdsOf(stG);
check('G: 千/古 整字锁定，但 十(千)、口(古) 仍可用', usedG.has('m0') && usedG.has('m1') && !usedG.has('m0-p1') && !usedG.has('m1-p1'), [...usedG].join(','));
const rG2 = Studio.confirmMerge(stG, ['m0-p1', 'm1-p1'], '古'); // 十(千) + 口(古)
check('G: 十(千)+口(古)=古 成功（软锁定不阻塞闭环）', rG2.ok, JSON.stringify(rG2));
const usageG = {};
for (const m of stG.merges) for (const id of m.partIds) usageG[id] = (usageG[id] || 0) + 1;
check('G: 四个部件恰好各用一次', Object.keys(usageG).length === 4 && Object.values(usageG).every(n => n === 1), JSON.stringify(usageG));
stG.answer = '千古';
const tlG = Studio.buildTimelineFromState(stG, CFG);
check('G: 千古时间轴序列 拆,拆,合,合,定格', tlG.scenes.map(s => s.type).join(',') === 'decompose,decompose,merge,merge,hold', tlG.scenes.map(s => s.type).join(','));
const badG = sampleOk(tlG);
check('G: 300 点采样全部合法', !badG, badG || '');
const endG = endAnswerString(tlG);
check('G: 谜底 千古 就位', endG === '千古', endG);
// 千古的两条合并互相独立（都直接配对）：各自一次成形，可见期间 x 恒定
for (const id of ['r0', 'r1']) {
  const xs = [];
  for (let k = 0; k <= 60; k++) {
    const it = tlG.stateAt((tlG.duration * k) / 60).items.find(i => i.id === id);
    if (it && it.opacity > 0.05) xs.push(+it.x.toFixed(3));
  }
  check(`G: ${id} 可见期间 x 恒定（一次成形，不横移）`, xs.length >= 3 && new Set(xs).size === 1, [...new Set(xs)].join(','));
}

// ============ 场景 H：笔画层展开等价（亻+一=千）+ 单选直接提取 ============
console.log('— 场景 H：亻+一=千 与 单选提取 —');
const candH1 = Studio.findCandidates(['亻', '一']);
check('H: 亻+一 笔画展开 exact 含 千', candH1.exact.includes('千'), 'exact=' + candH1.exact.join(','));
const candH2 = Studio.findCandidates(['亻', '十']);
check('H: 亻+十 展开 exact 含 什', candH2.exact.includes('什'), 'exact=' + candH2.exact.join(','));

// 单选：从「估」直接提取 古（离合「估」去「人」得「古」）
const stH = Studio.createState('估');
Studio.assignRole(stH, 'm0', 'zi');
check('H: 估 拆出 人,古,亻（两种拆法摊平，古 只留一块）',
  stH.parts.map(p => p.glyph).join(',') === '人,古,亻', stH.parts.map(p => p.glyph).join(','));
const rH = Studio.confirmMerge(stH, ['m0-p1']); // 单选 古，无 glyph
check('H: 单选合并成功且默认结果=古', rH.ok && stH.merges[0].glyph === '古', JSON.stringify(rH));
check('H: 单选记录 partGlyphs 快照=古', stH.merges[0].partGlyphs.join(',') === '古');
const availH = Studio.mergableItems(stH);
check('H: 提取古后 「估」整字与 古 锁定、剩余 人 可选（软锁定）', !availH.some(x => x.id === 'm0') && !availH.some(x => x.id === 'm0-p1') && availH.some(x => x.id === 'm0-p0'), availH.map(x => x.id).join(','));
const rH2 = Studio.confirmMerge(stH, ['m0-p0', 'm0-p1'], '估');
check('H: 已用部件拒绝再次合并', rH2.ok === false && rH2.reason.includes('一次'), JSON.stringify(rH2));
stH.answer = '古';
const tlH = Studio.buildTimelineFromState(stH, CFG);
check('H: 单选提取时间轴 = decompose,merge,hold', tlH.scenes.map(s => s.type).join(',') === 'decompose,merge,hold', tlH.scenes.map(s => s.type).join(','));
const badH = sampleOk(tlH);
check('H: 300 点采样全部合法', !badH, badH || '');

// 单选 + 多字混合：从「估」提 古，剩余 人 再与「口」合并（手填结果字验证时间轴）
const stH2 = Studio.createState('估口');
for (const c of stH2.chars) Studio.assignRole(stH2, c.id, 'zi');
Studio.confirmMerge(stH2, ['m0-p1'], '古');          // 估→提 古（单选）
Studio.confirmMerge(stH2, ['m0-p0', 'm1'], '叹');    // 人+口 手填
stH2.answer = '古';
const tlH2 = Studio.buildTimelineFromState(stH2, CFG);
check('H: 多字混合（提古+人口合并）序列 = 拆,合,合,定格', tlH2.scenes.map(s => s.type).join(',') === 'decompose,merge,merge,hold', tlH2.scenes.map(s => s.type).join(','));
const badH2 = sampleOk(tlH2);
check('H: 多字混合时间轴合法', !badH2, badH2 || '');

// ============ 行标签不与内容重叠 ============
console.log('— 行标签间距 —');
function minItemLeft(tl) {
  let worst = Infinity;
  for (let i = 0; i <= 200; i++) {
    const fs = tl.stateAt((tl.duration * i) / 200);
    for (const it of fs.items) worst = Math.min(worst, it.x - it.fontSize * 0.5);
  }
  return worst;
}
const labelRight = CFG.labelX + CFG.labelFS; // 「谜面」/「谜底」均为 2 字，半宽 = labelFS
for (const [name, tl] of [['A(3字2合)', tlA], ['B(2字2合)', tlB], ['C(4字2合)', tlC], ['G(2字2合)', tlG]]) {
  const gap = minItemLeft(tl) - labelRight;
  check(`标签间距 ${name} ≥ 8px`, gap >= 8, `gap=${gap.toFixed(1)}`);
}
// 极端：6 字各一次单选提取合并（6 个合并结果横向铺开）
{
  const stX = Studio.createState('木口日月火山');
  for (const c of stX.chars) Studio.assignRole(stX, c.id, 'zi');
  '木口日月火山'.split('').forEach((g, i) => Studio.confirmMerge(stX, ['m' + i], g));
  stX.answer = '木口日月火山';
  const tlX = Studio.buildTimelineFromState(stX, CFG);
  const gapX = minItemLeft(tlX) - labelRight;
  check('标签间距 极端6字6合 ≥ 8px', gapX >= 8, `gap=${gapX.toFixed(1)}`);
}

// ============ 长谜面换行 ============
console.log('— 长谜面换行 —');
function longState(mian, answer, extract) {
  const st = Studio.createState(mian);
  for (const c of st.chars) Studio.assignRole(st, c.id, 'zi');
  (extract || []).forEach(([i, g]) => Studio.confirmMerge(st, ['m' + i], g));
  st.answer = answer;
  return st;
}
// 同一行内重叠对数（|Δy| 小于半行高视为同一行）
function overlapPairs(items, threshold = 0.92) {
  let bad = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (Math.abs(a.y - b.y) > 18) continue; // 不同行
      if (Math.abs(a.x - b.x) < ((a.fontSize + b.fontSize) / 2) * threshold) bad++;
    }
  }
  return bad;
}
// 谜面字初始布局（t=0）行内是否有重叠；动画中飞行穿过其他行属正常，不计
function mianOverlap(tl) {
  return overlapPairs(tl.stateAt(0).items.filter(i => /^m\d+$/.test(i.id)));
}
// 谜面各行的字数（按 y 分组）
function mianLineCounts(tl) {
  const byY = {};
  for (const it of tl.stateAt(0).items.filter(i => /^m\d+$/.test(i.id))) {
    const k = Math.round(it.y);
    byY[k] = (byY[k] || 0) + 1;
  }
  return Object.keys(byY).sort((a, b) => a - b).map(k => byY[k]);
}
// 末帧按槽位顺序取出"承担谜底各字"的单元（配对的合成结果，或 reveal 弹出的谜底字）
function endAnswerUnits(tl) {
  const end = tl.stateAt(tl.duration).items;
  return Object.keys(tl.answerUnits).map(Number).sort((a, b) => a - b)
    .map(slot => end.find(i => i.id === tl.answerUnits[slot]) || null);
}
function endAnswerString(tl) { return endAnswerUnits(tl).map(u => (u ? u.glyph : '·')).join(''); }
// 谜底单元在末帧槽位是否重叠
function answerOverlap(tl) {
  return overlapPairs(endAnswerUnits(tl).filter(Boolean));
}
// 画布内越界单元数
function outOfBoundsCount(tl, H, W = 640) {
  let bad = 0;
  for (let s = 0; s <= 60; s++) {
    const fs = tl.stateAt((tl.duration * s) / 60);
    for (const it of fs.items) {
      if (it.x - it.fontSize / 2 < 0 || it.x + it.fontSize / 2 > W) bad++;
    }
    for (const o of fs.overlays) {
      if (o.x - o.fontSize < 0 || o.x + o.fontSize > W || o.y < 0 || o.y > H) bad++;
    }
  }
  return bad;
}
{
  const m14 = '一口咬掉牛尾巴二人土上坐田土日月';           // 16 字
  const st14 = longState(m14, '告坐明', [[0, '一'], [1, '口']]);
  const tl14 = Studio.buildTimelineFromState(st14, CFG);
  check('长谜面 16 字 → 谜面 2 行', tl14.rows.mian === 2, JSON.stringify(tl14.rows));
  check('长谜面 16 字 → 画布加高（H > 210）', tl14.H > 210, 'H=' + tl14.H);
  check('长谜面 16 字 → 谜面行内无重叠', mianOverlap(tl14) === 0, 'overlap=' + mianOverlap(tl14));
  check('长谜面 16 字 → 不出画布', outOfBoundsCount(tl14, tl14.H) === 0, 'oob=' + outOfBoundsCount(tl14, tl14.H));
  check('长谜面 16 字 → 首行仍贴 y=70（谜面标签同位）', tl14.stateAt(0).overlays.some(o => o.text === '谜面' && o.y === 70));
  const fs14 = tl14.stateAt(0);
  const ySet = [...new Set(fs14.items.map(i => Math.round(i.y)))].sort((a, b) => a - b);
  check('长谜面 16 字 → 谜面分两行且行距足够', ySet.length === 2 && ySet[1] - ySet[0] >= CFG.charFS, ySet.join(','));
  check('长谜面 16 字 → 两行均衡 8+8', mianLineCounts(tl14).join(',') === '8,8', mianLineCounts(tl14).join(','));

  const st20 = longState('一口咬掉牛尾巴二人土上坐田土日月火山木口', '告坐明', []);
  const tl20 = Studio.buildTimelineFromState(st20, CFG);
  check('长谜面 20 字 → 谜面 3 行', tl20.rows.mian === 3, JSON.stringify(tl20.rows));
  check('长谜面 20 字 → 三行均衡 7+7+6', mianLineCounts(tl20).join(',') === '7,7,6', mianLineCounts(tl20).join(','));
  check('长谜面 20 字 → 谜面行内无重叠', mianOverlap(tl20) === 0, 'overlap=' + mianOverlap(tl20));
  check('长谜面 20 字 → 不出画布', outOfBoundsCount(tl20, tl20.H) === 0, 'oob=' + outOfBoundsCount(tl20, tl20.H));

  // 短谜面必须与旧布局/旧画布完全一致（不因换行逻辑改动而变高）
  check('短谜面画布仍为 210', tlA.H === 210 && tlG.H === 210, `${tlA.H}/${tlG.H}`);
  check('短谜面行数 = 1 行', tlA.rows.mian === 1 && tlA.rows.second === 1);

  // 行2 换行：8 个合成结果 / 8 字谜底 → 网格模式 2 行
  const stG8 = longState('木口日月火山田土', '木口日月火山田土', '木口日月火山田土'.split('').map((g, i) => [i, g]));
  const tlG8 = Studio.buildTimelineFromState(stG8, CFG);
  check('行2 超容量 → 换行网格模式', tlG8.rows.gridMode === true && tlG8.rows.second === 2, JSON.stringify(tlG8.rows));
  check('行2 换行后谜底槽位无重叠', answerOverlap(tlG8) === 0, 'overlap=' + answerOverlap(tlG8));
  check('行2 换行后不出画布', outOfBoundsCount(tlG8, tlG8.H) === 0, 'oob=' + outOfBoundsCount(tlG8, tlG8.H));
  const endG8 = endAnswerUnits(tlG8);
  check('行2 换行后谜底 8 字全部就位', endG8.length === 8 && endG8.every(i => i && i.opacity > 0.9), 'n=' + endG8.filter(Boolean).length);
  check('行2 换行后谜底顺序正确', endG8.map(i => (i ? i.glyph : '·')).join('') === '木口日月火山田土', endG8.map(i => (i ? i.glyph : '·')).join(''));
}

// ============ 按行数自动降字号 ============
console.log('— 自动降字号 —');
const POOL = '一口咬掉牛尾巴二人土上坐田土日月火山木口金水火土大人天地上下左右中';
const mkMian = n => { let s = ''; while (s.length < n) s += POOL; return s.slice(0, n); };
function fitProbe(n, answerLen = 1) {
  const mian = mkMian(n);
  const st = Studio.createState(mian);
  for (const c of st.chars) Studio.assignRole(st, c.id, 'zi');
  st.answer = mkMian(answerLen);
  const tl = Studio.buildTimelineFromState(st, CFG);
  const items = tl.stateAt(0).items;
  const lines = {};
  for (const it of items) { const k = Math.round(it.y); lines[k] = (lines[k] || 0) + 1; }
  return { tl, items, lineCounts: Object.keys(lines).sort((a, b) => a - b).map(k => lines[k]) };
}
{
  const r8 = fitProbe(8);
  check('8 字不降字号（56）', r8.tl.rows.charFS === 56 && r8.tl.rows.shrunk === false, 'fs=' + r8.tl.rows.charFS);
  const r24 = fitProbe(24);
  check('24 字仍在 3 行内 → 不降字号', r24.tl.rows.charFS === 56 && r24.tl.rows.mian === 3, `fs=${r24.tl.rows.charFS} lines=${r24.tl.rows.mian}`);
  const r25 = fitProbe(25);
  check('25 字超 3 行 → 自动降字号', r25.tl.rows.charFS < 56 && r25.tl.rows.shrunk === true, 'fs=' + r25.tl.rows.charFS);
  check('25 字降字号后回到 3 行', r25.tl.rows.mian === 3, 'lines=' + r25.tl.rows.mian);
  const r40 = fitProbe(40);
  check('40 字降到下限 34 且不低于下限', r40.tl.rows.charFS === 34, 'fs=' + r40.tl.rows.charFS);
  check('40+ 字仍不丢字（逐字落位）', r40.items.length === 40, 'items=' + r40.items.length);
  // 降字号应让画布更矮（同样 3 行，25 字比不降字号时更紧凑）
  check('降字号后画布更紧凑（25 字 H < 24 字 H）', r25.tl.H < r24.tl.H, `${r25.tl.H} vs ${r24.tl.H}`);
  // 行 2 谜底过长同样降字号
  const a8 = fitProbe(4, 8);
  const a15 = fitProbe(4, 15);
  check('谜底 8 字不降字号（62）', a8.tl.rows.answerFS === 62, 'fs=' + a8.tl.rows.answerFS);
  check('谜底 15 字 → 自动降字号且 ≤2 行', a15.tl.rows.answerFS < 62 && a15.tl.rows.second <= 2, `fs=${a15.tl.rows.answerFS} lines=${a15.tl.rows.second}`);
  const a30 = fitProbe(4, 30);
  check('谜底 30 字降到下限 40', a30.tl.rows.answerFS === 40, 'fs=' + a30.tl.rows.answerFS);
  // 缩放字号不越界：所有单元与标签都在画布内
  for (const [label, r] of [['25字', r25], ['40字', r40], ['谜底15字', a15]]) {
    check(`降字号后 ${label} 不出画布`, outOfBoundsCount(r.tl, r.tl.H) === 0, 'oob=' + outOfBoundsCount(r.tl, r.tl.H));
  }
}

// ============ 动画定格帧不重叠 ============
console.log('— 动画定格帧不重叠 —');
// 只算"看得见"的单元（opacity > 0.15）。两处刻意的不重叠例外不计入：
//   1) 合并瞬间输入字与结果字的交叉淡入淡出 —— 那是"收敛"本身；
//   2) 飞行途中穿过别的字 —— 它在动。
// 这里要拦住的是"停在画面上的两个字叠在一起"：部件糊成一团、双扣两个字重叠、
// 未配对的结果压在谜底槽位上、等待中的部件被已落位的结果压住。
function animState(mian, answer, merges, pairs) {
  const st = Studio.createState(mian);
  for (const c of st.chars) Studio.assignRole(st, c.id, 'zi');
  for (const [ids, g] of merges) Studio.confirmMerge(st, ids, g);
  st.answer = answer;
  for (const [id, slot] of pairs || []) Studio.pairResult(st, id, slot);
  return st;
}
function visibleOverlap(tl) {
  const ats = [0];
  let acc = 0;
  for (const sc of tl.scenes) { acc += sc.duration; ats.push(acc); }
  let bad = 0;
  for (const at of ats) {
    const v = tl.stateAt(Math.min(at, tl.duration)).items.filter(i => i.opacity > 0.15);
    for (let i = 0; i < v.length; i++) {
      for (let j = i + 1; j < v.length; j++) {
        const a = v[i], b = v[j];
        const half = (a.fontSize + b.fontSize) / 2;
        if (Math.abs(a.x - b.x) < half - 1 && Math.abs(a.y - b.y) < half - 1) bad++;
      }
    }
  }
  return bad;
}
const animCases = [
  ['十八口→杏', animState('十八口', '杏', [[['m0', 'm1'], '木'], [['r0', 'm2'], '杏']])],
  ['多段 木口艹化→杏花', animState('木口艹化', '杏花', [[['m0', 'm1'], '杏'], [['m2', 'm3'], '花']])],
  ['千古（跨字提取，部件分属两次合并）', animState('千古', '千古',
    [[['m0-p0', 'm1-p0'], '千'], [['m0-p1', 'm1-p1'], '古']])],
  ['双扣 同字形', animState('一大二人', '天', [[['m0', 'm1'], '天'], [['m2', 'm3'], '天']], [['r0', 0], ['r1', 0]])],
  ['双扣 异字形（舌+辛→辞）', animState('舌辛', '辞', [[['m0'], '舌'], [['m1'], '辛']], [['r0', 0], ['r1', 0]])],
  ['双扣 + 多槽', animState('一大二人三天五日', '天三五日月',
    [[['m0', 'm1'], '天'], [['m2', 'm3'], '天'], [['m4'], '三'], [['m5'], '五'], [['m6'], '日'], [['m7'], '月']],
    [['r0', 0], ['r1', 0], ['r2', 1], ['r3', 2], ['r4', 3], ['r5', 4]])],
  // 合并次数多于谜底字数 -> 多出来的结果配不上槽位，只能排到谜底行下方
  ['未配对结果（合并 3 次 / 谜底 2 字）', animState('木口日月', '杏日',
    [[['m0', 'm1'], '杏'], [['m2'], '日'], [['m3'], '月']])],
];
for (const [name, st] of animCases) {
  const tl = Studio.buildTimelineFromState(st, CFG);
  check(`定格帧无重叠：${name}`, visibleOverlap(tl) === 0, 'overlap=' + visibleOverlap(tl));
  check(`不出画布：${name}`, outOfBoundsCount(tl, tl.H) === 0, 'oob=' + outOfBoundsCount(tl, tl.H));
  check(`标签间距 ≥ 8px：${name}`, minItemLeft(tl) - labelRight >= 8, 'gap=' + (minItemLeft(tl) - labelRight).toFixed(1));
}
// 手写 8 部件：拆解后横排，间距不得小于字号（旧公式只剩 28px 配 44px，糊成一团叠了 9 秒）
{
  const st = Studio.createState('木');
  Studio.assignRole(st, 'm0', 'zi');
  Studio.setManualParts(st, 'm0', '一 丨 丿 丶 乀 ㇏ 一 丨');
  Studio.confirmMerge(st, ['m0-p0', 'm0-p1', 'm0-p2', 'm0-p3', 'm0-p4', 'm0-p5', 'm0-p6', 'm0-p7'], '某');
  st.answer = '某';
  const tl = Studio.buildTimelineFromState(st, CFG);
  const ps = tl.stateAt(tl.scenes[0].duration).items.filter(i => /-p\d+$/.test(i.id));
  const xs = ps.map(i => i.x).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
  check('8 部件拆解后全部落在同一排', ps.length === 8 && ps.every(i => Math.abs(i.y - ps[0].y) < 1), 'n=' + ps.length);
  check('8 部件：横排间距 ≥ 字号（不再糊成一团）', minGap >= ps[0].fontSize - 1,
    `gap=${minGap.toFixed(1)} fs=${ps[0].fontSize}`);
  check('8 部件：定格帧无重叠', visibleOverlap(tl) === 0, 'overlap=' + visibleOverlap(tl));
  check('8 部件：画布未被加高', tl.H === 210, 'H=' + tl.H);
}
// 8 部件分 4 次合并：等待中的部件不得与先落位的结果撞在一起
{
  const st = Studio.createState('木口');
  for (const c of st.chars) Studio.assignRole(st, c.id, 'zi');
  Studio.setManualParts(st, 'm0', '一 丨 丿 丶 乀 ㇏ 一 丨');
  Studio.confirmMerge(st, ['m0-p0', 'm0-p1'], '仌');
  Studio.confirmMerge(st, ['m0-p2', 'm0-p3'], '从');
  Studio.confirmMerge(st, ['m0-p4', 'm0-p5'], '众');
  Studio.confirmMerge(st, ['m0-p6', 'm0-p7'], '品');
  st.answer = '仌从众品';
  const tl = Studio.buildTimelineFromState(st, CFG);
  check('8 部件分 4 次合并：定格帧无重叠', visibleOverlap(tl) === 0, 'overlap=' + visibleOverlap(tl));
  check('8 部件分 4 次合并：画布未被加高', tl.H === 210, 'H=' + tl.H);
}
// 双扣：同槽两个结果的间距必须容得下字号（旧值 44px 配 54px 字号 = 叠着）
{
  const st = animState('一大二人', '天', [[['m0', 'm1'], '天'], [['m2', 'm3'], '天']], [['r0', 0], ['r1', 0]]);
  const tl = Studio.buildTimelineFromState(st, CFG);
  const end = tl.stateAt(tl.duration).items;
  const a = end.find(i => i.id === 'r0'), b = end.find(i => i.id === 'r1');
  check('双扣：同槽两个字位单元间距 ≥ 字号', !!a && !!b && Math.abs(a.x - b.x) >= (a.fontSize + b.fontSize) / 2 - 1,
    a && b ? `dx=${Math.abs(a.x - b.x).toFixed(1)} fs=${a.fontSize}` : '缺单元');
  check('双扣：两个字位单元都在槽位附近、都在画面里',
    !!a && !!b && [a, b].every(i => i.x > 0 && i.x < 640), a && b ? `${a.x.toFixed(0)},${b.x.toFixed(0)}` : '');
}
// 未配对结果：排到谜底行下方，不与谜底槽位同位（否则会正好压住谜底字）
{
  const st = animState('木口日月', '杏日', [[['m0', 'm1'], '杏'], [['m2'], '日'], [['m3'], '月']]);
  const tl = Studio.buildTimelineFromState(st, CFG);
  const end = tl.stateAt(tl.duration).items;
  const stray = end.find(i => i.id === 'r2');
  const ans0 = end.find(i => i.id === 'r0');   // 落在谜底槽 0 上的结果
  check('未配对结果排在谜底行下方（不与谜底同位）',
    !!stray && !!ans0 && stray.y - ans0.y >= 30, stray && ans0 ? `stray.y=${stray.y} ans.y=${ans0.y}` : '缺单元');
  check('未配对结果仍留在画面里（不凭空消失）', !!stray && stray.opacity > 0.15, stray ? 'op=' + stray.opacity : '缺单元');
}

// ============ 防御性 ============
console.log('— 防御性 —');
const dels = Studio.deleteMergeCascade(stA, 'r0');
check('级联删除 (r0 被 r1 依赖)', dels.length === 2 && stA.merges.length === 0, JSON.stringify(dels));

const candE = Studio.findCandidates(['ⓧ不存在', '木']);
check('未收录部件返回空候选', candE.exact.length === 0 && candE.superset.length === 0);

const stD = Studio.createState('二人土');
Studio.assignRole(stD, 'm1', 'zi');
const tlD = Studio.buildTimelineFromState(stD, CFG);
check('无谜底时不生成 reveal', !tlD.scenes.some(s => s.type === 'reveal'));

const compIdx = Studio.componentIndex();
check('倒排索引含 木（十 在索引中）', compIdx.has('十') && compIdx.get('十').has('木'));

// 点选面板用的常用部件（字根）：按"多少字用到它"降序，高频的排在前面
const commons = Studio.commonParts(72);
check('常用部件取满 72 个且都是单字', commons.length === 72 && commons.every(g => [...g].length === 1));
check('常用部件按使用频次降序（口 比 一 之后的冷僻部件靠前）',
  commons.indexOf('口') >= 0 && commons.indexOf('口') < commons.length / 2, commons.slice(0, 8).join(''));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\nstudio 流程测试全部通过 ✔');