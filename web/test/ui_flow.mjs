// ui_flow.mjs — 用 jsdom 真实点击驱动 app.js，端到端验证 UI 交互。
// 用法: node test/ui_flow.mjs
//
// 覆盖三条线：
//   1) 引导层：步骤轨 / 门控 / 引导条 / 画布空态 / 使用说明
//   2) 谜面工作台：点字展开 → 改身份 → 挑部件 → 跨字累积 → 合并
//   3) 动画与导出：场景序列（合成结果直接落位）、配对、尺寸、长谜面换行
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(__dirname, '..');
const dom = new JSDOM(readFileSync(path.join(web, 'index.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/',
});
const { window } = dom;
const doc = window.document;
window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);

const errs = [];
window.addEventListener('error', e => errs.push('window error: ' + e.message));

for (const f of ['data/decomp.js', 'engine.js', 'studio.js', 'svg.js', 'apng.js', 'gif.js', 'app.js']) {
  window.eval(readFileSync(path.join(web, f), 'utf8'));
}
// app.js 的 init 绑在 DOMContentLoaded 上，文档已解析完，手动派发
doc.dispatchEvent(new window.Event('DOMContentLoaded'));

// ---------------------------------------------------------------- 测试小工具
const $ = id => doc.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const dump = (label, fn) => { try { console.log(label, fn()); } catch (e) { console.log(label, 'THROW:', e.message); } };
const assert = (cond, msg) => console.log((cond ? '  ✓ ' : '  ✗ ') + msg);

const railStates = () => [...doc.querySelectorAll('#rail .rail-step')].map(b => b.dataset.state).join(',');
const stepStates = () => [...doc.querySelectorAll('.step[data-step]')].map(s => s.dataset.state).join(',');
const chipOf = glyph => [...doc.querySelectorAll('#chipsWrap .chip')]
  .find(c => c.querySelector('.chip-glyph').textContent === glyph);
// 身份笔：先选一支笔，再点字 —— 点一下就定，不再有字卡
const rolePen = k => doc.querySelector(`#roleBtns .role-btn[data-role="${k}"]`);
const takePen = k => click(rolePen(k));                               // 拿起某支笔（再点一次 = 放下）
const ensurePen = k => { if (rolePen(k).getAttribute('aria-pressed') !== 'true') takePen(k); }; // 幂等：确保手里是这支
const tagChar = glyph => click(chipOf(glyph));                        // 用当前这支笔点一个谜面字
// 字素池：一行一个来源字，行内是「整字 + 各部件」。同名部件按来源字区分，互不干扰。
const poolBlocks = () => [...$('partsWrap').querySelectorAll('.part-block')].filter(b => b.querySelector('.pb-glyph'));
const blockOf = glyph => poolBlocks().find(b => b.querySelector('.pb-glyph').textContent === glyph);
const poolChars = () => poolBlocks().map(b => b.querySelector('.pb-glyph').textContent).join(',');
const pairRows = () => [...doc.querySelectorAll('#pairBoard .pair-row')];
const srcId = i => rowSrc(i).dataset.mergeId;
const rowSrc = i => pairRows()[i].querySelector('.pair-src');
const rowSlot = i => pairRows()[i].querySelector('.pair-slot');
const rowX = i => pairRows()[i].querySelector('.pair-x');
const freeChips = () => [...doc.querySelectorAll('#pairResults .pair-chip')];
const mergeChips = () => {
  const row = $('partsWrap').querySelector('.part-block.merges-block');
  return row ? [...row.querySelectorAll('.sel-chip')] : [];
};
const pickMerge = id => {
  const c = mergeChips().find(x => x.dataset.chipId === id);
  if (!c) throw new Error('池子里找不到合成结果 ' + id);
  click(c);
};
const rowChips = glyph => [...blockOf(glyph).querySelectorAll('.sel-chip')]
  .map(c => c.querySelector('.chip-glyph').textContent).join(',');
const partChip = (fromGlyph, glyph) => [...blockOf(fromGlyph).querySelectorAll('.sel-chip')]
  .find(c => c.querySelector('.chip-glyph').textContent === glyph);
const pickPart = (fromGlyph, glyph) => {
  const c = partChip(fromGlyph, glyph);
  if (!c) throw new Error(`字素池里找不到「${fromGlyph}」的零件 ${glyph}`);
  click(c);
};
const chipBadge = glyph => { const b = chipOf(glyph).querySelector('.chip-role'); return b ? b.textContent : null; };
const mergeAs = glyph => { $('resultInput').value = glyph; click($('confirmMergeBtn')); };
const sceneTypes = () => (window.__tlScenes || []);
// 把最近一次生成的时间轴抓出来（app.js 不会外露，借 studio 再算一遍同构结果不现实，
// 所以这里直接从舞台 SVG 与状态推断，场景序列由 test_studio 负责覆盖）

// ---------- 引导层：首屏（未载入任何谜面）----------
assert(doc.querySelectorAll('#rail .rail-step').length === 3, '步骤轨有 3 步（谜面/拆合/动画）');
assert(railStates() === 'active,locked,locked', '首屏步骤轨状态 = ①进行中 ②③待解锁（实际 ' + railStates() + '）');
assert(stepStates() === 'active,locked,locked', '首屏步骤卡片状态与步骤轨一致（实际 ' + stepStates() + '）');
assert($('status').getAttribute('aria-live') === 'polite', '引导条是 aria-live 实时区域（无障碍）');
assert(!$('stageEmpty').hidden, '画布空态首屏可见');
assert(!!$('stageEmpty').querySelector('button'), '画布空态带一个可点的下一步');
assert(doc.querySelectorAll('#step1 .examples').length === 0 && doc.querySelectorAll('.ex-chip').length === 0,
  '第 ① 步不再内置示例 chip（示例入口只留页头 / 画布空态 / 使用说明）');
