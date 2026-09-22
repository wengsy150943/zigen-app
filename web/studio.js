/**
 * studio.js — 制作流程的纯逻辑层（无 DOM，Node 可测）。
 *
 * 职责: 谜面状态、角色标注、部件拆解、合并记录、候选字查找、时间轴组装。
 * 依赖: 数据(浏览器全局 DECOMP_DATA 或 require ./data/decomp.js)、
 *       引擎(浏览器全局 Engine 或 require ./engine.js)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Studio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function decompData() {
    if (typeof DECOMP_DATA !== 'undefined') return DECOMP_DATA;
    return require('./data/decomp.js');
  }
  function engine() {
    if (typeof Engine !== 'undefined') return Engine;
    return require('./engine.js');
  }

  /**
   * 谜底色：**一个颜色贯穿到底**。
   * 合成结果落位（拼出谜底）、没有来源的谜底字兜底弹出、以及「谜底」行标签，统一用它。
   * 早先落位用青 `#0c8599`、兜底 reveal 用紫 `#9c36b5`，同一行会"先青后紫" ——
   * 观众看到的是"谜底变了个颜色"，而不是"答案来了"。
   */
  const ANSWER_COLOR = '#0c8599';

  // ---------- 倒排索引：部件 -> 包含它的字 ----------
  let _idx = null;
  function componentIndex() {
    if (_idx) return _idx;
    const D = decompData();
    const idx = new Map();
    for (const ch in D) {
      for (const v of D[ch]) {
        for (const g of v) {
          if (!idx.has(g)) idx.set(g, new Set());
          idx.get(g).add(ch);
        }
      }
    }
    _idx = idx;
    return idx;
  }

  /**
   * 常用部件（字根）：按"拆字库里有多少字用到它"降序取前 limit 个。
   * 手写拆法时不必凭空想字 —— 从这个列表点选即可，跟点选谜面里已有的部件是同一条路。
   */
  let _common = null;
  function commonParts(limit = 60) {
    if (!_common) {
      const idx = componentIndex();
      _common = [...idx.entries()]
        .filter(([g]) => [...g].length === 1)      // 只要单字部件
        .sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))
        .map(([g]) => g);
    }
    return _common.slice(0, limit);
  }

  // ---------- 笔画层展开（部件递归展开到不可再分，如 亻→丿丨、十→一丨） ----------
  const ATOM_DEPTH_LIMIT = 4;
  function atomsOf(g, depth = 0) {
    if (depth > ATOM_DEPTH_LIMIT) return [g];
    const vs = decompData()[g];
    if (!vs || !vs.length) return [g];
    const v = vs[0];
    if (!v || !v.length) return [g];
    const out = [];
    for (const m of v) out.push(...atomsOf(m, depth + 1));
    return out;
  }
  const atomKey = arr => [...arr].sort().join('');
  // 多重集包含：have 中每种原子数量 ≥ need
  function multisetContains(have, need) {
    if (need.length > have.length) return false;
    const h = {}, n = {};
    for (const x of have) h[x] = (h[x] || 0) + 1;
    for (const x of need) n[x] = (n[x] || 0) + 1;
    return Object.keys(n).every(k => (h[k] || 0) >= n[k]);
  }
  // 全字库的笔画展开索引：exactIdx: 展开key -> 字；supersets: 部件数≤4 的拆法展开明细
  let _atomIdx = null;
  function atomIndex() {
    if (_atomIdx) return _atomIdx;
    const D = decompData();
    const exactIdx = new Map();
    const supersets = [];
    for (const ch in D) {
      const vs = D[ch];
      const seenExact = new Set();
      for (const v of vs) {
        if (v.length > 4) continue;
        const arr = v.flatMap(m => atomsOf(m));
        const key = atomKey(arr);
        if (!seenExact.has(key)) {
          seenExact.add(key);
          if (!exactIdx.has(key)) exactIdx.set(key, []);
          exactIdx.get(key).push(ch);
        }
        supersets.push({ ch, partsLen: v.length, arr });
      }
    }
    _atomIdx = { exactIdx, supersets };
    return _atomIdx;
  }

  /**
   * 查找候选合成字（按多重集计数匹配，正确处理重复部件，如 人+人+人=众）。
   * exact:    某拆法恰好等于所选部件集合（数量一致）
   * superset: 某拆法包含所选各部件（数量 ≥ 所选）、长度 ≤ 4
   * 笔画等价：字面拆法匹配不到时，把所选部件展开到底层笔画后再匹配
   *           （如 亻+一=千：亻=丿丨、千=丿十=丿(一丨)，展开后笔画多重集一致）。
   */
  function findCandidates(glyphs) {
    const sets = glyphs.map(g => componentIndex().get(g));
    if (sets.some(s => !s)) return { exact: [], superset: [] };
    let common = new Set(sets[0]);
    for (const s of sets.slice(1)) common = new Set([...common].filter(c => s.has(c)));
    const need = {};
    for (const g of glyphs) need[g] = (need[g] || 0) + 1;
    const countOf = (arr) => { const c = {}; for (const g of arr) c[g] = (c[g] || 0) + 1; return c; };
    const exact = [], superset = [];
    for (const ch of common) {
      const vs = decompData()[ch] || [];
      for (const v of vs) {
        // 精确：部件多重集与所选完全一致
        const c = countOf(v);
        if (v.length === glyphs.length && Object.keys(need).every(g => c[g] === need[g])) { exact.push(ch); break; }
      }
      if (exact[exact.length - 1] === ch) continue;
      for (const v of vs) {
        // 超集：所选每种部件数量均满足，且总部件数 ≤ 4
        if (v.length <= 4 && v.length >= glyphs.length) {
          const c = countOf(v);
          if (Object.keys(need).every(g => (c[g] || 0) >= need[g])) { superset.push(ch); break; }
        }
      }
    }
    const res = { exact: [...new Set(exact)], superset: [...new Set(superset)].slice(0, 10) };

    // ---- 笔画层展开等价（补充，不覆盖字面结果） ----
    const selAtoms = glyphs.flatMap(g => atomsOf(g));
    if (selAtoms.length && glyphs.length >= 2 && selAtoms.length <= 8) {
      const selKey = atomKey(selAtoms);
      const ai = atomIndex();
      for (const ch of ai.exactIdx.get(selKey) || []) {
        if (!res.exact.includes(ch)) res.exact.push(ch); // 展开后完全等价
      }
      if (res.superset.length < 10) {
        const more = [];
        for (const it of ai.supersets) {
          if (it.partsLen < glyphs.length) continue;
          if (it.arr.length < selAtoms.length) continue;
          if (multisetContains(it.arr, selAtoms) && !res.exact.includes(it.ch) && !res.superset.includes(it.ch)) more.push(it.ch);
          if (more.length >= 10) break;
        }
        res.superset.push(...more.slice(0, 10 - res.superset.length));
      }
    }
    return res;
  }

  // ---------- 状态 ----------
  function createState(text) {
    return {
      mianText: text,
      chars: [...text].map((ch, i) => ({ id: 'm' + i, char: ch, role: 'none' })),
      parts: [],
      merges: [],
      mergeSeq: 0,
      answer: '',
      pairs: {},        // 合成结果 id -> 谜底字槽位下标（允许同一槽位挂多个 id：双扣。空时走自动配对）
      pairTouched: false, // 用户是否手动改过配对（改为 true 后不再自动配对）
      unpaired: {},     // 合成结果 id -> true：用户手动"解除"过它，不再自动补位
      manual: {},       // 字 id -> [部件字形…]：用户手写的拆法（拆字库没收录或拆得不对时用）
    };
  }

  /** 一个字的部件实例上限（与 -p0..-p7 的编号空间一致） */
  const MAX_PARTS = 8;

  /**
   * 一个字的全部可选拆法（每个拆法 = 部件字形数组）。
   * 手写的拆法排在最前面 —— 用户自己写的显然优先于拆字库；
   * 拆字库里原来那几种仍留在列表里，随时能切回去（这就是"改错了不用重来"）。
   */
  function variantsOf(st, charId) {
    const c = st.chars.find(x => x.id === charId);
    if (!c) return [];
    const lib = decompData()[c.char] || [];
    const mine = st.manual && st.manual[charId];
    return mine && mine.length ? [mine, ...lib] : lib;
  }

  /**
   * 规范手写拆法：允许"木 口""木、口""木口"等写法；**不去重**（林 = 木+木 是两个部件实例）、限长。
   * 分隔符与连写混用时同样按单字拆：「木口 火」= 木/口/火 —— 一个部件 = 一个字形，
   * 这条规则不能"全连写时生效、带分隔符时失效"（旧实现会把「木口」当成一个部件收进去）。
   */
  function parseParts(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return [];
    const out = [];
    for (const chunk of raw.split(/[\s,，、;；+·|/-]+/)) {
      for (const g of chunk) {           // 逐码点展开，多字节字形（如 𠮷）也算一块
        if (!g) continue;
        out.push(g);
        if (out.length >= MAX_PARTS) return out;
      }
    }
    return out;
  }

  /**
   * 一个字摊在字素池里的全部部件 —— **不区分拆法**：手写的那条 + 拆字库的每种拆法
   * 一次性全部列出，点哪块都行（省掉"先选拆法、再挑部件"这一步）。
   *
   * 去重规则：同一条拆法内部**不去重**（手写的 林 = 木 + 木 仍是两块），
   * 跨拆法之间同字形只留一块（「十」在两种拆法里都有 → 池子里只有一块十）。
   * 手写那条排在 variantsOf 的第一位，所以它的部件排在最前。
   */
  function partsOfChar(st, c) {
    const out = [];
    const seen = new Set();
    for (const v of variantsOf(st, c.id)) {
      const vs = v.slice(0, MAX_PARTS);
      for (const g of vs) {
        if (seen.has(g)) continue;
        out.push(g);
      }
      for (const g of vs) seen.add(g);
    }
    return out;
  }

  /** 写入手写拆法（parts 可为字符串或数组）；空数组 = 删掉手写拆法、回到拆字库 */
  function setManualParts(st, charId, parts) {
    const arr = Array.isArray(parts) ? parseParts(parts.join(' ')) : parseParts(parts);
    if (!st.manual) st.manual = {};
    if (!arr.length) delete st.manual[charId];
    else st.manual[charId] = arr;
    rebuildParts(st);
    return arr;
  }

  function clearManualParts(st, charId) {
    if (st.manual) delete st.manual[charId];
    rebuildParts(st);
  }

  // 依据角色重建部件表（字素字 -> 全部拆法的部件，不再区分拆法）
  function rebuildParts(st) {
    st.parts = [];
    for (const c of st.chars) {
      if (c.role !== 'zi') continue;
      // 手写那条排在所有拆法最前面，所以前 n 块就是用户自己加的 —— 它们可以被 ✕ 掉
      const n = manualCount(st, c.id);
      partsOfChar(st, c).forEach((g, i) => {
        st.parts.push({ id: `${c.id}-p${i}`, glyph: g, from: c.id, manual: i < n });
      });
    }
  }

  /** 这个字手写了几个部件（没有手写就是 0） */
  function manualCount(st, charId) {
    const m = st.manual && st.manual[charId];
    return m ? Math.min(m.length, MAX_PARTS) : 0;
  }

  function assignRole(st, charId, role) {
    const c = st.chars.find(x => x.id === charId);
    if (c) c.role = role;
    rebuildParts(st);
  }

  /**
   * 使用中集合（软锁定）：
   *  - 消耗集合 = 所有合并里引用过的部件/整字实例 id（每个实例只能用一次）。
   *  - 部件的某实例被用 → 只锁该实例；
   *  - 整字本身被用 → 该字摊在池子里的全部部件实例一并锁定（整字一次用掉全部材料）；
   *  - 某字的任一部件实例被用 → 整字锁定（整字里包含已消耗的材料，不可整字再用），
   *    但该字其余未用部件实例仍可独立参与后续合并（如 丿(千)+十(古)=千 后，
   *    十(千)、口(古) 仍可用于 十+口=古）。
   *  - 合成结果（中间产物）同样按实例一次一用。
   */
  function usedIdsOf(st) {
    const consumed = new Set(st.merges.flatMap(m => m.partIds));
    const used = new Set(consumed);
    const allPartIdsOf = c => {
      const out = [];
      partsOfChar(st, c).forEach((g, i) => out.push(`${c.id}-p${i}`));
      return out;
    };
    for (const c of st.chars) {
      if (c.role !== 'zi') continue;
      const allIds = allPartIdsOf(c);
      if (consumed.has(c.id)) {
        for (const id of allIds) used.add(id); // 整字整体用掉 → 全部部件锁定
      } else if (allIds.some(id => consumed.has(id))) {
        used.add(c.id); // 部分提取 → 整字锁定，未用部件保留
      }
    }
    return used;
  }

  // 可参与合成的对象：字素整字 + 拆解部件 + 合成结果（已使用的不可再选）
  function mergableItems(st) {
    const used = usedIdsOf(st);
    const out = [];
    for (const c of st.chars) if (c.role === 'zi' && !used.has(c.id)) out.push({ id: c.id, glyph: c.char, kind: '字素' });
    for (const p of st.parts) if (!used.has(p.id)) out.push({ id: p.id, glyph: p.glyph, kind: '部件' });
    for (const m of st.merges) if (!used.has(m.id)) out.push({ id: m.id, glyph: m.glyph, kind: '合成' });
    return out;
  }

  // 合并 1~N 个对象（单选=直接提取该字素/部件/合成结果；多选=组合）。
  // glyph 缺省时：单选取对象自身字形，多选必须显式给结果字。返回 {ok} 或 {ok:false, reason}。
  function confirmMerge(st, ids, glyph) {
    if (!Array.isArray(ids) || ids.length < 1) return { ok: false, reason: '至少选择一个对象。' };
    if (new Set(ids).size !== ids.length) return { ok: false, reason: '不能重复选择同一个对象。' };
    const items = mergableItems(st);
    const avail = new Set(items.map(x => x.id));
    for (const id of ids) {
      if (!avail.has(id)) return { ok: false, reason: `「${id}」已被使用（每个字素/部件/合成结果只能用一次）。` };
    }
    const itemsById = new Map(items.map(x => [x.id, x.glyph]));
    if (!glyph) {
      if (ids.length === 1) glyph = itemsById.get(ids[0]); // 单选：默认就是它自身
      if (!glyph) return { ok: false, reason: '缺少合成结果字。' };
    }
    st.merges.push({
      id: 'r' + st.mergeSeq++, partIds: ids.slice(), glyph,
      // 快照各部件字形：部件被用掉后会从 mergableItems 消失，显示层靠快照还原名称
      partGlyphs: ids.map(id => itemsById.get(id) || '?'),
    });
    return { ok: true };
  }

  /** 对象当前的字形（合成结果 / 部件 / 整字），找不到时退回 id ——
   *  调用方要"纯字形"时用它，别去 itemLabel 的括号后缀上做正则剥壳。 */
  function glyphOf(st, id) {
    const m = st.merges.find(x => x.id === id);
    if (m) return m.glyph;
    const p = st.parts.find(x => x.id === id);
    if (p) return p.glyph;
    const c = st.chars.find(x => x.id === id);
    if (c) return c.char;
    return id;
  }

  // 稳定标签（不依赖对象是否仍可用）：十(来自古)、千(整字)、杏(合成)
  function itemLabel(st, id) {
    const m = st.merges.find(x => x.id === id);
    if (m) return m.glyph + '(合成)';
    const p = st.parts.find(x => x.id === id);
    if (p) return p.glyph + '(来自' + ((st.chars.find(c => c.id === p.from) || {}).char || '?') + ')';
    const c = st.chars.find(x => x.id === id);
    if (c) return c.char + '(整字)';
    return id;
  }

  // 删除合并及其全部依赖（合成结果被后续合并引用时级联删除）
  function deleteMergeCascade(st, id) {
    const dependents = new Set();
    const collect = mid => {
      const m = st.merges.find(x => x.id === mid);
      if (!m) return;
      dependents.add(mid);
      for (const mm of st.merges) {
        if (mm.partIds.includes(mid) && !dependents.has(mm.id)) collect(mm.id);
      }
    };
    collect(id);
    st.merges = st.merges.filter(m => !dependents.has(m.id));
    for (const mid of dependents) {
      delete st.pairs[mid];                 // 被删结果的配对一并清除
      if (st.unpaired) delete st.unpaired[mid];
    }
    return [...dependents];
  }

  // ---------- 合成结果 ↔ 谜底字 配对 ----------
  /**
   * "活着的"合成结果 = 没有被别的合并当作输入用掉的。
   * 中间产物在动画里会被消费者吸收（`木` 被 `杏` 吃掉），所以它**永远不能承担谜底** ——
   * 否则末尾会出现"答案字凭空消失"（曾经把 `十八口 → 杏子` 自动配成 木→子，末帧只剩杏）。
   */
  function liveMerges(st) {
    const consumed = new Set();
    for (const m of st.merges) for (const id of m.partIds) consumed.add(id);
    return st.merges.filter(m => !consumed.has(m.id));
  }

  // 自动配对（默认）：字形相同的优先。
  // 双扣：两个合成结果字形都等于某谜底字时，两者都落到该槽（同字形可叠加到同一槽）；
  // 不同字形的结果绝不抢占已被别的字形占用的槽，只会落到空槽，避免误配。
  // 多段谜底示例: 木+口=杏、艹+化=花，谜底「杏花」→ 杏→槽0、花→槽1。
  function autoPair(st) {
    const pairs = {};
    if (!st.answer) return pairs;
    const ansChars = [...st.answer];
    const slotGlyph = {};        // 槽位 -> 已落位的字形（同字形可叠加，异字形互斥）
    const usedMerges = new Set();
    const live = liveMerges(st);
    for (const m of live) {
      let idx = -1;
      for (let i = 0; i < ansChars.length; i++) {
        if (ansChars[i] === m.glyph && (slotGlyph[i] == null || slotGlyph[i] === m.glyph)) { idx = i; break; }
      }
      if (idx >= 0) { pairs[m.id] = idx; slotGlyph[idx] = m.glyph; usedMerges.add(m.id); }
    }
    let k = 0;
    for (const m of live) {
      if (usedMerges.has(m.id)) continue;
      while (k < ansChars.length && slotGlyph[k] != null) k++;
      if (k >= ansChars.length) break;
      pairs[m.id] = k; slotGlyph[k] = m.glyph; usedMerges.add(m.id); k++;
    }
    return pairs;
  }

  // 显式配对：把合成结果指定到某个谜底字槽位。
  // 双扣：允许同一槽位挂多个结果（不再把先来的挤掉）；拿起一个结果连到已有来源的行 = 叠加。
  function pairResult(st, mergeId, slotIdx) {
    if (!st.merges.some(m => m.id === mergeId)) return false;
    if (slotIdx < 0 || slotIdx >= [...st.answer].length) return false;
    st.pairs[mergeId] = slotIdx;
    if (st.unpaired) delete st.unpaired[mergeId];
    st.pairTouched = true;
    return true;
  }

  function unpairResult(st, mergeId) {
    delete st.pairs[mergeId];
    if (!st.unpaired) st.unpaired = {};
    st.unpaired[mergeId] = true; // 记下"用户要它别进谜底"，否则自动补位会让「解除」看起来没反应
    st.pairTouched = true;
  }

  // 清理失效配对（合并已删 / 已被别的合并吸收 / 槽位越界）。
  // 注意：不再按槽位去重 —— 双扣允许同一槽位挂多个结果，全部保留。
  function prunePairs(st) {
    const out = {};
    const an = [...st.answer].length;
    const alive = new Set(liveMerges(st).map(m => m.id));
    for (const id in st.pairs) {
      const slot = st.pairs[id];
      if (!alive.has(id)) continue;   // 中间产物会被吸收，不能占谜底位
      if (slot < 0 || slot >= an) continue;
      out[id] = slot;
    }
    st.pairs = out;
    if (st.unpaired) {
      for (const id of Object.keys(st.unpaired)) {
        if (!alive.has(id)) delete st.unpaired[id];
      }
    }
  }

  /**
   * 动画/面板使用的最终配对。
   *  - 没手动改过 → 全自动；
   *  - 手动改过 → 手动配对优先，**但空槽仍用"字形对得上的活结果"补位**：
   *    否则同一个字会先以合成结果的身份出现（青），末尾再被 reveal 弹一个（紫），
   *    看起来就像"谜底变了个颜色"，而那段本身是重复的；
   *  - 用户手动解除过的结果不参与补位（那是明确的"别放这里"）。
   */
  function effectivePairs(st) {
    prunePairs(st);
    if (!st.pairTouched) {
      // 未手动改过时，自动配对即权威状态，持久化回 st.pairs：
      // 这样用户第一次手动改配（pairResult 把 pairTouched 置 true）时，st.pairs 已含
      // 全部自动配对结果，双扣的多个结果不会被丢掉（否则只有最后显式那一个被保留）。
      st.pairs = autoPair(st);
      return st.pairs;
    }
    const pairs = Object.assign({}, st.pairs);
    const usedSlots = new Set(Object.values(pairs));
    const refused = st.unpaired || {};
    const ansChars = [...st.answer];
    for (const m of liveMerges(st)) {
      if (pairs[m.id] != null || refused[m.id]) continue;
      const idx = ansChars.findIndex((ch, i) => ch === m.glyph && !usedSlots.has(i));
      if (idx >= 0) { pairs[m.id] = idx; usedSlots.add(idx); }
    }
    return pairs;
  }

  // ---------- 时间轴组装 ----------
  /**
   * cfg: {W,H,charY,charFS,mergeX,mergeY,answerFS,labelFS,labelX,pad?}
   *
   * 两块式换行布局（谜面可能很长，14~20+ 字）：
   *   行块1 = 谜面字：超过一行容量则**平衡换行**，每行单独居中；
   *   行块2 = 部件落点 + 合成结果 + 谜底槽位：合成结果/谜底槽位超过一行容量时
   *           也按阅读顺序换行（多行网格）；
   *   cfg.charY / cfg.mergeY 是**第一行**的锚点；换行时只向下扩展画布高度，
   *   因此单行场景（常见情形）的布局与画布尺寸完全不变（仍 640×210）。
   *   画布高度由内容算出并挂在返回时间轴的 `.H` 上，供预览/导出使用。
   */
  function buildTimelineFromState(st, cfg) {
    const E = engine();
    const scenes = [];
    const initialItems = [];

    const W = cfg.W;
    const baseCharFS = cfg.charFS;
    const baseAnswerFS = cfg.answerFS != null ? cfg.answerFS : 62;
    // 左右安全边（给左端行标签留位）与每行容量
    const pad = cfg.pad != null ? cfg.pad : 64;
    const usable = W - 2 * pad;

    // ---- 按行数自动降字号 ----
    // 约束：谜面 ≤ maxMianLines 行、行2 ≤ maxSecondLines 行；在此前提下取最大字号，
    // 下限 minCharFS / minAnswerFS 保底（太长的谜面宁可行数多一点，也不把字缩到看不清）。
    // 一个"单元数 + 字号"占几行（per = 每行容量）
    const linesAt = (total, fs, inset) => {
      const per = Math.max(1, Math.floor(usable / (fs + inset)));
      return { lines: total > 0 ? Math.ceil(total / per) : 1, per };
    };
    const fitFont = (total, baseFS, minFS, maxLines, inset) => {
      let fs = baseFS;
      while (fs > minFS && linesAt(total, fs, inset).lines > maxLines) fs -= 2;
      return Math.max(minFS, fs);
    };
    const ansCount = [...st.answer].length;
    const charFS = fitFont(st.chars.length, baseCharFS, cfg.minCharFS || 34, cfg.maxMianLines || 3, 8);
    const answerFS = fitFont(Math.max(ansCount, st.merges.length), baseAnswerFS, cfg.minAnswerFS || 40, cfg.maxSecondLines || 2, 6);
    // 拆解部件/合成结果字号按各自基准等比缩放，保持行内视觉比例一致
    const partFS = Math.max(28, Math.round(44 * charFS / baseCharFS));
    const mergeFS = Math.max(34, Math.round(54 * answerFS / baseAnswerFS));

    const perLine1 = Math.max(1, Math.floor(usable / (charFS + 8)));      // 谜面每行字数
    const perLine2 = Math.max(1, Math.floor(usable / (answerFS + 6)));   // 行2 每行单元数
    const row1LineH = Math.max(charFS * 1.28, charFS + 14);              // 谜面行高
    const row2LineH = Math.max(answerFS * 1.24, answerFS + 14);          // 行2 行高
    const bottomPad = 24;

    // 谜面平衡换行（14 字→7+7，而不是 8+6）
    const mianLines = [];
    {
      const L = Math.ceil(st.chars.length / perLine1);
      const per = L > 0 ? Math.ceil(st.chars.length / L) : perLine1;
      for (let i = 0; i < st.chars.length; i += per) mianLines.push(st.chars.slice(i, i + per));
    }
    const Lc = Math.max(1, mianLines.length);
    const y1 = li => cfg.charY + li * row1LineH;                 // 谜面第 li 行中心
    const y2 = lj => cfg.mergeY + (Lc - 1) * row1LineH + lj * row2LineH; // 行2 第 lj 行中心
    // 单行居中排布：返回 {spacing, x0}
    const lineLayout = count => {
      const spacing = count > 1 ? Math.min(150, usable / count) : 0;
      return { spacing, x0: W / 2 - ((count - 1) * spacing) / 2 };
    };

    mianLines.forEach((lineChars, li) => {
      const { spacing, x0 } = lineLayout(lineChars.length);
      lineChars.forEach((c, i) => {
        initialItems.push({
          id: c.id, glyph: c.char,
          x: x0 + i * spacing, y: y1(li),
          color: ROLE_COLOR(c.role), fontSize: charFS,
        });
      });
    });
    // 每个字素在画布上的位置（拆解场景要按各自所在行）
    const charPos = new Map();
    for (const it of initialItems) charPos.set(it.id, { x: it.x, y: it.y });

    // ---- 行2 落点规划：先算清楚"每个合成结果落在哪、字素的部件落到哪" ——
    //      部件的落点要用它（部件停到"它即将被合并进去的地方"），所以整块排在拆解场景之前。----
    const mk = st.merges.length;
    const ansChars = [...st.answer].map((ch, i) => ({ id: 'a' + i, glyph: ch }));
    const an = ansChars.length;
    const gridMode = mk > perLine2 || an > perLine2;
    // 网格布点：第 i 个单元（共 total 个）按每行 perLine2 个排布
    const gridPos = (i, total) => {
      const lj = Math.floor(i / perLine2);
      const col = i % perLine2;
      const count = Math.min(perLine2, total - lj * perLine2);
      const { spacing, x0 } = lineLayout(count);
      return { x: x0 + col * spacing, y: y2(lj) };
    };

    // 合成结果 ↔ 谜底字配对（显式优先，否则自动）。配对决定"这个合成结果落在哪一个谜底槽位"。
    const pairs = effectivePairs(st);
    const pairedSlots = new Set();
    for (const id in pairs) pairedSlots.add(pairs[id]);
    // 双扣：一个谜底槽位可能挂多个合成结果（同一字被两条路径扣到）。
    // slotToIds[槽位] = 指向它的合成结果 id 列表（按合并顺序）。
    const slotToIds = {};
    for (const m of st.merges) {
      const s = pairs[m.id];
      if (s == null) continue;
      (slotToIds[s] = slotToIds[s] || []).push(m.id);
    }
    // 谁会被后续合并当输入 —— 决定它是"中间产物（跟随消费者的落点）"还是"独立结果"
    const consumerOf = new Map();
    for (const m of st.merges) for (const id of m.partIds) consumerOf.set(id, m.id);
    // 未配对、也不会被后续合并消耗的结果 = "没扣上的结果"（最典型的失手操作：合成了谜底里
    // 没有的字）。它们原先与谜底槽位挤在同一排（都取 y2(0)），常常落到同一个坐标上，
    // 甚至正压在那个"最后要从这里弹出来的谜底字"上面。现在统一排到谜底行**下方**。
    const strayIds = new Set();
    {
      const anchored = new Set();
      for (const m of st.merges) if (pairs[m.id] != null) anchored.add(m.id);
      for (let i = st.merges.length - 1; i >= 0; i--) {
        const m = st.merges[i];
        if (anchored.has(m.id)) continue;
        const next = consumerOf.get(m.id);
        if (next && anchored.has(next)) { anchored.add(m.id); continue; }
        strayIds.add(m.id);
      }
    }
    const coreRows = Math.max(1, Math.ceil(Math.max(mk, an) / perLine2));
    const strayRows = strayIds.size ? 1 : 0;
    // 行2 总行数（决定画布高度）
    const rows2 = coreRows + strayRows;

    // 谜底槽位 / "未配对结果层"的坐标
    const as = an > 1 ? Math.min(150, usable / an) : 0;
    const ax0 = W / 2 - ((an - 1) * as) / 2;
    const slotPos = j => (gridMode ? gridPos(j, an) : { x: ax0 + j * as, y: y2(0) });
    const mergePos = i => (gridMode
      ? gridPos(i, mk)
      : { x: cfg.mergeX + (i - (mk - 1) / 2) * (mk > 1 ? Math.min(90, usable / (mk - 1)) : 0), y: y2(0) });
    // 未配对结果的落点：排在谜底行下方的网格里，横向居中铺开
    const strayPosAt = k => {
      const lj = Math.floor(k / perLine2);
      const col = k % perLine2;
      const count = Math.min(perLine2, strayIds.size - lj * perLine2);
      const { spacing, x0 } = lineLayout(count);
      return { x: x0 + col * spacing, y: y2(coreRows + lj) };
    };
    const strayPosOf = new Map();
    {
      let k = 0;
      for (const m of st.merges) if (strayIds.has(m.id)) strayPosOf.set(m.id, strayPosAt(k++));
    }

    // 落点规划：每个合成结果的最终位置在它**第一次出现时**就定好，之后一步都不再移动。
    //   - 配对到谜底槽        -> 该槽位坐标（谜底顺序由槽位表达）
    //       · 双扣（同一槽多个结果）：在其周围横向错位排布；由其中一个（字形即谜底字者，
    //         否则最后一个）在槽位中心显示谜底字，其余显示自身字形，直观表达"两条路径汇到这字"。
    //   - 会被后面的合并当输入 -> 跟随那个合并的落点（继续在谜底位上拼，而不是先弹在
    //                            中间再横滑过去 —— 否则"拼出字"和"位移到谜底"是两段运动）
    //   - 两者都不是          -> 未配对结果层（strayPosOf：排在谜底行下方）
    // 反向遍历：输入一定先于消费者创建，所以从后往前扫一遍就能把链式依赖传递完。
    const landPos = new Map();     // 合并 id -> {x,y}
    const atAnswer = new Map();    // 合并 id -> 是否落在谜底位上
    // 双扣组几何：一个谜底槽挂 n 个结果时围绕槽位横向铺开。
    //   间距由**槽位间距**决定 —— an>1 时必须容进本槽的宽度，否则会压到相邻槽位；
    //   单槽时不受邻槽约束，按字号给足间距。字号取 min(mergeFS, 间距*0.96)，
    //   即"字号不超过间距"，组内两个字永远不会叠在一起
    //   （旧值 min(mergeFS*0.82,120)=44px 配 54px 字号，双扣那两个字是叠着的）。
    const dkGeom = slot => {
      const group = slotToIds[slot];
      const n = group.length;
      if (n <= 1) return { group, n, centerIdx: 0, gap: 0, fs: mergeFS };
      const budget = an > 1 ? as : n * mergeFS * 1.06;
      const gap = Math.max(16, budget / n);
      const ci = group.findIndex(id => {
        const mm = st.merges.find(x => x.id === id);
        return mm && mm.glyph === ansChars[slot].glyph;
      });
      return { group, n, centerIdx: ci >= 0 ? ci : n - 1, gap, fs: Math.min(mergeFS, gap * 0.96) };
    };
    const dkPos = (slot, id) => {
      const base = slotPos(slot);
      const g = dkGeom(slot);
      if (g.n <= 1) return base;
      return { x: base.x + (g.group.indexOf(id) - g.centerIdx) * g.gap, y: base.y };
    };
    // 双扣里"这个槽位的答案单元" = 显示谜底字的那个（字形即谜底字者，否则最后一个）
    const dkIsCenter = (slot, id) => {
      const g = dkGeom(slot);
      return g.n <= 1 || g.group.indexOf(id) === g.centerIdx;
    };
    for (const m of st.merges) {
      const slot = pairs[m.id];
      if (slot == null) continue;
      landPos.set(m.id, dkPos(slot, m.id));
      atAnswer.set(m.id, true);
    }
    for (let i = st.merges.length - 1; i >= 0; i--) {
      const m = st.merges[i];
      if (pairs[m.id] != null) continue;   // 已定为落位
      const next = consumerOf.get(m.id);
      if (next && landPos.has(next)) { landPos.set(m.id, landPos.get(next)); atAnswer.set(m.id, atAnswer.get(next)); continue; }
      landPos.set(m.id, strayIds.has(m.id) ? strayPosOf.get(m.id) : mergePos(i));
      atAnswer.set(m.id, false);
    }

    // 部件落点：停到"它自己那次合并的落点"附近 —— 同一次合并的多个部件围绕该落点横向铺开。
    //   为什么不再"按来源字横排到行2 首行"：只要一个字的部件分属**多次**合并，它就要在行2
    //   停好几段动画，先落位的合成结果会直接压在还在等待的部件上（官方示例「千古」里就叠着：
    //   r0 落在 245，等待中的 m0-p1 停在 281，两个 54px 的字重了 36px）。停到各自的合并点后，
    //   部件被消耗的那一刻正是结果出现的那一刻，两者不会并存。
    //   全局一起算（不同字的部件可能进同一次合并），所以任意两个部件也不会落到同一处。
    const partIdSet = new Set(st.parts.map(p => p.id));
    const partGapOf = new Map();      // 合并 id -> 组内间距（0 = 只有一个部件）
    const partLandPos = new Map();    // 部件 id -> {x,y}
    for (const m of st.merges) {
      const ids = m.partIds.filter(id => partIdSet.has(id));
      if (!ids.length) continue;
      const land = landPos.get(m.id) || { x: W / 2, y: y2(0) };
      const n = ids.length;
      // 间距不超过"本槽的宽度"（an>1 按槽距，单槽时这一排只有它自己，用整行可用宽度）
      const gap = n > 1 ? Math.min(72, (an > 1 ? as : usable) / n) : 0;
      partGapOf.set(m.id, gap);
      const half = ((n - 1) * gap) / 2;
      // 整组钳进可用区（左端有行标签，越界会压到标签上）
      const cxg = Math.max(pad + half + partFS / 2,
        Math.min(W - pad - half - partFS / 2, land.x));
      ids.forEach((id, k) => {
        const off = n > 1 ? (k - (n - 1) / 2) * gap : 0;
        partLandPos.set(id, { x: cxg + off, y: land.y });
      });
    }

    // 1) 字素拆解（仅当该字的部件确实参与了合并：只拆出被使用的部件，
    //    未使用的部件不进动画；字素整字直接参与合并时则不拆解）
    const usedPartIds = new Set();
    for (const m of st.merges) for (const id of m.partIds) usedPartIds.add(id);
    for (const c of st.chars) {
      if (c.role !== 'zi') continue;
      const gs = partsOfChar(st, c);
      if (!gs.length) continue;
      const parts = gs
        .map((g, i) => ({ id: `${c.id}-p${i}`, glyph: g }))
        .filter(p => usedPartIds.has(p.id));
      if (!parts.length) continue; // 部件未被使用 -> 不拆解
      const pos = charPos.get(c.id) || { x: W / 2, y: cfg.charY };
      // 部件字号不得大于它所在那组的间距，否则组内两个部件会叠在一起
      let pfs = partFS;
      for (const p of parts) {
        const g = partGapOf.get(consumerOf.get(p.id));
        if (g > 0) pfs = Math.min(pfs, g * 0.96);
      }
      pfs = Math.max(18, Math.round(pfs));
      scenes.push(E.sceneDecompose({
        charId: c.id, parts,
        cx: pos.x, cy: pos.y,
        // 逐个部件给落点：都还在行2，各自停在自己那次合并的落点附近
        drop: { positions: parts.map(p => partLandPos.get(p.id) || { x: W / 2, y: y2(0) }) },
        partColor: '#0c8599', partFontSize: pfs,
      }));
    }

    // 2) 依次合并（按用户顺序，必须保持顺序：后面的合并会用到前面的合成结果）。
    //    配对过的合成结果**直接落在它的谜底槽位上** —— 不再先弹在中间、
    //    再横移过去。顺序由槽位本身表达，省掉整个"位移"阶段。
    //    落点已在上面算好（landPos）。
    st.merges.forEach(m => {
      const slot = pairs[m.id];
      const p = landPos.get(m.id);
      const dg = slot != null ? dkGeom(slot) : null;
      // 落位显示：单来源与双扣的"中心"都显示**该槽位的谜底字**（手动配对也不弄反谜底顺序）；
      // 双扣的非中心来源显示自身字形（舌/辛 各自飞到该字位，两条路径都看得见）。
      const glyph = slot == null ? m.glyph
        : (dkIsCenter(slot, m.id) ? ansChars[slot].glyph : m.glyph);
      const sc = E.sceneMerge({
        partIds: m.partIds,
        result: { id: m.id, glyph },
        cx: p.x, cy: p.y,
        color: ANSWER_COLOR, fontSize: dg ? dg.fs : mergeFS,
      });
      sc.landsOnAnswer = atAnswer.get(m.id); // 供行标签定位"谜底开始成形"的时刻
      scenes.push(sc);
    });

    // 4) 揭示谜底：只为"没有合成结果落位"的谜底字补一个原位弹出场景。
    //    正常谜底每个字都会由某个合成结果直接落位，此时 unpaired 为空 ——
    //    绝不能推一个空 reveal：它不产生任何画面变化，却要占满整段时长
    //    （实测 1.6s，占全长 24%~30%，且它想压暗的背景早就淡出了）。
    // 压暗"背景单元"：谜面字 + 部件 + **没落位**的合成结果。
    // 落位的合成结果现在就是谜底本身，绝不能被压暗（它是画面的主角）。
    const pairedMergeIds = new Set(Object.keys(pairs));
    const dimIds = [
      ...st.chars.map(c => c.id),
      ...st.parts.map(p => p.id),
      ...st.merges.filter(m => !pairedMergeIds.has(m.id)).map(m => m.id),
    ];
    const unpaired = ansChars
      .map((c, i) => (pairedSlots.has(i) ? null : Object.assign({}, c, slotPos(i))))
      .filter(Boolean);
    if (unpaired.length) {
      scenes.push(E.sceneReveal({
        chars: unpaired,
        cx: W / 2, cy: y2(0),
        spacing: as, color: ANSWER_COLOR, fontSize: answerFS,
        dimIds, duration: 1.0,
      }));
    }

    // 5) 末尾定格：让最后一帧看得清、循环播放不"闪回"。固定 0.5s，不多留死时间。
    if (ansChars.length) scenes.push(E.sceneHold({ duration: 0.5 }));

    // 行标签（覆盖层，不占独立标注行）：
    //   行1 左端常显「谜面」（贴首行）；
    //   行2 左端在「谜底开始成形」时淡入 —— 即第一个落在谜底槽位的合成结果，
    //   没有落位合成结果时退化为 reveal 场景起点。
    const labelFS = Math.max(16, Math.round((cfg.labelFS || 22) * charFS / baseCharFS));
    const labelX = cfg.labelX || 30;
    const overlays = [
      { text: '谜面', x: labelX, y: y1(0), fontSize: labelFS, fill: '#868e96', anchor: 'middle', opacity: 1 },
    ];
    // 第三阶段起点 = 第一个 displace / reveal 场景之前的总时长
    // 「谜底」标签出现时刻 = 第一个落在谜底槽位的合成结果（或退化为 reveal 起点）
    let tPhase3 = null, acc = 0;
    for (const sc of scenes) {
      if (sc.landsOnAnswer || sc.type === 'reveal') { tPhase3 = acc; break; }
      acc += sc.duration;
    }
    if (tPhase3 != null) {
      overlays.push({
        text: '谜底', x: labelX, y: y2(0), fontSize: labelFS, fill: ANSWER_COLOR,
        anchor: 'middle', opacityAt: t => E.clamp01((t - tPhase3) / 0.4),
      });
    }

    const tl = E.buildTimeline({ initialItems, scenes, overlays });
    // 画布高度由内容算出（单行场景 = cfg 原值 210，不改变现有观感/体积）
    tl.H = Math.round(y2(rows2 - 1) + answerFS / 2 + bottomPad);
    // 槽位元信息：每个谜底槽由哪个单元承担（配对的合成结果，否则由 reveal 弹出的谜底字）。
    // 层外（预览/导出/测试）想知道"末帧这个槽位上是哪个单元"时用它，不必猜 id 前缀。
    tl.slots = ansChars.map((_, i) => Object.assign({}, slotPos(i)));
    tl.answerUnits = {};
    for (const m of st.merges) {
      const s = pairs[m.id];
      if (s == null) continue;
      // 双扣：由显示谜底字的那个结果当答案单元（其余呈现在它两侧）
      if (dkIsCenter(s, m.id)) tl.answerUnits[s] = m.id;
    }
    for (let i = 0; i < an; i++) if (tl.answerUnits[i] == null) tl.answerUnits[i] = ansChars[i].id;
    tl.rows = {
      mian: Lc, second: rows2, perLine1, perLine2, gridMode,
      charFS, answerFS, partFS, mergeFS, labelFS,
      shrunk: charFS !== baseCharFS || answerFS !== baseAnswerFS,
    };
    return tl;
  }

  // 身份配色。工具只分两类：zi=字素（参与拆合）/ ci=衬字（不参与拆合）。
  // bao/zhi 是旧的三分类残留，一并映射到衬字色，避免任何遗留状态落到灰色。
  function ROLE_COLOR(role) {
    return { zi: '#2f9e44', ci: '#e8590c', bao: '#e8590c', zhi: '#e8590c', none: '#868e96' }[role] || '#868e96';
  }

  return {
    decompData, componentIndex, findCandidates,
    createState, rebuildParts, assignRole,
    variantsOf, partsOfChar, parseParts, setManualParts, clearManualParts, manualCount, commonParts, MAX_PARTS,
    usedIdsOf, mergableItems, glyphOf, itemLabel, confirmMerge, deleteMergeCascade,
    autoPair, pairResult, unpairResult, prunePairs, effectivePairs, liveMerges,
    buildTimelineFromState,
  };
});