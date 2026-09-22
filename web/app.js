/**
 * app.js — 字谜离合动画工坊（网页版）UI 层。
 *
 * 工作流（选定式，无拖拽）:
 *   1. 输入谜面 → 逐字显示为可点击字块
 *   2. 点字 → 定身份（字素 / 衬字），身份绑定颜色
 *   3. 字素自动拆解出部件 → 点选可合成对象 → 合并（候选/手填合成字）
 *   4. 填谜底 → 合成结果↔谜底字配对（多段谜底）→ 生成动画 → 预览 → 导出
 *
 * 引导层（v0.2）:
 *   - 步骤轨 rail：常驻显示四步状态（未开始/进行中/已完成/待解锁），可点击跳转
 *   - 步骤门控：前置条件不满足时卡片收成一行原因说明，避免"下一步该干嘛"的困惑
 *   - 常驻引导条（含动作按钮）：唯一回答"下一步做什么"的地方；步骤间跳转只走步骤轨
 *   - 画布空态、可关闭的使用说明面板
 *   状态推导集中在 flowState()，渲染集中在 renderFlow()。
 *
 * 纯逻辑在 studio.js（可测试）；渲染/交互在此层。
 * 依赖: data/decomp.js(数据) engine.js(时间轴) studio.js(流程) apng.js/gif.js(编码器)
 */
'use strict';

/* global DECOMP_DATA, Engine, Studio, ApngEncoder, GifEncoder, Svg */
const { esc, num, svgForState } = Svg;

// ---------------------------------------------------------------- 配置
const CONFIG = {
  W: 640, H: 210,             // 两行动画行贴边 + 横向致密：APNG 帧小、文件小（嵌入公众号）
  charY: 70, charFS: 56,      // 行1 字素行（即谜面，无独立标注行）
  mergeX: 320, mergeY: 155,   // 行2 = 部件落点 + 合成结果 + 谜底槽位（第二三阶段同一行）；mergeX=W/2
  answerFS: 62,               // 谜底字形（行2 内变形显示）
  labelFS: 22,                // 行标签字号：「谜面」（行1 左端常显）/「谜底」（行2 左端第三阶段淡入）
  labelX: 30,                 // 行标签横坐标（画布左端；极端 6 字 6 合并时内容最左约 67px，留 15px 余量）
  // 长谜面自动换行 + 按行数自动降字号（字号有下限，保证清晰）
  maxMianLines: 3, minCharFS: 34,      // 谜面最多 3 行；最多缩到 34px
  maxSecondLines: 2, minAnswerFS: 40,  // 行2（合成结果/谜底）最多 2 行；最多缩到 40px
  pad: 64,                    // 每行左右安全边（给左端行标签留位）
  fontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC','Source Han Sans SC',sans-serif",
};

// 身份分类：**只分两类**，正好对应算法的两种行为 ——
//   zi（字素）= 参与拆合；ci（衬字）= 不参与拆合，只决定谜面行的配色（教学用）。
// 谜界会把"不拆的字"再细分为抱合字（离合动作）与指示字（方位取舍），但本工具对这两者
// 完全同构，分出来没有对应操作；而且有谜家明确反对把指示字并进"抱合字"（概念扩大化），
// 故采用中性的伞形词「衬字」。分类整体可选：载入谜面时全部默认成「字素」。
// color 用于描边/字形；deep 是同色系压暗一档的色调，用来承载文字
//（白底上的文字色 / 色底上的白字底色），两者都保证 ≥4.5:1。
const ROLE = {
  none: { label: '未标注', color: '#868e96', deep: '#5c636b', desc: '还没定身份', eg: '' },
  ci:   { label: '衬字',   color: '#e8590c', deep: '#b34700', desc: '不拆的字', eg: '谜面里不参与拆合的字：离合动作如「合、出、去」，方位取舍如「头、尾、边」' },
  zi:   { label: '字素',   color: '#2f9e44', deep: '#237a35', desc: '可拆可拼的字', eg: '要被拆开、重新拼起来的字' },
};

/** 步骤轨定义：编号、短名。② 把"标角色"和"拆解合并"合成一个谜面工作台。 */
const STEPS = [
  { n: 1, name: '谜面' },
  { n: 2, name: '拆合' },
  { n: 3, name: '动画' },
];

const ICON_PLAY = '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>';

// 交互态（制作状态 S 由 Studio.createState 管理）
const S = {
  t: 0,
  playing: false,
  fps: 12,
  loop: false,
  scale: 1,
  selected: [],       // 待合并选中 id
  openCharId: null,   // 当前选中的谜面字（决定字卡身份与池子里高亮的那一行）
  partPicker: null,   // 展开了「选部件」字根面板的字 id
  pairPick: null,     // 配对面板中选中的合成结果 id
  timeline: null,
};
let work = null;      // 制作状态（Studio.createState 的产物）

// ---------------------------------------------------------------- DOM 快捷
const $ = id => document.getElementById(id);
const DOM = {
  inputMian: $('inputMian'), btnMian: $('btnMian'),
  chipsWrap: $('chipsWrap'), charCard: $('charCard'),
  btnDemo: $('btnDemo'),
  btnAllZi: $('btnAllZi'),
  poolWrap: $('poolWrap'), poolMeta: $('poolMeta'), poolHint: $('poolHint'),
  partsWrap: $('partsWrap'), pendingWrap: $('pendingWrap'),
  mergeExpr: $('mergeExpr'),
  resultInput: $('resultInput'), candidateWrap: $('candidateWrap'),
  confirmMergeBtn: $('confirmMergeBtn'), cancelMergeBtn: $('cancelMergeBtn'),
  mergesWrap: $('mergesWrap'),
  answerInput: $('answerInput'), btnBuild: $('btnBuild'), answerLine: $('answerLine'),
  pairPanel: $('pairPanel'), pairBoard: $('pairBoard'),
  pairRest: $('pairRest'), pairLabel: $('pairLabel'), pairResults: $('pairResults'),
  rail: $('rail'), guideBar: $('guideBar'), statusAction: $('statusAction'),
  stage: $('stage'), stageSvg: $('stageSvg'), stageEmpty: $('stageEmpty'), stageDemoBtn: $('stageDemoBtn'),
  btnPlay: $('btnPlay'), btnPlayIcon: $('btnPlayIcon'), playLabel: $('playLabel'), btnRestart: $('btnRestart'),
  btnStepBack: $('btnStepBack'), btnStepFwd: $('btnStepFwd'),
  slider: $('slider'), timeLabel: $('timeLabel'), durLabel: $('durLabel'),
  fpsSel: $('fpsSel'), loopChk: $('loopChk'), scaleSel: $('scaleSel'), fmtSel: $('fmtSel'),
  sizeHint: $('sizeHint'),
  btnExport: $('btnExport'), exportProgress: $('exportProgress'), exportStatus: $('exportStatus'),
  status: $('status'), selStatus: $('selStatus'),
  btnGoExport: $('btnGoExport'),
  helpOverlay: $('helpOverlay'), btnHelp: $('btnHelp'), helpClose: $('helpClose'),
  helpSkip: $('helpSkip'), helpDemo: $('helpDemo'),
};
const stepEl = n => $('step' + n);
const stepMetaEl = n => $('step' + n + 'Meta');

// ---------------------------------------------------------------- 工具
const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 引导条提示。ok=false 表示这是一条"出错了"的提示（红色）；
 * action 可选 {label, fn}，会在提示条右侧渲染一个可点按钮 —— 每个死路都要给出路。
 */
function setStatus(msg, ok, action) {
  DOM.status.textContent = msg;
  DOM.guideBar.className = 'guide' + (ok === false ? ' err' : '');
  if (action && action.label) {
    DOM.statusAction.hidden = false;
    DOM.statusAction.textContent = action.label;
    DOM.statusAction.onclick = action.fn;
  } else {
    DOM.statusAction.hidden = true;
    DOM.statusAction.onclick = null;
  }
}
function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
}