assert(!!$('btnDemo') && !$('btnDemo2'), '页头只保留一个示例按钮');
assert($('step2').querySelector('.step-lock').textContent.includes('载入'), '待解锁的步骤写明解锁条件');
assert(!$('btnAllZi').disabled === false, '未载入时「全部设为字素」不可用');

// 使用说明面板：可打开、可 Esc 关闭（非阻塞式引导）
click($('btnHelp'));
assert(!$('helpOverlay').hidden, '「使用说明」打开面板');
assert($('helpOverlay').querySelector('.help-panel').getAttribute('role') === 'dialog', '使用说明是可关闭的 dialog');
assert($('helpOverlay').querySelectorAll('.help-steps li').length === 3, '使用说明讲三步（不再是四步）');
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
assert($('helpOverlay').hidden, 'Esc 关闭使用说明');

// ---------- ① 载入谜面 千古 ----------
$('inputMian').value = '千古';
click($('btnMian'));
dump('chips:', () => [...doc.querySelectorAll('#chipsWrap .chip')].map(c => c.textContent.trim()).join('|'));
assert(stepStates() === 'done,active,active', '载入谜面后 ①完成 ②进行中 ③可进入（实际 ' + stepStates() + '）');
assert($('step2Meta').textContent.trim() === '0 个可拆字', '载入后不预设任何字的身份（实际 ' + $('step2Meta').textContent.trim() + '）');
assert(doc.querySelectorAll('#chipsWrap .chip.tagged').length === 0, '载入后每个字都是未标注（虚线待标）');
assert(doc.querySelectorAll('#partsWrap .part-block').length === 0, '还没标字素时字素池是空的');

// ---------- 身份笔：先选一支笔，再点字 ----------
assert(!!doc.querySelector('#roleBar #roleBtns'), '身份笔常驻在字块上方（不必先展开字卡）');
assert(doc.querySelectorAll('#roleBtns .role-btn[data-role]').length === 2, '身份只分两类（字素 / 衬字）');
assert(rolePen('zi').getAttribute('aria-pressed') === 'true', '默认已拿着「字素」笔');
assert(rolePen('zi').querySelector('.role-desc').textContent.length >= 5, '身份按钮内联释义（不必读整段说明）');
tagChar('千'); tagChar('古');
assert(chipBadge('千') === '字素' && chipBadge('古') === '字素', '点一下就定：点过的字立刻挂上身份徽标');
assert($('step2Meta').textContent.trim() === '2 个可拆字', '② 副标题显示可拆字数（实际 ' + $('step2Meta').textContent.trim() + '）');
assert(poolChars() === '千,古', '字素池一次列出所有字素的零件行（不必逐个点开字卡，实际 ' + poolChars() + '）');
// 再点已标注的字 = 取消；放下笔之后点字不改任何东西
tagChar('千');
assert(chipBadge('千') === null, '再点已标注的字 → 取消身份（回到未标注）');
tagChar('千');
assert(chipBadge('千') === '字素', '取消之后能再点回来');
takePen('zi');                                   // 手里正是「字素」笔 → 再点一次 = 放下
assert(rolePen('zi').getAttribute('aria-pressed') === 'false', '再点一次笔 = 放下笔（不会误改字）');
tagChar('古');
assert(chipBadge('古') === '字素', '没拿笔时点字不改任何东西（实际 ' + chipBadge('古') + '）');
assert($('status').textContent.includes('先'), '没拿笔就点字时给出提示（实际 ' + $('status').textContent + '）');
ensurePen('zi');
assert(rowChips('千') === '千,丿,十', '「千」那一行 = 整字 + 部件（实际 ' + rowChips('千') + '）');
assert(rowChips('古') === '古,十,口', '「古」那一行 = 整字 + 部件（实际 ' + rowChips('古') + '）');
assert(partChip('千', '十') !== partChip('古', '十'), '不同来源字拆出的同名部件是两枚独立零件');
assert(partChip('千', '十').dataset.chipId === 'm0-p1' && partChip('古', '十').dataset.chipId === 'm1-p0',
  '零件按「来源字-部件号」寻址（千的十=m0-p1，古的十=m1-p0）');
assert(!$('pendingWrap').classList.contains('show'), '没有挑选时待合并托盘不占位');

// ---------- 拖框划选：一次拖过几个零件就全选（不用逐个点） ----------
// jsdom 没有布局（getBoundingClientRect 一律返回 0），先给零件发一套假矩形才能测命中
const layoutChips = () => {
  [...$('partsWrap').querySelectorAll('.sel-chip')].forEach((chip, i) => {
    const x = i * 70;
    chip.getBoundingClientRect = () => ({ left: x, top: 0, right: x + 60, bottom: 40, width: 60, height: 40 });
  });
};
const ptr = (type, x, y, target, opts) => {
  const e = new window.MouseEvent(type,
    Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }, opts || {}));
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });   // jsdom 没有 PointerEvent
  (target || window).dispatchEvent(e);
};
const selCount = () => doc.querySelectorAll('#partsWrap .sel-chip.sel').length;

layoutChips();
const chips0 = [...$('partsWrap').querySelectorAll('.sel-chip')];
ptr('pointerdown', 5, 20, chips0[0]);
ptr('pointermove', 105, 20);
assert(selCount() === 2, '从第一个零件拖到第二个 → 两个一起选中（实际 ' + selCount() + '）');
assert(!!doc.querySelector('.marquee'), '拖动时显示橡皮筋选框');
ptr('pointerup', 105, 20);
assert(!doc.querySelector('.marquee'), '松手后选框移除');
dump('框选后:', () => $('selStatus').textContent);
assert($('selStatus').textContent.includes('丿(来自千)'), '框选结果直接进托盘（实际 ' + $('selStatus').textContent + '）');
// 浏览器在 pointerup 之后还会补一个 click —— 必须吞掉，否则框选白做
click(chips0[0]);
assert(selCount() === 2, '拖动后补发的 click 被吞掉，框选结果不被改（实际 ' + selCount() + '）');
// 只是点一下（没拖动）仍然是原来的单击切换
click(chips0[0]);
assert(selCount() === 1, '没拖动时单击照旧切换选中（实际 ' + selCount() + '）');
// Shift + 拖 = 追加，不覆盖已选
layoutChips();
const chips1 = [...$('partsWrap').querySelectorAll('.sel-chip')];
ptr('pointerdown', 215, 20, chips1[3], { shiftKey: true });
ptr('pointermove', 245, 20);
assert(selCount() === 2, 'Shift 拖动是追加（原 1 个 + 框到 1 个，实际 ' + selCount() + '）');
ptr('pointerup', 245, 20);
click($('cancelMergeBtn'));
assert(selCount() === 0 && !$('pendingWrap').classList.contains('show'),
  '「清空」收掉这次框选，后面的流程从干净状态开始（实际剩 ' + selCount() + '）');

// 跨字挑选：丿(千) + 十(古) —— 全程不打开任何字卡，全在同一个池子里完成
pickPart('千', '丿');
assert($('pendingWrap').classList.contains('show'), '选第一个零件后待合并托盘出现');
// 点选只同步 class、不重建 DOM：节点身份保持（键盘焦点不丢），长谜面时也不必整池重排
const chipNode = partChip('千', '丿');
click(chipNode);
assert(partChip('千', '丿') === chipNode, '取消选中不重建零件节点（仍是同一个 DOM 节点）');
assert(chipNode.getAttribute('aria-pressed') === 'false' && !$('pendingWrap').classList.contains('show'), '再点一下即取消选中，托盘收起');
click(chipNode);
assert(chipNode.getAttribute('aria-pressed') === 'true' && $('pendingWrap').classList.contains('show'), '重新选中仍是同一节点，托盘回来');
pickPart('古', '十');
dump('托盘:', () => $('selStatus').textContent);
assert($('selStatus').textContent.includes('丿(来自千) + 十(来自古)'), '跨字挑选在同一个字素池里直接累积');
assert($('mergeExpr').textContent.includes('丿(来自千) + 十(来自古) = ?'), '托盘表达式完整（实际 ' + $('mergeExpr').textContent + '）');
dump('候选:', () => [...doc.querySelectorAll('#candidateWrap .cand-chip')].map(c => c.textContent.trim()).join(','));
mergeAs('千');
dump('merges:', () => [...doc.querySelectorAll('#mergesWrap .merge-item')].map(m => m.textContent.trim().replace('删除', '')).join(' | '));
assert([...doc.querySelectorAll('#mergesWrap .merge-item')][0].textContent.includes('丿 + 十 → 千'), '合并记录显示完整部件名');
assert(!$('pendingWrap').classList.contains('show'), '合并后托盘收起');
assert($('step2Meta').textContent.trim() === '1 次合并', '② 副标题显示合并次数（实际 ' + $('step2Meta').textContent.trim() + '）');

// 软锁定：整字被锁，未用部件仍可继续点
assert(partChip('千', '千').disabled, '千 整字锁定（部件被用）');
assert(!partChip('千', '十').disabled, '软锁定：千 未用的 十 仍可点选');
assert(partChip('古', '古').disabled, '古 整字锁定（十被跨字提取）');
assert(!partChip('古', '口').disabled, '软锁定：古 未用的 口 仍可点选');
pickPart('千', '十');
pickPart('古', '口');
dump('托盘(续):', () => $('selStatus').textContent);
assert($('selStatus').textContent.includes('十(来自千) + 口(来自古)'), '剩余部件可继续合并（千古闭环不中断）');
mergeAs('古');
assert([...doc.querySelectorAll('#mergesWrap .merge-item')][1].textContent.includes('十 + 口 → 古'), '第二条合并记录名称正确');
assert($('step2').dataset.state === 'done', '合并后 ② 标记为已完成');
assert(railStates() === 'done,done,active', '合并后步骤轨推进到 ③（实际 ' + railStates() + '）');

// ---------- 改身份：会清掉用到这个字的合并 ----------
takePen('ci');
assert(rolePen('ci').getAttribute('aria-pressed') === 'true' && rolePen('zi').getAttribute('aria-pressed') === 'false',
  '一次只有一支笔在手（换笔后旧笔自动放下）');