// ---------------------------------------------------------------- 引导：步骤状态
/** 推导三步的完成/进行中/待解锁状态与各处计数（纯读，可测） */
function flowState() {
  const loaded = !!(work && work.chars.length);
  const total = loaded ? work.chars.length : 0;
  const ziCount = loaded ? work.chars.filter(c => c.role === 'zi').length : 0;
  const merges = loaded ? work.merges.length : 0;
  const answer = !!(work && work.answer);
  const hasTl = !!S.timeline;
  return {
    loaded, total, ziCount, merges, answer, hasTl,
    // ① 输入谜面：载入即完成
    s1: loaded ? 'done' : 'active',
    // ② 拆解合成：至少合并出一次才算完成（不强制标注角色）
    s2: !loaded ? 'locked' : (merges > 0 ? 'done' : 'active'),
    // ③ 谜底动画：生成了时间轴才算完成
    s3: !loaded ? 'locked' : (hasTl ? 'done' : 'active'),
  };
}

function renderRail(fs) {
  DOM.rail.innerHTML = '';
  STEPS.forEach(s => {
    const st = fs['s' + s.n];
    const b = el('button', 'rail-step');
    b.type = 'button';
    b.dataset.step = s.n;
    b.dataset.state = st;
    if (st === 'active') b.setAttribute('aria-current', 'step');
    b.title = st === 'locked' ? '还没解锁：先完成前面的步骤' : '跳到第 ' + s.n + ' 步';
    b.innerHTML = `<span class="rail-dot">${s.n}</span><span class="rail-name">${esc(s.name)}</span>`;
    b.addEventListener('click', () => gotoStep(s.n));
    DOM.rail.appendChild(b);
  });
}

/** 渲染步骤轨、卡片状态与每步计数（步骤间跳转只由步骤轨承担） */
function renderFlow() {
  const fs = flowState();
  renderRail(fs);

  for (const s of STEPS) {
    const sec = stepEl(s.n);
    if (!sec) continue;
    sec.dataset.state = fs['s' + s.n];
    const body = sec.querySelector('.step-body');
    if (body) body.inert = fs['s' + s.n] === 'locked';
  }

  // 各步副标题：把"做到哪了"写在标题右侧
  if (stepMetaEl(1)) stepMetaEl(1).textContent = fs.loaded ? `${fs.total} 个字` : '';
  if (stepMetaEl(2)) stepMetaEl(2).textContent = fs.merges
    ? `${fs.merges} 次合并`
    : (fs.loaded ? `${fs.ziCount} 个可拆字` : '');
  if (stepMetaEl(3)) stepMetaEl(3).textContent = fs.hasTl ? S.timeline.duration.toFixed(1) + ' 秒动画' : (fs.answer ? '待生成' : '');
  renderAnswerLine();

  if (DOM.btnGoExport) DOM.btnGoExport.disabled = !fs.hasTl;

  DOM.btnAllZi.disabled = !fs.loaded;
}

/** 滚动并聚焦到某一步（待解锁时给出原因，不静默失败） */
function scrollToEl(node, block) {
  // jsdom 没有实现 scrollIntoView，测试环境下静默跳过
  if (node && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: block || 'start' });
  }
}
function focusSoft(node) {
  if (!node) return;
  try { node.focus({ preventScroll: true }); } catch { node.focus(); }
}

function gotoStep(n) {
  const sec = stepEl(n);
  if (!sec) return;
  if (sec.dataset.state === 'locked') {
    const why = sec.querySelector('.step-lock');
    setStatus('第 ' + n + ' 步还没解锁：' + (why ? why.textContent.trim() : '先完成前面的步骤。'), false);
    return;
  }
  scrollToEl(sec, 'start');
  sec.classList.add('flash');
  setTimeout(() => sec.classList.remove('flash'), 1200);
  const target = sec.querySelector('.step-body input, .step-body button, .step-body select');
  if (target && !target.disabled) focusSoft(target);
}

// ---------------------------------------------------------------- 谜面工作台（①②合流）
/** 一切"谜面 → 部件 → 合并"的改动都走这里：重建字块、字卡、字素池、托盘与合并记录 */
function renderWorkspace() {
  renderChips();
  renderCharCard();
  renderPool();
  renderTray();
  renderMerges();   // 内部会调 renderPairPanel + renderFlow
  renderFlow();
}

function startMian() {
  const text = DOM.inputMian.value.trim();
  if (!text) {
    setStatus('请先输入谜面文字（只填谜面那一句，不用写谜底）。', false);
    DOM.inputMian.focus();
    return;
  }
  work = Studio.createState(text);
  // 谜底在 ① 就一起填（可留空）：填了的话，每次合并出的字会直接落到它对应的谜底位，
  // 不必等到最后再来配对。这里**不能清空输入框** —— 它现在是 ① 的常驻字段。
  work.answer = DOM.answerInput.value.trim();
  // 分类是可选的：默认全部按「字素」处理，于是"不标完就走不动"的门槛直接消失。
  // 想把某个字标成「衬字」，点开那个字再改即可（只为配色与讲解，不影响拆合）。
  for (const c of work.chars) Studio.assignRole(work, c.id, 'zi');
  S.selected = [];
  S.openCharId = work.chars.length ? work.chars[0].id : null;
  S.pairPick = null;
  S.partPicker = null;
  S.timeline = null;
  S.t = 0;
  DOM.resultInput.value = '';
  DOM.slider.max = 0;
  DOM.exportProgress.style.width = '0%';
  DOM.exportStatus.textContent = '';
  renderWorkspace();
  clearStage();
  renderFlow();
  const ansNote = work.answer ? `谜底「${work.answer}」也记下了，拼出的字会直接落到对应位置。` : '谜底留空，最后再填也行。';
  setStatus(`谜面「${text}」已载入，共 ${work.chars.length} 个字。${ansNote}点任意一个字开始拆。`, true,
    { label: '看使用说明', fn: openHelp });
}

/** ③ 的谜底回显：填了就显示并可跳回修改，留空则给出"去填"的出路 */
function renderAnswerLine() {
  if (!DOM.answerLine) return;
  DOM.answerLine.innerHTML = '';
  const ans = work ? work.answer : '';
  DOM.answerLine.classList.toggle('empty', !ans);
  if (ans) {
    DOM.answerLine.appendChild(el('span', 'ans-note', '谜底'));
    DOM.answerLine.appendChild(el('span', 'ans-glyphs', esc(ans)));
    DOM.answerLine.appendChild(el('span', 'ans-note', `${[...ans].length} 个字 · 在 ① 里改`));
    const edit = el('button', 'mini-btn', '去修改');
    edit.type = 'button';
    edit.addEventListener('click', () => { gotoStep(1); focusSoft(DOM.answerInput); });
    DOM.answerLine.appendChild(edit);
  } else {
    DOM.answerLine.appendChild(el('span', 'ans-note', '还没填谜底 —— 生成动画需要它（谜面已载入，填完不用重新载入）。'));
    const go = el('button', 'btn ghost small', '去 ① 填谜底');
    go.type = 'button';
    go.addEventListener('click', () => { gotoStep(1); focusSoft(DOM.answerInput); });
    DOM.answerLine.appendChild(go);
  }
}