tagChar('千');
dump('改身份后 status:', () => $('status').textContent);
assert(chipBadge('千') === '衬字', '换笔后点字 → 身份立刻改掉（点一下就定）');
assert(doc.querySelectorAll('#mergesWrap .merge-item').length === 0, '改身份清掉了用到该字的合并（避免部件凭空出现）');
assert($('status').textContent.includes('清掉'), '引导条说明刚刚连锁删除的后果');
assert(chipOf('千').style.borderColor === 'rgb(232, 89, 12)', '谜面字块按身份着色（衬字=橙）');
assert(poolChars() === '古', '改成衬字的字把零件从字素池里撤走（实际 ' + poolChars() + '）');

// 身份徽标：两类都要挂，不能只有衬字有标记
assert(chipBadge('千') === '衬字', '衬字字块挂身份徽标');
assert(chipBadge('古') === '字素', '字素字块同样挂身份徽标（不再只有衬字有标记）');
assert(chipOf('古').style.borderColor === 'rgb(47, 158, 68)', '字素字块按身份着色（字素=绿）');

// 「全部设为字素」一键复原
click($('btnAllZi'));
assert(doc.querySelectorAll('#chipsWrap .chip.tagged').length === 2, '「全部设为字素」后每个字都挂上徽标');
assert(rolePen('ci').getAttribute('aria-pressed') === 'true', '一键复原只改字、不动手里这支笔');
assert(poolChars() === '千,古', '复原后零件全部回到字素池');
assert($('status').textContent.includes('全部设为「字素」'), '引导条确认复原动作');

// 重新合并（千古）：全程在池子里挑，不需要先打开某个字的卡片
pickPart('千', '丿');
pickPart('古', '十');
mergeAs('千');
pickPart('千', '十');
pickPart('古', '口');
mergeAs('古');
assert(doc.querySelectorAll('#mergesWrap .merge-item').length === 2, '重新合并两条记录');

// ---------- ③ 谜底 + 动画 ----------
$('answerInput').value = '千古';
$('answerInput').dispatchEvent(new window.Event('input', { bubbles: true }));
dump('pairPanel:', () => $('pairPanel').className);
dump('配对看板:', () => pairRows().map(r => (r.classList.contains('matched') ? '实线 ' : '虚线 ') + r.textContent.replace(/\s+/g, '')).join(' | '));
assert(pairRows().length === 2, '配对看板一行一个谜底位（共 2 行）');
assert(pairRows().every(r => r.querySelector('.pair-src') && r.querySelector('.pair-link') && r.querySelector('.pair-slot')),
  '每行都是「拼出来的字 →连接线→ 谜底位」的结构（对应关系由位置表达）');
assert(pairRows()[0].classList.contains('matched') && pairRows()[1].classList.contains('matched'),
  '自动配对的两行都是实线（左右对齐、一眼看出谁落到谁）');
assert(pairRows()[0].querySelector('.pair-slot .idx').textContent.includes('第 1 字'), '谜底位标出顺序（第 1 字 / 第 2 字）');
assert($('pairRest').hidden, '全部连上时不再显示"还没连上"的列表');
// 互换：拿着 A 点 B 那一行 → 两个位置互换（不必先解除再一个个连）
const idA = srcId(0), idB = srcId(1);
click(rowSrc(0));
click(rowSrc(1));
assert(srcId(0) === idB && srcId(1) === idA,
  '拿着一个结果点另一个结果所在行 → 两个位置互换（' + idA + ' ↔ ' + idB + '，实际 ' + srcId(0) + '/' + srcId(1) + '）');
assert(pairRows().every(r => r.classList.contains('matched')) && $('pairRest').hidden,
  '互换后两行仍是实线、未连列表仍为空');

// 解除只否决"被解的那一个"：字形对得上的另一个仍会自动顶上
assert(!!rowX(0), '已配对的行带一个解除按钮');
click(rowX(0));
assert(!pairRows()[0].classList.contains('matched') && srcId(1) === idA,
  '解除后本行回到虚线、另一行不受影响');
assert(freeChips().length === 1 && freeChips()[0].dataset.chipId === idB,
  '被解除的 ' + idB + ' 回到"还没连上"列表，且不会自己连回去');
assert(rowSrc(0).textContent.includes('点下面选一个合成结果'),
  '空位有可用结果时写「点下面选一个合成结果」（实际 ' + rowSrc(0).textContent.replace(/\s+/g, '') + '）');

// 从"还没连上"列表拿起一个，放到已被占用的行：被腾出来的那一行不留空洞
click(freeChips()[0]);
assert($('status').textContent.includes('点上面'), '未连列表的引导条指向"点上面它要落到的谜底位"（实际 ' + $('status').textContent + '）');
click(rowSlot(1));
assert(srcId(1) === idB, '拿起的 ' + idB + ' 落到第 2 行');
assert(pairRows().every(r => r.classList.contains('matched')) && $('pairRest').hidden,
  '被腾出来的那行立刻由字形对得上的结果顶上 —— 不留空洞、看板始终两行都有来源');