function renderChips() {
  DOM.chipsWrap.innerHTML = '';
  if (!work) return;
  for (const c of work.chars) {
    const open = S.openCharId === c.id;
    const chip = el('button', 'chip' + (open ? ' active' : ''));
    chip.type = 'button';
    chip.dataset.id = c.id;
    chip.innerHTML = `<span class="chip-glyph">${esc(c.char)}</span>`;
    chip.style.borderColor = c.role === 'none' ? '' : ROLE[c.role].color;
    chip.style.color = c.role === 'none' ? '' : ROLE[c.role].color;
    chip.title = `点我展开：改身份。要用的部件在下面的字素池里挑。当前身份：${ROLE[c.role].label}`;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    chip.setAttribute('aria-label',
      `谜面第 ${work.chars.indexOf(c) + 1} 个字「${c.char}」，身份 ${ROLE[c.role].label}${open ? '，已展开' : ''}`);
    if (c.role !== 'none') {
      const tag = el('span', 'chip-role', ROLE[c.role].label);
      tag.style.background = ROLE[c.role].deep;
      chip.appendChild(tag);
    }
    chip.addEventListener('click', () => {
      S.openCharId = open ? null : c.id;
      renderChips();
      renderCharCard();
      renderPool();
      if (!open) {
        // 点字就是"用这个字"，顺势把字素池里对应那一行带进视野（长谜面时不必自己找）
        const blk = DOM.partsWrap.querySelector(`.part-block[data-char-id="${c.id}"]`);
        if (blk) scrollToEl(blk, 'center');
      }
      setStatus(open
        ? '已收起「' + c.char + '」。'
        : (c.role === 'zi'
          ? `已选中「${c.char}」：它拆出的部件在下面的字素池里（已高亮那一行）。`
          : `已展开「${c.char}」：它当前是「${ROLE[c.role].label}」，不参与拆合，字素池里没有它的零件。`));
    });
    DOM.chipsWrap.appendChild(chip);
  }
}

/** 展开的字卡：只放身份（分段控件）。部件统一在下面的字素池里挑，避免"部件跟着字跑" */
function renderCharCard() {
  DOM.charCard.innerHTML = '';
  if (!work) return;
  const c = work.chars.find(x => x.id === S.openCharId);
  if (!c) {
    DOM.charCard.appendChild(el('p', 'hint', '点上面任意一个字，在这里改它的身份；要用的部件去下面的字素池里挑。'));
    return;
  }
  const card = el('div', 'char-card');

  const head = el('div', 'cc-head');
  head.appendChild(el('span', 'cc-glyph', esc(c.char)));
  head.appendChild(el('span', 'cc-label', '它在谜里的身份'));
  const close = el('button', 'cc-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '收起这个字');
  close.addEventListener('click', () => { S.openCharId = null; renderChips(); renderCharCard(); renderPool(); });
  head.appendChild(close);
  card.appendChild(head);

  // 身份：两段式分段控件。只有「字素」参与拆合，另一类只影响谜面行配色。
  const roleBtns = el('div', 'role-btns');
  roleBtns.id = 'roleBtns';
  roleBtns.setAttribute('role', 'group');
  roleBtns.setAttribute('aria-label', `「${c.char}」的身份`);
  for (const key of ['ci', 'zi']) {
    const active = c.role === key;
    const btn = el('button', 'role-btn');
    btn.type = 'button';
    btn.dataset.role = key;
    btn.style.setProperty('--rc', ROLE[key].color);
    btn.style.setProperty('--rc-deep', ROLE[key].deep);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.innerHTML = `<span class="role-name">${ROLE[key].label}</span><span class="role-desc">${esc(ROLE[key].desc)}</span>`;
    btn.title = `${ROLE[key].label}：${ROLE[key].eg}（改身份会清掉用到这个字的合并）`;
    btn.addEventListener('click', () => assignRole(key));
    roleBtns.appendChild(btn);
  }
  card.appendChild(roleBtns);

  if (c.role === 'zi') {
    card.appendChild(el('p', 'cc-note',
      `「${c.char}」是「字素」，它的部件在下面的字素池里 —— 找标着「${c.char}」的那一行。`));
  } else {
    card.appendChild(el('p', 'cc-note',
      `「${ROLE[c.role].label}」只在谜面行出现、给动画配色，不参与拆合，所以在字素池里没有它的零件。点上面的「字素」可以改回可拆状态。`));
  }
  DOM.charCard.appendChild(card);
}

/**
 * 字素池：把所有「字素」拆出的部件摊在同一处，一行一个来源字；最上面再挂一行"已拼出"
 * （合成结果本身也是下一笔合并的输入，否则「十+八=木 → 木+口=杏」这种连环根本点不出来）。
 * 关键点：池子里所有字块属于同一个选择集，因此可以随手拿 A 字的部件和 B 字的部件拼。
 */
function renderPool() {
  if (!DOM.partsWrap) return;
  DOM.partsWrap.innerHTML = '';
  if (!work) {
    if (DOM.poolMeta) DOM.poolMeta.textContent = '';
    if (DOM.poolHint) DOM.poolHint.hidden = false;
    return;
  }
  const zis = work.chars.filter(c => c.role === 'zi');
  const avail = Studio.mergableItems(work).length;
  if (DOM.poolMeta) DOM.poolMeta.textContent = zis.length
    ? `还可选 ${avail} 个对象 · 来自 ${zis.length} 个「字素」`
    : '还没有字素';
  if (DOM.poolHint) DOM.poolHint.hidden = !!zis.length;
  if (!zis.length) {
    DOM.partsWrap.appendChild(el('p', 'cc-note',
      '池子还是空的 —— 点上面任意一个字，把身份设成「字素」，它拆出的部件就会出现在这里。'));
    return;
  }
  const used = Studio.usedIdsOf(work);
  const merges = mergePoolBlock(used);
  if (merges) DOM.partsWrap.appendChild(merges);
  for (const c of zis) DOM.partsWrap.appendChild(poolBlock(c, used));
}

/** 池子首行：已拼出的字（合成结果）。它们既能当谜底，也能继续当下一笔合并的输入。 */
function mergePoolBlock(used) {
  if (!work.merges.length) return null;
  const block = el('div', 'part-block merges-block');
  const titleRow = el('div', 'part-block-title');
  titleRow.appendChild(el('span', 'pb-text', '已拼出'));
  block.appendChild(titleRow);
  const chipRow = el('div', 'chip-row');
  for (const m of work.merges) {
    // 被后面的合并吃掉的中间产物标「已用」：它不能再当输入，也不再承担谜底
    chipRow.appendChild(makeSelChip(m.id, m.glyph, m.id, used.has(m.id)));
  }
  block.appendChild(chipRow);
  return block;
}

/** 字素池里的一行：来源字 + （整字 / 各部件）字块 + 末尾的「再写一个」输入框 */
function poolBlock(c, used) {
  const vs = Studio.variantsOf(work, c.id);
  const mine = !!(work.manual && work.manual[c.id]);

  const block = el('div', 'part-block' + (S.openCharId === c.id ? ' active' : ''));
  block.dataset.charId = c.id;

  const titleRow = el('div', 'part-block-title');
  titleRow.appendChild(el('span', 'pb-glyph', esc(c.char)));
  titleRow.appendChild(el('span', null, `「${c.char}」`));
  block.appendChild(titleRow);

  const chipRow = el('div', 'chip-row');
  // 整字本身也是可合成对象（从多个字提取时经常直接用整字）
  chipRow.appendChild(makeSelChip(c.id, c.char, '整字', used.has(c.id)));
  // 手写加的部件带 ✕（撤销我加的那块）；拆字库摊出来的部件只读
  for (const p of work.parts.filter(p => p.from === c.id)) {
    const rm = p.manual ? () => removeManualPart(c, p.glyph) : null;
    chipRow.appendChild(makeSelChip(p.id, p.glyph, '部件', used.has(p.id), rm));
  }
  // 末尾常驻「再写一个」：不用先点「自定义拆法」，直接往这一行加部件，回车可以连着加
  chipRow.appendChild(addPartInput(c));
  // 不想打字就点「选部件」：本谜面已有的部件 + 常用字根，点一下加一块
  const pick = el('button', 'mini-btn decomp-btn de-pick-btn', S.partPicker === c.id ? '收起' : '选部件');
  pick.type = 'button';
  pick.title = '从字根面板里点选部件（不用打字）';
  pick.addEventListener('click', () => {
    S.partPicker = S.partPicker === c.id ? null : c.id;
    renderPool();
    if (S.partPicker === c.id) focusAddInput(c);
  });
  chipRow.appendChild(pick);
  block.appendChild(chipRow);

  if (S.partPicker === c.id) block.appendChild(partPicker(c));

  if (mine) {
    const back = el('button', 'mini-btn decomp-btn', '用回拆字库');
    back.type = 'button';
    back.title = '删掉手写拆法，回到拆字库的拆法';
    back.addEventListener('click', () => changeDecomp(c, `「${c.char}」已用回拆字库的拆法`, () => {
      Studio.clearManualParts(work, c.id);
    }));
    block.appendChild(back);
  }

  if (!vs.length && !mine) {
    block.appendChild(el('p', 'cc-note',
      '拆字库未收录这个字 —— 在末尾的输入框里写它由哪些部件组成，或点「选部件」从字根里挑。'));
  }
  return block;
}

/**
 * 每一行的末尾输入框：往这个字的拆法里**追加**部件，写完回车立刻生效、输入框保留焦点可以接着写。
 * 不做草稿态 —— 所见即所得，也不用多点一次「自定义拆法」再「保存」。
 */
function addPartInput(c) {
  const input = el('input', 'decomp-input de-add');
  input.type = 'text';
  input.placeholder = '+ 再写一个';
  input.title = '写部件后回车即可添加，可以连着写（「木口」或「木 口」都行）';
  input.setAttribute('aria-label', `给「${c.char}」添加部件`);

  const submit = () => {
    const parts = Studio.parseParts(input.value);
    if (!parts.length) return;
    input.value = '';
    appendManualParts(c, parts);
    focusAddInput(c);                        // 焦点留在输入框，接着写下一个
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; input.blur(); }
  });
  return input;
}

/** 往这个字的手写拆法尾部追加部件（打字回车、点选字根走同一条路） */
function appendManualParts(c, parts) {
  const cur = (work.manual && work.manual[c.id]) || [];
  const room = Studio.MAX_PARTS - cur.length;
  if (room <= 0) {
    setStatus(`「${c.char}」最多 ${Studio.MAX_PARTS} 个部件 —— 先 ✕ 掉一个再加。`, false);
    return false;
  }
  const add = parts.slice(0, room);
  changeDecomp(c, `「${c.char}」的拆法已改为：${cur.concat(add).join(' + ')}`, () => {
    Studio.setManualParts(work, c.id, cur.concat(add));
  });
  if (parts.length > room) setStatus(`最多 ${Studio.MAX_PARTS} 个部件，多写的没加进去。`, false);
  return true;
}

function focusAddInput(c) {
  const inp = DOM.partsWrap.querySelector(`.part-block[data-char-id="${c.id}"] .decomp-input`);
  if (inp) focusSoft(inp);
}

/**
 * 点选部件面板：本谜面已经拆出来的部件（跨字复用最常需要）+ 拆字库里最常用的字根。
 * 点一下就直接加进这个字的拆法，面板保持展开 —— 可以连着点。
 */
function partPicker(c) {
  const wrap = el('div', 'de-picker');
  const mine = new Set((work.manual && work.manual[c.id]) || []);

  const local = [];
  const seen = new Set();
  for (const p of work.parts) if (!seen.has(p.glyph)) { seen.add(p.glyph); local.push(p.glyph); }
  for (const ch of work.chars) if (ch.role === 'zi' && !seen.has(ch.char)) { seen.add(ch.char); local.push(ch.char); }

  if (local.length) {
    wrap.appendChild(el('div', 'de-picker-title', '本谜面已有的'));
    wrap.appendChild(pickerRow(c, local, mine));
  }
  wrap.appendChild(el('div', 'de-picker-title', '常用部件'));
  wrap.appendChild(pickerRow(c, Studio.commonParts(72), mine));
  return wrap;
}

function pickerRow(c, glyphs, mine) {
  const row = el('div', 'de-picker-row');
  for (const g of glyphs) {
    const b = el('button', 'de-pick' + (mine.has(g) ? ' done' : ''), esc(g));
    b.type = 'button';
    b.dataset.pick = g;
    b.title = mine.has(g) ? `「${g}」已经在这个字的拆法里了（再点一次可再加一个）` : `把「${g}」加到「${c.char}」的部件里`;
    b.addEventListener('click', () => appendManualParts(c, [g]));
    row.appendChild(b);
  }
  return row;
}

/** 撤销我手写加的某一块（拆字库摊出来的部件没有 ✕，因为那不是我加的） */
function removeManualPart(c, glyph) {
  const cur = ((work.manual && work.manual[c.id]) || []).slice();
  const i = cur.indexOf(glyph);
  if (i < 0) return;
  cur.splice(i, 1);
  changeDecomp(c, cur.length
    ? `「${c.char}」的拆法已改为：${cur.join(' + ')}`
    : `「${c.char}」已用回拆字库的拆法`, () => {
    Studio.setManualParts(work, c.id, cur);   // 空数组 = 删掉手写拆法
  });
}

/**
 * 改拆法（切换变体 / 手写 / 用回拆字库）都走这里。
 * 已经用这个字的部件拼过的合并会**级联清掉** —— 否则部件实例还在、字形却换了，
 * 动画里"十 + 口 = 古"会变成"木 + 口 = 古"这种破图。
 */
function changeDecomp(c, note, apply) {
  const affected = mergesUsingChar(work, c.id);
  apply();
  for (const id of affected) Studio.deleteMergeCascade(work, id);
  S.selected = [];
  const valid = new Set(Studio.mergableItems(work).map(x => x.id));
  S.pairPick = S.pairPick && valid.has(S.pairPick) ? S.pairPick : null;
  renderWorkspace();
  renderPairPanel();
  invalidateTimeline();
  renderPreview();
  const base = note + '。';
  setStatus(affected.length ? `${base}同时清掉了用到这个字的 ${affected.length} 次合并。` : base, true);
}

function makeSelChip(id, glyph, kind, used, onRemove) {
  const chip = el('button', 'sel-chip' + (used ? ' used' : '') + (S.selected.includes(id) ? ' sel' : '') + (onRemove ? ' mine' : ''));
  chip.type = 'button';
  chip.dataset.chipId = id;
  chip.innerHTML = `<span class="chip-glyph">${esc(glyph)}</span><span class="chip-kind">${used ? '已用' : kind}</span>`;
  chip.dataset.baseTitle = used ? '这个零件已经在之前的合并里用掉了' : `选中「${glyph}」（${kind}）`;
  chip.title = chip.dataset.baseTitle;
  chip.setAttribute('aria-pressed', S.selected.includes(id) ? 'true' : 'false');
  if (used) chip.disabled = true;
  chip.addEventListener('click', () => { if (!used) toggleSelect(id); });
  if (onRemove) {
    // chip 本身是 button（点它=选中），里面不能再套 button，所以 ✕ 用 span + role=button
    const x = el('span', 'de-x' + (used ? ' off' : ''), '✕');
    x.setAttribute('role', 'button');
    x.tabIndex = 0;
    x.title = used ? '这个部件已经在合并里用掉了，先删掉那次合并才能去掉它' : '去掉这个手写部件';
    x.setAttribute('aria-label', `去掉部件 ${glyph}`);
    const fire = e => { e.stopPropagation(); e.preventDefault(); if (!used) onRemove(); };
    x.addEventListener('click', fire);
    x.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fire(e); });
    chip.appendChild(x);
  }
  return chip;
}

function toggleSelect(id) {
  const i = S.selected.indexOf(id);
  if (i >= 0) S.selected.splice(i, 1);
  else {
    if (S.selected.length >= 6) S.selected.shift(); // 上限 6，超出时替换最早选的
    S.selected.push(id);
  }
  // 只同步选中态 class，不重建池子：节点保持稳定（键盘焦点不丢），
  // 也避免字素多时每次点击都重排整池（16 字素时曾达 ~57ms）
  syncSelChips();
  renderTray();
}