click($('btnBuild'));
dump('timeline status:', () => $('status').textContent);
assert($('status').textContent.includes('动画已生成'), '生成动画给出确认');
assert($('step3').dataset.state === 'done', '生成动画后 ③ 标记为已完成');
assert($('stageEmpty').hidden, '画布空态在生成动画后隐藏');
const stDom = [...doc.querySelectorAll('#stage svg')];
assert(stDom.length === 1, '舞台渲染出 SVG（空态与画面不打架）');
const firstFrameTexts = stDom.length ? [...stDom[0].querySelectorAll('text')].map(t => t.textContent) : [];
dump('首帧文字:', () => firstFrameTexts.join('|'));
assert(firstFrameTexts.includes('谜面'), '首帧行1 左端有「谜面」标签');
assert(!firstFrameTexts.includes('谜底'), '首帧无「谜底」标签（谜底成形前不出现）');
assert(/text-anchor="middle"/.test(stDom[0].outerHTML), '标签以覆盖层 <text> 渲染');
// 场景序列：合成结果直接落位 -> 无 displace；手动只配了一段 -> 另一段仍靠 reveal 弹出
dump('场景序列:', () => window.__dshTimeline.scenes.map(sc => sc.type).join(','));
assert(!window.__dshTimeline.scenes.some(sc => sc.type === 'displace'), '时间轴里已无位移阶段（合成结果直接落位）');
assert(window.__dshTimeline.scenes[window.__dshTimeline.scenes.length - 1].type === 'hold', '末段是定格，不是空转的 reveal');
assert(window.__dshTimeline.scenes.map(s => s.type).join(',') === 'decompose,decompose,merge,merge,hold',
  '换配回两段都连上后：拆2 + 合2 + 定格，没有多余的兜底段（实际 ' + window.__dshTimeline.scenes.map(s => s.type).join(',') + '）');
assert(Math.abs(window.__dshTimeline.duration - 5.5) < 0.01, '总时长 = 拆2.6 + 合2.4 + 定格0.5（实际 ' + window.__dshTimeline.duration + '）');

// ---------- 两段谜底全流程（自动配对 -> 每个槽都被合成结果落位）----------
// （左侧示例 chip 已移除，这里用手动点击走完与「木口艹化 → 杏花」等价的流程）
$('inputMian').value = '木口艹化';
click($('btnMian'));
ensurePen('zi');
for (const g of ['木', '口', '艹', '化']) tagChar(g);   // 四个字都标成字素
pickPart('木', '木'); pickPart('口', '口'); mergeAs('杏');
pickPart('艹', '艹'); pickPart('化', '化'); mergeAs('花');
$('answerInput').value = '杏花';
$('answerInput').dispatchEvent(new window.Event('input', { bubbles: true }));
click($('btnBuild'));
dump('池子:', () => poolChars());
assert($('stageEmpty').hidden, '两段合并后画布已有画面');
assert(pairRows().length === 2 && pairRows().every(r => r.classList.contains('matched')), '多段示例谜底 2 个字，配对看板两行都连上');
assert($('durLabel').textContent === '2.9s', '合成结果直接落位后总时长 2.9s（实际 ' + $('durLabel').textContent + '）');
dump('示例场景序列:', () => window.__dshTimeline.scenes.map(s => s.type).join(','));
assert(window.__dshTimeline.scenes.map(s => s.type).join(',') === 'merge,merge,hold',
  '两段谜底全部由合成结果落位：无 decompose / 无 displace / 无 reveal（实际 ' + window.__dshTimeline.scenes.map(s => s.type).join(',') + '）');
assert(window.__dshTimeline.answerUnits[0] === 'r0' && window.__dshTimeline.answerUnits[1] === 'r1',
  '两个合成结果本身就是末帧的谜底单元');

// ---------- 导出格式 / 尺寸（此时画布仍是短画布 640×210）----------
const fmtSel = $('fmtSel');
assert(fmtSel && [...fmtSel.options].map(o => o.value).join(',') === 'gif,apng,svg', '导出格式下拉 = gif,apng,svg');
assert(fmtSel.value === 'gif', '默认导出格式 = GIF');
assert($('btnExport').textContent.trim() === '导出', '导出按钮文案为「导出」');
assert($('sizeHint').textContent.trim() === '640×210', '尺寸提示默认 = 640×210（实际 ' + $('sizeHint').textContent.trim() + '）');
$('scaleSel').value = '2';
$('scaleSel').dispatchEvent(new window.Event('change', { bubbles: true }));
assert($('sizeHint').textContent.trim() === '1280×420', '切换 2x 后尺寸提示 = 1280×420');
$('scaleSel').value = '1';
$('scaleSel').dispatchEvent(new window.Event('change', { bubbles: true }));
assert(typeof window.GifEncoder === 'function', 'GifEncoder（gif.js）已加载');

// ---------- 谜底提前到 ①：填了就"边拼边落位" ----------
assert(!!$('step1').querySelector('#answerInput'), '谜底输入框在第 ① 步（和谜面一起填）');
assert($('step1').querySelector('.field-tag.req') && $('step1').querySelector('.field-tag.opt'), '谜面标「必填」、谜底标「可留空」');
$('inputMian').value = '木口';
$('answerInput').value = '杏';
click($('btnMian'));
assert($('answerLine').textContent.includes('杏'), '③ 回显 ① 里填的谜底（实际 ' + $('answerLine').textContent.trim() + '）');
assert($('step3Meta').textContent.trim() === '待生成', '填了谜底后 ③ 提示「待生成」');
ensurePen('zi'); tagChar('木'); tagChar('口');

// 拼出谜底的那一次合并，落点由"已知的谜底"直接决定
pickPart('木', '木');
pickPart('口', '口');
mergeAs('杏');
assert(doc.querySelectorAll('#mergesWrap .merge-item').length >= 1, '合并成功');
click($('btnBuild'));
dump('提前填谜底的场景序列:', () => window.__dshTimeline.scenes.map(x => x.type).join(','));
assert(!window.__dshTimeline.scenes.some(x => x.type === 'displace'), '提前填谜底同样没有独立位移阶段');
assert(window.__dshTimeline.answerUnits[0] === 'r0', '合成结果直接就是谜底单元（无需再配对）');