/** 把池子里所有零件的选中态对齐到 S.selected（不重建 DOM） */
function syncSelChips() {
  for (const chip of DOM.partsWrap.querySelectorAll('.sel-chip')) {
    const on = S.selected.includes(chip.dataset.chipId);
    chip.classList.toggle('sel', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.title = chip.disabled
      ? '这个零件已经在之前的合并里用掉了'
      : (on ? `取消选中「${chip.querySelector('.chip-glyph').textContent}」` : chip.dataset.baseTitle || chip.title);
  }
}

function updateSelStatus() {
  if (!work) { DOM.selStatus.textContent = ''; DOM.selStatus.classList.add('empty'); return; }
  const names = S.selected.map(id => Studio.itemLabel(work, id));
  DOM.selStatus.textContent = S.selected.length
    ? `已选 ${names.join(' + ')}`
    : '尚未选择';
  DOM.selStatus.classList.toggle('empty', !S.selected.length);
}

/** 待合并托盘：跨字挑选时始终停在字块下方，候选/结果输入都在这里 */
function renderTray() {
  const n = S.selected.length;
  DOM.pendingWrap.classList.toggle('show', n >= 1);
  updateSelStatus();
  if (!n || !work) return;
  const sel = S.selected.map(id => Studio.itemLabel(work, id));
  const cand = Studio.findCandidates(sel.map(l => l.replace(/\(.*\)$/, '')));
  DOM.mergeExpr.textContent = `${sel.join(' + ')} = ?`;
  DOM.candidateWrap.innerHTML = '';
  const show = [...cand.exact, ...cand.superset.filter(g => !cand.exact.includes(g))];
  if (n === 1) {
    // 单选：对象自身即合成结果（直接提取）。默认结果字形 = 对象字形。
    const self = sel[0].replace(/\(.*\)$/, '');
    if (!DOM.resultInput.value.trim()) DOM.resultInput.value = self;
    const chip = el('button', 'cand-chip exact', esc('≡ ' + self));
    chip.type = 'button';
    chip.title = '直接提取该字素为合成结果';
    chip.addEventListener('click', () => { DOM.resultInput.value = self; DOM.confirmMergeBtn.disabled = false; });
    DOM.candidateWrap.appendChild(chip);
  }
  if (show.length) {
    for (const g of show.slice(0, 12)) {
      const exact = cand.exact.includes(g);
      const chip = el('button', 'cand-chip' + (exact ? ' exact' : ''), esc(g));
      chip.type = 'button';
      chip.title = exact ? '恰好由所选部件合成（含笔画层等价）' : '包含所选部件（不完全等价）';
      chip.addEventListener('click', () => { DOM.resultInput.value = g; DOM.confirmMergeBtn.disabled = false; });
      DOM.candidateWrap.appendChild(chip);
    }
  } else {
    DOM.candidateWrap.appendChild(el('span', 'hint', '拆字库中没有明显候选，请在下面手动输入合成结果字。'));
  }
  DOM.confirmMergeBtn.disabled = !DOM.resultInput.value.trim();
}

/** 改动某个字的身份：会清掉用到它的合并，避免"部件凭空出现"的破图 */
function mergesUsingChar(st, charId) {
  return st.merges
    .filter(m => m.partIds.some(id => id === charId || id.startsWith(charId + '-p')))
    .map(m => m.id);
}

function assignRole(role) {
  if (!work) {
    setStatus('还没有谜面。先在第 ① 步载入一句。', false, { label: '去 ① 载入谜面', fn: () => gotoStep(1) });
    return;
  }
  const c = work.chars.find(x => x.id === S.openCharId);
  if (!c) { setStatus('先点一个谜面字，再选身份。', false); return; }
  if (c.role === role) return;

  const affected = mergesUsingChar(work, c.id);
  Studio.assignRole(work, c.id, role);
  for (const id of affected) Studio.deleteMergeCascade(work, id);
  S.selected = [];
  renderWorkspace();
  renderPairPanel();
  invalidateTimeline();
  const base = `「${c.char}」已设为「${ROLE[role].label}」。`;
  setStatus(affected.length ? `${base}同时清掉了用到这个字的 ${affected.length} 次合并。` : base, true,
    role === 'zi' ? null : { label: '改回「字素」', fn: () => assignRole('zi') });
}

/** 把所有字恢复成默认的「字素」（实验之后一键回到初始） */
function markAllZi() {
  if (!work) {
    setStatus('还没有谜面。先在第 ① 步载入一句。', false, { label: '去 ① 载入谜面', fn: () => gotoStep(1) });
    return;
  }
  for (const c of work.chars) Studio.assignRole(work, c.id, 'zi');
  S.selected = [];
  renderWorkspace();
  setStatus(`已把 ${work.chars.length} 个字全部设为「字素」。`, true);
}

function confirmMerge() {
  if (!work) return;
  const glyph = DOM.resultInput.value.trim();
  if (!glyph) {
    setStatus('请先在上面的候选里点一个，或手动输入合成结果字。', false);
    DOM.resultInput.focus();
    return;
  }
  const names = S.selected.map(id => Studio.itemLabel(work, id));
  const res = Studio.confirmMerge(work, S.selected, glyph);
  if (!res.ok) { setStatus(res.reason, false); return; }
  S.selected = [];
  DOM.resultInput.value = '';
  renderWorkspace();
  renderPairPanel();
  renderPreview();
  setStatus(`已合并：${names.join(' + ')} → ${glyph}。它会直接落在谜底对应的位置上。`, true,
    { label: '去 ③ 填谜底', fn: () => gotoStep(3) });
  invalidateTimeline();
}

function cancelMerge() {
  S.selected = [];
  DOM.resultInput.value = '';
  syncSelChips();
  renderTray();
}

function renderMerges() {
  DOM.mergesWrap.innerHTML = '';
  if (!work) return;
  if (!work.merges.length) {
    DOM.mergesWrap.appendChild(el('span', 'merges-empty', '还没有合并。在字素池里点零件（可以跨字混选），凑齐后点「合并」。'));
    renderPairPanel();
    renderFlow();
    return;
  }
  for (const m of work.merges) {
    const item = el('div', 'merge-item');
    const names = (m.partGlyphs || []).join(' + '); // 快照名称，用掉的部件仍可读
    item.appendChild(el('span', null, `${names} → <b>${esc(m.glyph)}</b>`));
    const del = el('button', 'mini-btn', '删除');
    del.type = 'button';
    del.title = '删除这次合并（依赖它的合并会一起删掉）';
    del.addEventListener('click', () => {
      Studio.deleteMergeCascade(work, m.id);
      const valid = new Set(Studio.mergableItems(work).map(x => x.id));
      S.selected = S.selected.filter(x => valid.has(x)); // 清理悬空选中
      if (S.pairPick && !valid.has(S.pairPick)) S.pairPick = null;
      renderWorkspace();
      renderPairPanel();
      invalidateTimeline();
      renderPreview();
      setStatus('已删除这次合并（依赖它的合并也一并删除）。');
    });
    item.appendChild(del);
    DOM.mergesWrap.appendChild(item);
  }
  renderPairPanel();
  renderFlow();
}

// ---------------------------------------------------------------- 第三步：谜底配对
// ---------------------------------------------------------------- 第三步：谜底配对
// 多段谜底：每个谜底字由一段合成承担（木+口=杏、艹+化=花 → 「杏花」）。
// 看板一行一次对应：左 = 拼出来的字，箭头 → 右 = 它落到的谜底位。
// 对应关系用位置表达，不靠小字说明；点左侧方块把结果"拿起"，再点任一谜底位即可换配。
// 只列"活着的"合成结果 —— 被后续合并吸收的中间产物（木 被 杏 吃掉）不能承担谜底，
// 否则末尾会出现"答案字凭空消失"。
function renderPairPanel() {
  const show = work && work.merges.length && work.answer;
  DOM.pairPanel.classList.toggle('hidden', !show);
  if (!show) { S.pairPick = null; return; }

  const pairs = Studio.effectivePairs(work);
  const bySlot = {};
  for (const id in pairs) bySlot[pairs[id]] = id;
  const live = Studio.liveMerges(work);
  if (S.pairPick && !live.some(m => m.id === S.pairPick)) S.pairPick = null;
  // 空闲的（还没连上的）结果：决定空位上该写"点下面选一个"还是"没有空闲的"
  const rest = live.filter(m => pairs[m.id] == null);

  /**
   * 把手上拿起的结果连到第 i 个谜底位（没拿起就提醒，不静默失败）。
   * 拿起的结果原本就在某一行时，被它顶下来的那个补回原位 —— 也就是"两个位置互换"，
   * 这样"杏该在第 2 位、花该在第 1 位"只要点两下，不必先解除再一个个连。
   */
  const attach = (i, ch) => {
    if (!S.pairPick) {
      setStatus(rest.length
        ? '先点下面「还没连上的合成结果」里的一个，再点它要落到的谜底位。'
        : `现在没有空闲的合成结果：把已经连上的结果拿过来换，或者就让「${ch}」在动画末尾直接弹出。`, false);
      return;
    }
    const from = S.pairPick;
    const fromSlot = pairs[from] != null ? pairs[from] : null;
    const prev = bySlot[i];
    Studio.pairResult(work, from, i);
    if (prev && prev !== from && fromSlot != null) Studio.pairResult(work, prev, fromSlot);
    S.pairPick = null;
    setStatus(prev && prev !== from
      ? `已互换：${from} → 谜底第 ${i + 1} 字「${ch}」，${prev} 回到第 ${fromSlot + 1} 位。`
      : `已配对：${from}（${Studio.itemLabel(work, from)}）→ 谜底第 ${i + 1} 字「${ch}」。`);
    renderPairPanel();
    invalidateTimeline();
  };

  // ---- 看板：按槽位顺序，一行一次对应 ----
  DOM.pairBoard.innerHTML = '';
  [...work.answer].forEach((ch, i) => {
    const rid = bySlot[i];
    const rm = rid ? live.find(m => m.id === rid) : null;
    const row = el('div', 'pair-row ' + (rm ? 'matched' : 'unmatched') + (S.pairPick ? ' aiming' : ''));
    row.dataset.slot = i;
    row.setAttribute('aria-label', rm
      ? `谜底第 ${i + 1} 字「${ch}」，由合成结果 ${rm.id}「${rm.glyph}」承担`
      : `谜底第 ${i + 1} 字「${ch}」，还没有合成结果承担，动画末尾会直接弹出`);

    // 左：承担它的合成结果 / 或一个"连到这里"的空位
    const wrap = el('div', 'pair-src-wrap');
    const src = el('button', 'pair-src' + (rm ? '' : ' empty') + (rm && S.pairPick === rm.id ? ' pick' : ''));
    src.type = 'button';
    src.dataset.slot = i;
    if (rm) src.dataset.mergeId = rm.id;   // 供脚本/测试读取"这一行由谁承担" 
    if (rm) {
      // 显示"这一笔是怎么拼出来的"（木 + 口），比编号更能说明它凭什么落在这一位
      const parts = (rm.partGlyphs || []).join(' + ') || rm.id;
      src.innerHTML = `<span class="glyph">${esc(rm.glyph)}</span><span class="meta">${esc(parts)}</span>`;
      src.title = `${rm.id}：${parts} → ${rm.glyph}。点一下拿起它，再点别的谜底位就能换配`;
      src.setAttribute('aria-pressed', S.pairPick === rm.id ? 'true' : 'false');
      src.addEventListener('click', () => {
        // 手上已经拿着另一个结果 → 这一下是"把它放到这一行"（两个结果互换位置），
        // 否则"拿起/放回"更符合预期
        if (S.pairPick && S.pairPick !== rm.id) { attach(i, ch); return; }
        S.pairPick = S.pairPick === rm.id ? null : rm.id;
        setStatus(S.pairPick
          ? `已拿起 ${rm.id}（${rm.glyph}）：点它要落到的谜底位即可换配。`
          : '已放回。');
        renderPairPanel();
      });
    } else {
      const room = rest.length > 0;
      src.innerHTML = `<span class="glyph dim" aria-hidden="true">${room ? '＋' : '—'}</span><span class="meta">${
        S.pairPick ? '连到这里' : (room ? '点下面选一个合成结果' : '没有空闲的合成结果，末尾弹出')}</span>`;
      src.title = S.pairPick
        ? `把 ${S.pairPick} 连到谜底「${ch}」`
        : (room ? '先点下面一个合成结果，再点这里连上' : `没有多余的合成结果产出「${ch}」，动画末尾会让它直接弹出`);
      src.addEventListener('click', () => attach(i, ch));
    }
    wrap.appendChild(src);
    if (rm) {
      const x = el('button', 'pair-x', '✕');
      x.type = 'button';
      x.title = '解除配对：这个谜底字改为动画末尾直接弹出';
      x.setAttribute('aria-label', `解除谜底第 ${i + 1} 字「${ch}」的配对`);
      x.addEventListener('click', () => {
        Studio.unpairResult(work, rm.id);
        S.pairPick = null;
        setStatus(`已解除谜底「${ch}」的配对：动画里它会直接弹出，不会再自动连回去。`);
        renderPairPanel();
        invalidateTimeline();
      });
      wrap.appendChild(x);
    }
    row.appendChild(wrap);

    row.appendChild(el('span', 'pair-link'));   // 连接线：实线=已配对，虚线=没有来源

    // 右：谜底位（顺序即谜底顺序）
    const slot = el('button', 'pair-slot' + (rm ? ' filled' : ''));
    slot.type = 'button';
    slot.innerHTML = `<span class="idx">谜底第 ${i + 1} 字</span><span class="glyph">${esc(ch)}</span>`;
    slot.title = rm ? `由 ${rm.id} 承担（点一下把手上拿起的合成结果换到这里）` : '还没有合成结果承担它';
    slot.addEventListener('click', () => attach(i, ch));
    row.appendChild(slot);
    DOM.pairBoard.appendChild(row);
  });

  // ---- 还没连上的合成结果（拿起 → 点上面任一谜底位）----
  DOM.pairRest.hidden = !rest.length;
  DOM.pairLabel.textContent = rest.length
    ? `还没连上的合成结果 ${rest.length} 个 · 点一下拿起，再点上面它要落到的谜底位`
    : '';
  DOM.pairResults.innerHTML = '';
  for (const m of rest) {
    const chip = el('button', 'pair-chip' + (S.pairPick === m.id ? ' pick' : ''));
    chip.type = 'button';
    chip.dataset.chipId = m.id;
    const parts = (m.partGlyphs || []).join(' + ') || m.id;
    chip.innerHTML = `<span class="glyph">${esc(m.glyph)}</span><span class="meta">${esc(parts)}</span>`;
    chip.title = `拿起 ${m.id}（${parts} → ${m.glyph}），再点它对应的谜底位`;
    chip.setAttribute('aria-pressed', S.pairPick === m.id ? 'true' : 'false');
    chip.addEventListener('click', () => {
      S.pairPick = S.pairPick === m.id ? null : m.id;
      setStatus(S.pairPick ? `已拿起 ${m.id}（${m.glyph}）：点上面它要落到的谜底位。` : '已放回。');
      renderPairPanel();
    });
    DOM.pairResults.appendChild(chip);
  }
}

// ---------------------------------------------------------------- 第四步：时间轴
function buildTimeline() {
  if (!work || !work.chars.length) {
    setStatus('还没有谜面。先在第 ① 步载入一句。', false, { label: '去 ① 载入谜面', fn: () => gotoStep(1) });
    return;
  }
  if (!work.answer) {
    setStatus('请先填写谜底（至少 1 个字）—— 它在第 ① 步，谜面已经载入，填完不用重新载入。', false,
      { label: '去 ① 填谜底', fn: () => { gotoStep(1); focusSoft(DOM.answerInput); } });
    return;
  }
  S.timeline = Studio.buildTimelineFromState(work, CONFIG);
  // 调试/端到端测试钩子：把最近一次生成的时间轴挂到 window，便于断言场景序列
  // （动画流程本身就是产品契约，UI 测试需要能看到它）
  window.__dshTimeline = S.timeline;
  // 画布高度由内容（谜面/行2 换行行数）算出：单行场景仍为 210，长谜面自动加高
  if (S.timeline.H) CONFIG.H = S.timeline.H;
  applyStageAspect();
  updateSizeHint();
  DOM.slider.max = S.timeline.duration;
  DOM.durLabel.textContent = S.timeline.duration.toFixed(1) + 's';
  S.t = 0;
  updateTransport();
  renderPreview();
  renderFlow();
  const r = S.timeline.rows;
  const rowInfo = r && (r.mian > 1 || r.second > 1) ? `（谜面 ${r.mian} 行${r.second > 1 ? ` / 结果 ${r.second} 行` : ''}` + (r.shrunk ? ` / 字号 ${r.charFS}` : '') + '）' : '';
  setStatus(`动画已生成：${S.timeline.scenes.length} 个场景 / ${S.timeline.duration.toFixed(1)} 秒 / 画布 ${CONFIG.W}×${CONFIG.H}${rowInfo}。点「播放」预览，满意后导出。`, true,
    { label: '预览播放', fn: () => { gotoStep(4); if (!S.playing) togglePlay(); } });
}

/** 预览舞台与导出画布同比例（含长谜面换行后的动态高度） */
function applyStageAspect() {
  if (!DOM.stage) return;
  DOM.stage.style.aspectRatio = `${CONFIG.W} / ${CONFIG.H}`;
}

// 已有动画时，编辑任一步骤自动重建；谜底清空则撤回动画
function invalidateTimeline() {
  if (!S.timeline) { renderFlow(); return; }
  if (work && work.chars.length && work.answer) buildTimeline();
  else {
    S.timeline = null;
    S.playing = false;
    updateTransport();
    DOM.slider.max = 0;
    clearStage();
    renderFlow();
  }
}

// ---------------------------------------------------------------- 预览渲染
function renderPreview() {
  if (!S.timeline) { clearStage(); return; }
  const fs = S.timeline.stateAt(S.t);
  DOM.stageSvg.innerHTML = svgForState(fs, '100%', '100%', CONFIG);
  DOM.stageEmpty.hidden = true;
  // 播放中也刷新进度条与时间读数（拖动进度条会先暂停，不会互相打架）
  DOM.slider.value = Math.min(S.t, S.timeline.duration);
  DOM.timeLabel.textContent = S.t.toFixed(2) + 's';
}

function clearStage() {
  DOM.stageSvg.innerHTML = '';
  DOM.stageEmpty.hidden = false;
  DOM.timeLabel.textContent = '0.00s';
  DOM.durLabel.textContent = '—';
}

// ---------------------------------------------------------------- 示例
/** 一键载入经典离合谜：「十八口」→ 十+八=木 → 木+口=杏 */
function loadDemo() {
  DOM.answerInput.value = ''; // 清掉 ① 里残留的谜底，示例自带自己的谜底
  DOM.inputMian.value = '十八口';
  startMian();
  for (const c of work.chars) Studio.assignRole(work, c.id, 'zi');
  renderWorkspace();
  S.selected = ['m0', 'm1'];        // 十 + 八
  DOM.resultInput.value = '木';
  confirmMerge();
  S.selected = ['r0', 'm2'];        // 木 + 口
  DOM.resultInput.value = '杏';
  confirmMerge();
  setAnswer('杏');
  buildTimeline();
  setStatus('示例已载入：十+八=木，木+口=杏。点「播放」预览，或直接「导出」。', true,
    { label: '看第 ② 步怎么标的', fn: () => gotoStep(2) });
}

/**
 * 写入谜底。示例载入时也要走这里 —— 否则配对面板拿不到 answer，
 * 会出现"示例跑通了但配对面板不显示"的假象（原实现的隐藏 bug）。
 */
function setAnswer(text) {
  DOM.answerInput.value = text;
  if (!work) return;
  work.answer = String(text || '').trim();
  Studio.prunePairs(work);
  renderPairPanel();
}

// ---------------------------------------------------------------- 播放控制
function updateTransport() {
  DOM.playLabel.textContent = S.playing ? '暂停' : '播放';
  DOM.btnPlayIcon.innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;
}

function togglePlay() {
  if (!S.timeline) {
    setStatus('还没有动画。先在 ④ 填写谜底并点「生成动画」。', false, { label: '去 ④ 生成动画', fn: () => gotoStep(4) });
    return;
  }
  S.playing = !S.playing;
  updateTransport();
  if (S.playing) {
    if (S.t >= S.timeline.duration - 1e-6) S.t = 0; // 播完再点播放则从头开始
    requestAnimationFrame(loop);
  }
}

function loop() {
  if (!S.playing) return;
  S.t += 1 / 60;
  if (S.t >= S.timeline.duration) {
    if (S.loop) S.t = 0;
    else { S.t = S.timeline.duration; S.playing = false; updateTransport(); }
  }
  renderPreview();
  requestAnimationFrame(loop);
}

function seek(t) {
  if (!S.timeline) return;
  S.t = Math.max(0, Math.min(S.timeline.duration, t));
  renderPreview();
}
function stepFrames(d) {
  if (!S.timeline) {
    setStatus('还没有动画。先在 ④ 填写谜底并点「生成动画」。', false, { label: '去 ④ 生成动画', fn: () => gotoStep(4) });
    return;
  }
  seek(S.t + d / S.fps);
}

// ---------------------------------------------------------------- 导出
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('SVG 帧渲染失败'));
    im.src = src;
  });
}
const tickYield = () => new Promise(r => setTimeout(r, 0));

async function exportAPNG() {
  if (!S.timeline) { needTimeline(); return; }
  if (typeof CompressionStream === 'undefined') {
    setStatus('当前浏览器不支持 CompressionStream（需 Chrome 80+ / Firefox 113+ / Safari 16.4+），请改用 GIF 导出或升级浏览器。', false);
    return;
  }
  const fps = +DOM.fpsSel.value;
  const scale = +DOM.scaleSel.value;
  const totalFrames = Math.max(2, Math.ceil(S.timeline.duration * fps));
  const W = CONFIG.W * scale, H = CONFIG.H * scale;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');

  const enc = new ApngEncoder(W, H, totalFrames, S.loop ? 0 : 1, fps);

  DOM.btnExport.disabled = true;
  DOM.exportProgress.style.width = '0%';
  DOM.exportStatus.textContent = `渲染 ${totalFrames} 帧…`;
  try {
    for (let f = 0; f < totalFrames; f++) {
      const fs = S.timeline.stateAt(f / fps);
      const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgForState(fs, W, H, CONFIG)));
      g.clearRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      await enc.addFrame(px);
      DOM.exportProgress.style.width = (((f + 1) / totalFrames) * 100).toFixed(1) + '%';
      DOM.exportStatus.textContent = `渲染中 ${f + 1}/${totalFrames}`;
      await tickYield();
    }
    const bytes = await enc.finish();
    download(new Blob([bytes], { type: 'image/apng' }),
      `${work.answer || '字谜'}-离合动画-${W}x${H}-${fps}fps.apng`);
    DOM.exportStatus.textContent = `✓ 完成：${totalFrames} 帧 / ${(bytes.length / 1024).toFixed(0)} KB / ${W}×${H} APNG（真彩色 + 256 级透明，边缘最平滑）`;
    setStatus('APNG 已导出到下载目录，可直接发公众号或聊天工具。', true);
  } catch (err) {
    DOM.exportStatus.textContent = '✗ 导出失败: ' + err.message;
    setStatus('APNG 导出失败：' + err.message, false);
    console.error(err);
  } finally {
    DOM.btnExport.disabled = false;
  }
}