// Enter 在谜底字段不应该重载谜面（否则会手滑清掉已有合并）
const mergesBefore = doc.querySelectorAll('#mergesWrap .merge-item').length;
$('answerInput').value = '杏';
$('answerInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert(doc.querySelectorAll('#mergesWrap .merge-item').length === mergesBefore, 'Enter 在谜底字段不重载谜面、不清掉已有合并（' + mergesBefore + ' 条）');

// 谜底留空时，③ 必须给出"去哪填"的出路
$('inputMian').value = '千古';
$('answerInput').value = '';
click($('btnMian'));
assert($('answerLine').textContent.includes('还没填谜底'), '留空时 ③ 明确说明还没填（实际 ' + $('answerLine').textContent.trim() + '）');
assert(!!$('answerLine').querySelector('button'), '留空时 ③ 给出可点的出路');
click($('btnBuild'));
assert($('status').textContent.includes('第 ① 步'), '生成失败时指向 ① 而不是空转（实际 ' + $('status').textContent + '）');
assert(!$('statusAction').hidden && $('statusAction').textContent.includes('①'), '并给出跳转动作');


// ---------- 合成结果也能当输入（连环合并）+ 配对面板只列"活着的"合成结果 ----------
$('inputMian').value = '十八口';
$('answerInput').value = '杏子';
click($('btnMian'));
ensurePen('zi');
for (const g of ['十', '八', '口']) tagChar(g);
pickPart('十', '十'); pickPart('八', '八'); mergeAs('木');
assert(mergeChips().length === 1 && mergeChips()[0].textContent.includes('木'),
  '字素池首行列出「已拼出」的字 —— 合成结果能继续当输入（旧实现第二笔点不出来）');
pickMerge('r0'); pickPart('口', '口');
dump('连环托盘:', () => $('mergeExpr').textContent);
assert($('mergeExpr').textContent.includes('木(合成) + 口(整字)'), '合成结果与零件在同一个选择集里混选');
mergeAs('杏');
assert(doc.querySelectorAll('#mergesWrap .merge-item').length === 2, '十八口→杏 两笔合并全部由点击完成');
assert(mergeChips()[0].disabled, '被后一次合并吃掉的中间产物标「已用」，不能再当输入');
assert(pairRows().length === 2, '配对看板仍是两行（一行一个谜底位）');
assert(srcId(0) === 'r1' && !pairRows()[0].classList.contains('unmatched'),
  '第 1 行由活着的合成结果 r1 承担（被吃掉的「木」不冒充谜底）');
assert(rowSrc(0).querySelector('.meta').textContent.includes('+'),
  '左侧写出"这一笔是怎么拼出来的"（实际 ' + rowSrc(0).querySelector('.meta').textContent + '）');
assert(pairRows()[1].classList.contains('unmatched') && pairRows()[1].querySelector('.pair-src.empty'),
  '第 2 行是虚线空位：没有合成结果产出「子」，动画末尾直接弹出');
assert(pairRows()[1].querySelector('.pair-src').textContent.includes('没有空闲的合成结果'),
  '空位上写出下一步：没有空闲结果时如实说明（而不是让人去找一个不存在的按钮）');
// 没拿起任何结果就点空位：给出可照做的提示，不静默失败
click(pairRows()[1].querySelector('.pair-src'));
assert($('status').textContent.includes('没有空闲的合成结果') && pairRows()[1].classList.contains('unmatched'),
  '手上没有结果、又没有空闲结果时 → 引导条给出两条出路（换配或末尾弹出）（实际 ' + $('status').textContent + '）');
assert($('pairRest').hidden, '没有未连的合成结果时不显示列表');
click($('btnBuild'));
assert((window.__dshTimeline.answerUnits[1] || '').charAt(0) === 'a', '没有来源的谜底字由 reveal 兜底承担谜底位');
assert(window.__dshTimeline.scenes.map(s => s.type).join(',') === 'merge,merge,reveal,hold',
  '序列：两笔合并 + 兜底弹出 + 定格（没有位移段）（实际 ' + window.__dshTimeline.scenes.map(s => s.type).join(',') + '）');
const polyColors = new Set();
for (let i = 0; i <= 40; i++) {
  const t = window.__dshTimeline.duration * i / 40;
  for (const it of window.__dshTimeline.stateAt(t).items) polyColors.add(it.color);
}
assert(!polyColors.has('#9c36b5'), '谜底一个颜色：动画里不再出现第二种谜底色（旧的紫 #9c36b5）');
const ansColors = new Set(Object.keys(window.__dshTimeline.answerUnits).map(k => {
  const id = window.__dshTimeline.answerUnits[k];
  const u = window.__dshTimeline.stateAt(window.__dshTimeline.duration).items.find(i => i.id === id);
  return u && u.color;
}));
assert(ansColors.size === 1 && ansColors.has('#0c8599'), '谜底位上的字（落位的与兜底弹出的）同色（实际 ' + [...ansColors].join(',') + '）');
dump('动画里的颜色:', () => [...polyColors].join(','));

// ---------- 手写拆法：每行末尾常驻「再写一个」，不用先点按钮 ----------
$('inputMian').value = '古木';
$('answerInput').value = '';
click($('btnMian'));
ensurePen('zi'); tagChar('古'); tagChar('木');
const decompInput = g => blockOf(g).querySelector('.decomp-input');
const mineChips = g => [...blockOf(g).querySelectorAll('.sel-chip.mine')];
const mineGlyphs = g => mineChips(g).map(c => c.querySelector('.chip-glyph').textContent).join('+');
const typeParts = (g, text) => {
  decompInput(g).value = text;
  decompInput(g).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};
const decompBtn = (g, label) => [...blockOf(g).querySelectorAll('.decomp-btn')]
  .find(b => b.textContent.includes(label));

assert(!!decompInput('古'), '每行末尾常驻「再写一个」输入框（不用先点「自定义拆法」）');
assert(![...blockOf('古').querySelectorAll('button')].some(b => /自定义拆法|改我的拆法/.test(b.textContent)),
  '不再有「自定义拆法」/「改我的拆法」按钮（少点一次）');
assert(rowChips('古') === '古,十,口', '古 先用拆字库的拆法（十+口）');

// 连续添加：回车一次加一块，输入框留在原地可以接着写
typeParts('古', '木');
assert(rowChips('古') === '古,木,十,口', '写「木」回车 → 立刻成为这个字的部件（实际 ' + rowChips('古') + '）');
assert(!!decompInput('古') && decompInput('古').value === '', '加完输入框还在、且已清空（可以连着写）');
typeParts('古', '口');
dump('连续添加后:', () => rowChips('古') + ' | ' + $('status').textContent);
assert(rowChips('古') === '古,木,口,十', '接着写「口」→ 手写两块在前，拆字库多出的 十 一并摊出（实际 ' + rowChips('古') + '）');
assert(mineGlyphs('古') === '木+口', '手写加的部件标出来可撤销（实际 ' + mineGlyphs('古') + '）');
assert(!!decompBtn('古', '用回拆字库'), '同时给出「用回拆字库」的退路（改错了不用重来）');
assert(!blockOf('古').querySelector('.variant-sel'),
  '不再有「拆法」下拉 —— 不区分拆法，所有拆法的部件一次列出');

// 一次写多个也认（「木 口」/「木口」等价）
click(decompBtn('古', '用回拆字库'));
assert(rowChips('古') === '古,十,口', '「用回拆字库」恢复默认拆法（实际 ' + rowChips('古') + '）');
typeParts('古', '木口');
assert(rowChips('古') === '古,木,口,十', '一次写「木口」→ 两块（实际 ' + rowChips('古') + '）');

// 块上的 ✕ 撤销我写的那一块（拆字库摊出来的部件没有 ✕）
click(mineChips('古')[0].querySelector('.de-x'));
assert(rowChips('古') === '古,口,十', '点手写块上的 ✕ 去掉它（实际 ' + rowChips('古') + '）');
assert(!partChip('古', '十').querySelector('.de-x'), '拆字库摊出来的部件没有 ✕（那不是我加的）');
typeParts('古', '木');
assert(rowChips('古') === '古,口,木,十', '去掉后还能接着加（实际 ' + rowChips('古') + '）');

// ---------- 点选部件：不想打字就从字根面板里挑 ----------
const pickBtn = g => blockOf(g).querySelector('.de-pick-btn');
assert(!!pickBtn('古'), '每行带「选部件」入口');
assert(!blockOf('古').querySelector('.de-picker'), '默认不展开面板（池子保持紧凑）');
click(pickBtn('古'));
const picker = () => blockOf('古').querySelector('.de-picker');
assert(!!picker(), '点「选部件」展开字根面板');
assert(picker().textContent.includes('本谜面已有的') && picker().textContent.includes('常用部件'),
  '面板分两段：本谜面已有的部件 + 常用字根');
const pickChip = g => [...picker().querySelectorAll('.de-pick')].find(b => b.dataset.pick === g);
click(decompBtn('古', '用回拆字库'));
assert(!!picker(), '清空手写后面板仍展开（正在挑部件时不打断）');
click(pickChip('口'));
assert(rowChips('古') === '古,口,十', '点一下字根就加进拆法（实际 ' + rowChips('古') + '）');
assert(!!picker(), '点完面板不收起 —— 可以连着点');
click(pickChip('木'));
assert(rowChips('古') === '古,口,木,十', '连着点第二个字根（实际 ' + rowChips('古') + '）');
assert(pickChip('口').classList.contains('done'), '已在拆法里的字根标出来（避免重复点）');
click(pickBtn('古'));
assert(!blockOf('古').querySelector('.de-picker'), '再点「收起」关闭面板');

// 写出来的部件能直接当输入合并
pickPart('古', '木'); pickPart('古', '口');
assert($('mergeExpr').textContent.includes('木(来自古) + 口(来自古)'), '手写部件与拆字库部件走同一条路（实际 ' + $('mergeExpr').textContent + '）');
mergeAs('杏');
assert(doc.querySelectorAll('#mergesWrap .merge-item').length === 1, '用手写部件完成一次合并');

// 改拆法要级联清掉用到这个字的合并（否则部件实例还在、字形却换了 → 破图）
typeParts('古', '十');
assert(doc.querySelectorAll('#mergesWrap .merge-item').length === 0, '改拆法清掉了用到这个字的合并');
assert($('status').textContent.includes('清掉'), '引导条说明连锁删除的后果（实际 ' + $('status').textContent + '）');

// 拆字库没收录的字：不是死路，而是引导你手写
$('inputMian').value = '龘';
click($('btnMian'));
ensurePen('zi'); tagChar('龘');
assert(blockOf('龘').textContent.includes('拆字库未收录'), '未收录的字如实说明');
assert(!!decompInput('龘'), '未收录的字同样给出手写/点选入口（不再是一句"只能以整字参与合成"的死路）');
typeParts('龘', '龙龙龙');
assert(rowChips('龘') === '龘,龙,龙,龙', '未收录的字连写三个「龙」→ 三块（实际 ' + rowChips('龘') + '）');
assert($('poolMeta').textContent.includes('4 个'), '池子计数把手写部件算进去（整字 + 3 个手写部件 = 4，实际 ' + $('poolMeta').textContent + '）');

// 长谜面换行（手写拆法之后的独立场景）
$('inputMian').value = '一口咬掉牛尾巴二人土上坐田土日月';
click($('btnMian'));
ensurePen('zi'); tagChar('一');
pickPart('一', '一'); mergeAs('一');
$('answerInput').value = '告';
$('answerInput').dispatchEvent(new window.Event('input', { bubbles: true }));
click($('btnBuild'));
const svg3 = doc.querySelector('#stage svg');
const vb3 = svg3 ? svg3.getAttribute('viewBox') : '';
assert(/^0 0 640 \d+$/.test(vb3), '长谜面 viewBox 宽度仍 640（实际 ' + vb3 + '）');
const h3 = vb3 ? +vb3.split(' ')[3] : 0;
assert(h3 > 210, '长谜面画布自动加高（H=' + h3 + ' > 210）');
assert($('sizeHint').textContent.trim() === '640×' + h3, '尺寸提示跟随动态高度（实际 ' + $('sizeHint').textContent.trim() + '）');
assert($('stage').style.aspectRatio.replace(/\s+/g, '') === '640/' + h3, '预览舞台与画布同比例');

// ---------- 双扣：两个合成结果指向同一个谜底位 ----------
$('inputMian').value = '一大二人';
$('answerInput').value = '天';
click($('btnMian'));
ensurePen('zi');
for (const g of ['一', '大', '二', '人']) tagChar(g);
pickPart('一', '一'); pickPart('大', '大'); mergeAs('天');   // r0 = 天（一+大）
pickPart('二', '二'); pickPart('人', '人'); mergeAs('天');   // r1 = 天（二+人）
$('answerInput').value = '天';
$('answerInput').dispatchEvent(new window.Event('input', { bubbles: true }));
assert(pairRows().length === 1, '双扣：谜底 1 个字 → 看板 1 行（实际 ' + pairRows().length + '）');
const srcs0 = () => pairRows()[0].querySelectorAll('.pair-src:not(.empty)');
assert(srcs0().length === 2, '双扣：这一行有两个来源方块（实际 ' + srcs0().length + '）');
assert(pairRows()[0].querySelectorAll('.pair-x').length === 2, '双扣：两个来源各带一个 ✕（实际 ' + pairRows()[0].querySelectorAll('.pair-x').length + '）');
// 拿起一个来源，再点已有来源的行 → 叠加（双扣），不被挤掉
click(srcs0()[0]);                 // 拿起 r0
click(srcs0()[1]);                 // 点另一个来源所在行 → 叠加
assert(srcs0().length === 2, '双扣：拿起再点已有行仍是两个来源（叠加不挤掉，实际 ' + srcs0().length + '）');
// 解除其中一个不影响另一个：只剩一个来源，被解的那个回到"还没连上"
click(pairRows()[0].querySelectorAll('.pair-x')[0]);
assert(srcs0().length === 1, '双扣：解除一个后这一行还剩一个来源（实际 ' + srcs0().length + '）');
assert(freeChips().length === 1, '双扣：被解除的那个回到"还没连上"列表（实际 ' + freeChips().length + '）');
click($('btnBuild'));
assert(window.__dshTimeline.scenes.map(s => s.type).join(',') === 'merge,merge,hold',
  '双扣：两个结果都落位、无末尾 reveal（实际 ' + window.__dshTimeline.scenes.map(s => s.type).join(',') + '）');
assert(window.__dshTimeline.scenes.every(s => s.type !== 'reveal'), '双扣：没有被挤去末尾弹出');

// ---------- 换了谜面：仍然先选笔再点字 ----------
$('inputMian').value = '木口';
click($('btnMian'));
assert($('step2').dataset.state === 'active', '载入后 ② 立即可用（不再需要先标注）');
assert(doc.querySelectorAll('#chipsWrap .chip.tagged').length === 0, '换新谜面同样不预设身份');
ensurePen('zi');                       // 上一场景最后拿的是「衬字」笔，换回字素
tagChar('木'); tagChar('口');
assert(chipBadge('木') === '字素' && chipBadge('口') === '字素', '换谜面后照样点一下就定');
assert($('step2Meta').textContent.trim() === '2 个可拆字', '没合并时 ② 副标题给出可拆字数（实际 ' + $('step2Meta').textContent.trim() + '）');
assert(!$('step2').querySelector('.step-foot .btn.next'), '①② 不再放「接下来」按钮（跳转只走步骤轨）');

dump('window errors:', () => (errs.length ? errs.join('; ') : '无'));
assert(!errs.length, '全流程无 window 异常');