async function exportGIF() {
  if (!S.timeline) { needTimeline(); return; }
  if (typeof GifEncoder === 'undefined') {
    setStatus('GIF 编码器未加载（gif.js），请刷新页面重试。', false);
    return;
  }
  const fps = +DOM.fpsSel.value;
  const scale = +DOM.scaleSel.value;
  const totalFrames = Math.max(2, Math.ceil(S.timeline.duration * fps));
  const W = CONFIG.W * scale, H = CONFIG.H * scale;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');

  const enc = new GifEncoder(W, H, totalFrames, S.loop ? 0 : 1, Math.min(100, Math.max(1, Math.round(fps))));

  DOM.btnExport.disabled = true;
  DOM.exportProgress.style.width = '0%';
  DOM.exportStatus.textContent = `渲染 ${totalFrames} 帧…`;
  try {
    for (let f = 0; f < totalFrames; f++) {
      const fs = S.timeline.stateAt(f / fps);
      const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgForState(fs, W, H, CONFIG)));
      g.clearRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      enc.addFrame(g.getImageData(0, 0, W, H).data);
      DOM.exportProgress.style.width = (((f + 1) / totalFrames) * 100).toFixed(1) + '%';
      DOM.exportStatus.textContent = `渲染中 ${f + 1}/${totalFrames}`;
      if (f % 4 === 3) await tickYield();
    }
    const bytes = enc.finish();
    download(new Blob([bytes], { type: 'image/gif' }),
      `${work.answer || '字谜'}-离合动画-${W}x${H}-${fps}fps.gif`);
    DOM.exportStatus.textContent = `✓ 完成：${totalFrames} 帧 / ${(bytes.length / 1024).toFixed(0)} KB / ${W}×${H} GIF（1 位透明 + 256 色，通用性最好）`;
    setStatus('GIF 已导出到下载目录，可直接发公众号或聊天工具。', true);
  } catch (err) {
    DOM.exportStatus.textContent = '✗ 导出失败: ' + err.message;
    setStatus('GIF 导出失败：' + err.message, false);
    console.error(err);
  } finally {
    DOM.btnExport.disabled = false;
  }
}

/** SVG 导出（当前画面，矢量） */
function exportSVG() {
  if (!S.timeline) { needTimeline(); return; }
  const scale = +DOM.scaleSel.value;
  const W = CONFIG.W * scale, H = CONFIG.H * scale;
  const fs = S.timeline.stateAt(S.t);
  const svg = svgForState(fs, W, H, CONFIG);
  download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    `${work.answer || '字谜'}-${W}x${H}-${S.t.toFixed(2)}s.svg`);
  DOM.exportStatus.textContent = `✓ 已导出当前画面 SVG（${W}×${H}，${S.t.toFixed(2)}s，矢量可无损放大）`;
  setStatus('SVG 已导出（当前这一帧的矢量静图）。', true);
}

function needTimeline() {
  setStatus('还没有动画。先在 ④ 填写谜底并点「生成动画」。', false, { label: '去 ④ 生成动画', fn: () => gotoStep(4) });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportMedia() {
  const fmt = DOM.fmtSel ? DOM.fmtSel.value : 'apng';
  if (fmt === 'gif') return exportGIF();
  if (fmt === 'svg') { exportSVG(); return; }
  return exportAPNG();
}

// ---------------------------------------------------------------- 使用说明面板
let helpReturnFocus = null;
function openHelp() {
  const a = document.activeElement;
  helpReturnFocus = a && a !== document.body ? a : DOM.btnHelp;
  DOM.helpOverlay.hidden = false;
  DOM.helpClose.focus();
}
function closeHelp() {
  DOM.helpOverlay.hidden = true;
  const back = helpReturnFocus && helpReturnFocus.focus ? helpReturnFocus : DOM.btnHelp;
  back.focus();
  helpReturnFocus = null;
}

// ---------------------------------------------------------------- 初始化
function updateSizeHint() {
  if (!DOM.sizeHint) return;
  const scale = +DOM.scaleSel.value || 1;
  DOM.sizeHint.textContent = `${CONFIG.W * scale}×${CONFIG.H * scale}`;
}
function init() {
  DOM.btnDemo.addEventListener('click', loadDemo);
  DOM.stageDemoBtn.addEventListener('click', loadDemo);
  DOM.btnMian.addEventListener('click', startMian);
  DOM.inputMian.addEventListener('keydown', e => { if (e.key === 'Enter') startMian(); });
  DOM.btnAllZi.addEventListener('click', markAllZi);
  DOM.confirmMergeBtn.addEventListener('click', confirmMerge);
  DOM.cancelMergeBtn.addEventListener('click', cancelMerge);
  DOM.resultInput.addEventListener('input', () => { DOM.confirmMergeBtn.disabled = !DOM.resultInput.value.trim(); });
  DOM.resultInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !DOM.confirmMergeBtn.disabled) confirmMerge(); });
  DOM.answerInput.addEventListener('input', () => {
    if (!work) return;
    work.answer = DOM.answerInput.value.trim();
    Studio.prunePairs(work); // 谜底缩短时清理失效配对
    renderPairPanel();
    renderAnswerLine();
    invalidateTimeline();
  });
  DOM.answerInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    // 谜面还没载入 -> Enter 等同于「载入」；已载入 -> 只是确认（值已由 input 同步），
    // 把焦点送到工作台。**不重载谜面**，免得手滑清掉已经做好的合并。
    if (!work) { startMian(); return; }
    gotoStep(2);
  });
  DOM.btnBuild.addEventListener('click', buildTimeline);
  DOM.btnGoExport.addEventListener('click', () => {
    scrollToEl(DOM.btnExport, 'center');
    focusSoft(DOM.btnExport);
  });

  DOM.btnPlay.addEventListener('click', togglePlay);
  DOM.btnRestart.addEventListener('click', () => seek(0));
  DOM.btnStepBack.addEventListener('click', () => stepFrames(-1));
  DOM.btnStepFwd.addEventListener('click', () => stepFrames(1));
  DOM.slider.addEventListener('input', () => { S.playing = false; updateTransport(); seek(+DOM.slider.value); });
  DOM.fpsSel.addEventListener('change', () => {
    S.fps = +DOM.fpsSel.value;
    DOM.exportStatus.textContent = '帧率越高越流畅、体积越大。公众号建议 12 fps。';
  });
  DOM.loopChk.addEventListener('change', () => { S.loop = DOM.loopChk.checked; });
  DOM.scaleSel.addEventListener('change', () => { S.scale = +DOM.scaleSel.value; updateSizeHint(); });
  DOM.fmtSel.addEventListener('change', () => {
    DOM.exportStatus.textContent = {
      gif: 'GIF：透明只有 1 位、颜色 256 色，但任何聊天工具和旧设备都能打开。',
      apng: 'APNG：真彩色 + 256 级透明，文字边缘最平滑，文件略大于 GIF。',
      svg: 'SVG：当前这一帧的矢量静图，可无损放大、方便二次编辑；不动。',
    }[DOM.fmtSel.value];
  });
  updateSizeHint();
  applyStageAspect();

  DOM.btnExport.addEventListener('click', exportMedia);

  // 使用说明面板：可跳过、可 Esc 关闭
  DOM.btnHelp.addEventListener('click', openHelp);
  DOM.helpClose.addEventListener('click', closeHelp);
  DOM.helpSkip.addEventListener('click', closeHelp);
  DOM.helpDemo.addEventListener('click', () => { closeHelp(); loadDemo(); });
  DOM.helpOverlay.addEventListener('click', e => { if (e.target === DOM.helpOverlay) closeHelp(); });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !DOM.helpOverlay.hidden) { closeHelp(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  });

  renderFlow();
  updateTransport(); // 首屏也要有播放图标（否则按钮只剩文字）
  setStatus('从第 ① 步开始：填一句谜面，然后点「载入」。想先看效果就点页头的示例。', true);
}

document.addEventListener('DOMContentLoaded', init);
