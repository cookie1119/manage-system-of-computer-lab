/* 作业批改页：作业要求（文件/文件夹 · 类型 · 数量 · 命名）、按学号汇总、状态筛选 */
(function (A) {
  'use strict';
  const U = A.util, SE = A.seats, S = A.store;
  const V = A.views = A.views || {};

  const state = { result: null, filter: 'all' };

  /* ---------- 文件类型（一种类型可含多个后缀） ---------- */
  const FILE_TYPES = [
    { key: 'txt', label: '文本文档', short: 'txt', exts: ['txt'] },
    { key: 'word', label: 'Word 文档', short: 'Word', exts: ['doc', 'docx'] },
    { key: 'excel', label: 'Excel 表格', short: 'Excel', exts: ['xls', 'xlsx'] },
    { key: 'ppt', label: 'PPT 演示文稿', short: 'PPT', exts: ['ppt', 'pptx'] },
    { key: 'img', label: '图片', short: '图片', exts: ['jpg', 'jpeg', 'png', 'gif', 'bmp'] },
    { key: 'bcm', label: 'bcm 文件', short: 'bcm', exts: ['bcm'] }
  ];

  /* 状态：没有“类型错误”。数量不足一律算数量错误；数量对了才看命名。
     leave = 本节请假，按请假计，不算缺交也不算作业异常，总评不扣分。 */
  const STATUS = {
    missing: { text: '缺交', cls: 'danger', rank: 4, color: '#dc2626' },
    count: { text: '数量错误', cls: 'warn', rank: 3, color: '#f59e0b' },
    name: { text: '命名错误', cls: 'warn', rank: 2, color: '#a855f7' },
    ok: { text: '正确', cls: 'ok', rank: 1, color: '#16a34a' },
    leave: { text: '请假', cls: 'blue', rank: 0, color: '#2563eb' }
  };
  const STATUS_ORDER = ['missing', 'count', 'name', 'ok', 'leave'];

  function extsOf(keys) {
    const out = [];
    (keys || []).forEach(k => {
      const t = FILE_TYPES.find(x => x.key === k);
      if (t) t.exts.forEach(e => out.push(e));
    });
    return out;
  }
  function typeLabel(keys) {
    if (!keys || !keys.length) return '任意文件';
    return keys.map(k => {
      const t = FILE_TYPES.find(x => x.key === k);
      return t ? t.label + '(' + t.exts.join('/') + ')' : k;
    }).join('、');
  }
  function typeShort(keys) {
    if (!keys || !keys.length) return '任意文件';
    return keys.map(k => {
      const t = FILE_TYPES.find(x => x.key === k);
      return t ? t.short : k;
    }).join(' / ');
  }
  function rank(s) { return (STATUS[s] || STATUS.ok).rank; }
  function worse(a, b) { return rank(a) >= rank(b) ? a : b; }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s|　/g, ''); }
  function baseNoExt(s) {
    const i = String(s).lastIndexOf('.');
    return i > 0 ? String(s).slice(0, i) : String(s);
  }
  function extOf(s) {
    const i = String(s).lastIndexOf('.');
    return i > 0 ? String(s).slice(i + 1).toLowerCase() : '';
  }

  /* ---------- 命名格式 ---------- */
  const NAME_TOKENS = [
    { t: 'grade', label: '年级', hint: 'C1 / C2' },
    { t: 'class', label: '班级', hint: '两位，1 班 = 01' },
    { t: 'sid', label: '学号', hint: '本人学号，两位' },
    { t: 'name', label: '姓名' },
    { t: 'idx', label: '序号', hint: '同类型第几个：1、2…' }
  ];
  function tokenText(cls, sid, p, idx) {
    if (p.t === 'grade') return A.term.gradeCode(cls.grade);
    if (p.t === 'class') return U.pad2(parseInt(cls.classNo, 10) || 1);
    if (p.t === 'sid') return U.pad2(sid);
    if (p.t === 'name') return SE.name(cls, sid) || '';
    if (p.t === 'idx') return String((idx || 0) + 1);
    return p.v || '';
  }
  function buildName(cls, sid, rule, idx) {
    return (rule || []).map(p => tokenText(cls, sid, p, idx)).join('');
  }
  function rulePattern(rule) {
    if (!rule || !rule.length) return '不限';
    return rule.map(p => {
      const t = NAME_TOKENS.find(x => x.t === p.t);
      return t ? '[' + t.label + ']' : p.v;
    }).join('');
  }
  function ruleText(cls, rule, sid) {
    if (!rule || !rule.length) return '不限命名';
    return rulePattern(rule) + '　（例：' + buildName(cls, sid || 1, rule, 0) + '）';
  }
  function sampleSid(cls) {
    const list = S.activeStudents(cls);
    return list.length ? list[0] : 1;
  }

  /* ---------- 路径分组：找到“学生文件夹”那一层 ---------- */
  function groupPaths(paths, room) {
    const segs = paths.map(p => String(p).split('/').filter(Boolean));
    const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
    const hit = arr => (arr.length ? arr.filter(n => A.rooms.seatOfFolder(room, n)).length / arr.length : 0);
    const firsts = uniq(segs.map(s => s[0]));
    const seconds = uniq(segs.map(s => s[1]));
    let level = 0;
    if (hit(firsts) < 0.5 && hit(seconds) > hit(firsts) && segs.every(s => s.length > 1)) level = 1;
    const map = {};
    segs.forEach(s => {
      if (s.length <= level) return;
      const key = s[level];
      (map[key] = map[key] || []).push(s.slice(level + 1).join('/'));
    });
    return map;
  }
  V.parseSeat = function (name) { return A.rooms.seatOfFolder(A.rooms.get(S.current()), name); };
  V.groupPaths = groupPaths;

  /* ---------- 提交内容整理 ---------- */
  function buildEntries(rels) {
    const dirs = new Set();
    rels.forEach(p => {
      const parts = p.split('/').filter(Boolean);
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    });
    const all = Array.from(new Set(rels.concat(Array.from(dirs))));
    return all.map(p => {
      const parts = p.split('/').filter(Boolean);
      return {
        rel: p, name: parts[parts.length - 1],
        parent: parts.slice(0, -1).join('/'),
        isDir: dirs.has(p), depth: parts.length
      };
    });
  }
  /** 表格里“已提交了什么”：相对路径列表 */
  function submittedText(entries) {
    if (!entries.length) return '';
    const rels = entries.map(e => e.rel + (e.isDir ? '/' : '')).sort();
    const show = rels.slice(0, 5);
    return show.join('、') + (rels.length > 5 ? ' 等 ' + rels.length + ' 项' : '');
  }

  /** 文件夹名不合机房规则时（学生把名字写错了），按“姓名 → 学号”把他认出来 */
  function guessSeat(cls, folder) {
    const key = String(folder || '').replace(/[\s　]/g, '');
    if (!key) return null;
    let sid = 0;
    const roster = cls.roster || {};
    Object.keys(roster).forEach(k => {
      const nm = String(roster[k] || '').replace(/[\s　]/g, '');
      if (!sid && nm.length >= 2 && key.indexOf(nm) >= 0) sid = parseInt(k, 10);   // 姓名最准，先找
    });
    if (!sid) {
      const act = S.activeStudents(cls);
      const ms = key.match(/\d{1,3}/g) || [];
      for (let i = 0; i < ms.length && !sid; i++) {
        const n = parseInt(ms[i], 10);
        if (act.indexOf(n) >= 0) sid = n;
      }
    }
    if (!sid) return null;
    return SE.seatOfStudent(cls, sid) || null;
  }

  /* ---------- 检查一个要求节点 ---------- */
  function checkNode(cls, sid, node, parentRel, entries) {
    const items = entries.filter(e => e.parent === parentRel);
    const need = Math.max(1, parseInt(node.count, 10) || 1);
    let cands = [];
    if (node.kind === 'dir') {
      cands = items.filter(e => e.isDir && (!node.name || norm(e.name).indexOf(norm(node.name)) >= 0));
    } else {
      const exts = extsOf(node.types);
      cands = items.filter(e => !e.isDir && (!exts.length || exts.indexOf(extOf(e.name)) >= 0));
    }
    const out = { status: 'ok', detail: [], cands: cands };

    // 数量：任何一类少于要求都算数量错误；多出来的不算错
    if (cands.length < need) {
      out.status = 'count';
      out.detail.push(labelOf(node) + ' 应有 ' + need + ' 个，实交 ' + cands.length + ' 个');
      return out;                        // 数量不对就不再查命名（命名错+数量错=数量错）
    }

    // 命名：数量对了才逐份检查
    const rules = node.nameRules || [];
    if (rules.some(r => r && r.length)) {
      const pool = cands.slice(0, Math.max(need, rules.length));
      const used = [];
      for (let i = 0; i < need; i++) {
        const rule = rules[i];
        if (!rule || !rule.length) continue;
        const want = buildName(cls, sid, rule, i);
        const exp = norm(want);
        const k = pool.findIndex((c, ci) => used.indexOf(ci) < 0 && norm(baseNoExt(c.name)) === exp);
        if (k < 0) {
          out.status = 'name';
          out.detail.push('第 ' + (i + 1) + ' 个' + (node.kind === 'dir' ? '文件夹' : '文件') + '命名应为 ' + want);
          break;
        }
        used.push(k);
      }
    }

    // 文件夹里的子要求
    if (node.kind === 'dir' && (node.children || []).length) {
      (node.children).forEach((ch, ci) => {
        const target = cands[Math.min(ci, cands.length - 1)];
        const r = checkNode(cls, sid, ch, target.rel, entries);
        out.status = worse(out.status, r.status);
        out.detail.push.apply(out.detail, r.detail);
      });
    }
    return out;
  }
  function labelOf(node) {
    return node.kind === 'dir'
      ? ('文件夹' + (node.name ? '“' + node.name + '”' : ''))
      : (node.types && node.types.length ? typeShort(node.types) : '文件');
  }

  /* ---------- 分析整班 ---------- */
  function analyze(cls, paths) {
    const room = A.rooms.get(cls);
    const groups = groupPaths(paths, room);
    const subs = [], unknown = [], taken = {};
    Object.keys(groups).forEach(folder => {
      const entries = buildEntries(groups[folder]);
      // 文件夹名不合规则的，再按“姓名 / 学号”认一次人（名字写在文件上也算），找不到才归到“认不出”
      let seatId = A.rooms.seatOfFolder(room, folder)
        || guessSeat(cls, folder)
        || guessSeat(cls, entries.map(e => e.name).join(' '));
      if (seatId && taken[seatId]) seatId = null;      // 一个座位只认一个文件夹
      const item = {
        folder: folder, seatId: seatId, sid: seatId ? cls.seats[seatId] : null,
        entries: entries,
        submitted: submittedText(entries),
        files: Array.from(new Set(entries.filter(e => !e.isDir).map(e => e.name)))
      };
      if (seatId) { taken[seatId] = 1; subs.push(item); } else unknown.push(item);
    });

    const bySeat = {};
    subs.forEach(s => { bySeat[s.seatId] = s; });

    const reqs = cls.homeworkReq || [];
    // 重新批改时，老师手动改过的结论要保留下来
    const prev = {};
    [(cls.draft && cls.draft.homework), (state.result && state.result.clsId === cls.id ? state.result : null)]
      .forEach(s => ((s && s.statuses) || []).forEach(x => { if (x.manual) prev[x.sid] = x; }));
    const statuses = [];
    S.activeStudents(cls).forEach(sid => {
      const seat = SE.seatOfStudent(cls, sid);
      const sub = seat ? bySeat[seat] : null;
      // auto = 自动批改的结论；manual = 老师手动改成的；status = 当前生效的
      const base = {
        sid: sid, seat: seat, folder: sub ? sub.folder : '', submitted: sub ? sub.submitted : '',
        auto: 'missing', manual: ''
      };
      if (!sub || !sub.entries.length) {
        statuses.push(Object.assign(base, {
          status: 'missing',
          detail: [sub ? '文件夹是空的' : ('没有找到 ' + (seat ? A.rooms.folderOf(room, seat) : '座位文件夹'))]
        }));
        return;
      }
      if (!reqs.length) {
        statuses.push(Object.assign(base, { auto: 'ok', status: 'ok', detail: [] }));
        return;
      }
      let worst = 'ok';
      const detail = [];
      reqs.forEach(node => {
        const r = checkNode(cls, sid, node, '', sub.entries);
        worst = worse(worst, r.status);
        detail.push.apply(detail, r.detail);
      });
      statuses.push(Object.assign(base, { auto: worst, status: worst, detail: detail }));
    });

    const res = {
      at: U.nowTime(), date: U.today(),
      reqs: JSON.parse(JSON.stringify(reqs)),
      subs: subs, unknown: unknown, statuses: statuses,
      paths: (paths || []).slice()      // 留着原始文件清单，改完作业要求可以重新批改
    };
    statuses.forEach(x => {
      const p = prev[x.sid];
      if (p && p.manual) { x.manual = p.manual; x.status = p.manual; }
    });
    recalcStat(res);
    applyLeave(cls, res);
    return res;
  }

  /** 重算统计与缺交名单（手动改过状态、请假状态变了都要重算） */
  function recalcStat(res) {
    const st = { total: res.statuses.length, missing: 0, count: 0, name: 0, ok: 0, leave: 0, unknown: (res.unknown || []).length };
    res.statuses.forEach(s => { st[s.status] = (st[s.status] || 0) + 1; });
    res.stat = st;
    res.missing = res.statuses.filter(s => s.status === 'missing').map(s => ({ sid: s.sid, seat: s.seat }));
    return res;
  }

  /** 本节课请假的学号（上课了就按当节课实际考勤；还没上课就先按长期请假名单） */
  function leaveSet(cls) {
    const out = {};
    const d = cls.draft;
    if (d && d.att && Object.keys(d.att).length) {
      S.activeStudents(cls).forEach(sid => {
        const a = d.att[sid];
        if (a && a.status === 'leave') out[sid] = 1;
      });
      return out;
    }
    (cls.longLeave || []).forEach(sid => { out[sid] = 1; });
    return out;
  }

  /** 请假优先级最高（取消请假后自动批改的结论 / 手动改的结论都会恢复） */
  function applyLeave(cls, res) {
    const lv = leaveSet(cls);
    let dirty = false;
    res.statuses.forEach(x => {
      if (x.auto === undefined) x.auto = x.status;      // 兼容老数据
      const want = lv[x.sid] ? 'leave' : (x.manual || x.auto);
      if (want !== x.status) { x.status = want; dirty = true; }
    });
    if (dirty || !res.stat) recalcStat(res);
    return res;
  }

  /** 把结果写回当前状态与草稿 */
  function saveResult(cls, res) {
    res.clsId = cls.id;
    if (state.result && state.result.clsId === cls.id) state.result = res;
    if (cls.draft) cls.draft.homework = res;
    S.save();
  }
  V.analyze = analyze;
  A.homework = {
    analyze: analyze, STATUS: STATUS, STATUS_ORDER: STATUS_ORDER,
    buildName: buildName, labelOf: labelOf, typeShort: typeShort,
    applyLeave: applyLeave, recalcStat: recalcStat, leaveSet: leaveSet, statusText: statusText
  };

  /* ---------- 要求节点 ---------- */
  function newNode(kind) {
    return { id: U.uid(), kind: kind || 'file', name: '', count: 1, types: [], nameRules: [], children: [] };
  }
  /** 每个数量一个命名格：数量变了就补齐/裁掉 */
  function ensureRules(node) {
    node.count = Math.max(1, parseInt(node.count, 10) || 1);
    if (!Array.isArray(node.nameRules)) node.nameRules = node.nameRule ? [node.nameRule] : [];
    while (node.nameRules.length < node.count) node.nameRules.push(null);
    if (node.nameRules.length > node.count) node.nameRules.length = node.count;
    (node.children || []).forEach(ensureRules);
    return node;
  }
  function tplKey(cls) {
    const no = (cls.draft && cls.draft.termNo) || S.nextTermNo(cls);
    return A.term.gradeCode(cls.grade) + '-' + no;
  }

  /* ---------- 页面 ---------- */
  function render() {
    const cls = S.current();
    const root = document.getElementById('view-homework');
    if (!root) return;
    root.innerHTML = '';
    (cls.homeworkReq || []).forEach(ensureRules);

    // 同年级同一次课自动套模板
    const key = tplKey(cls);
    const db = S.load();
    if (!cls.homeworkReq.length && db.hwTemplates[key]) {
      cls.homeworkReq = JSON.parse(JSON.stringify(db.hwTemplates[key]));
      cls.homeworkReq.forEach(ensureRules);
      S.save();
      U.toast('已套用同年级第 ' + key.split('-')[1] + ' 次课的作业要求模板', 'ok');
    }

    root.appendChild(reqCard(cls, key));
    root.appendChild(upCard(cls));

    const res = (state.result && state.result.clsId === cls.id)
      ? state.result
      : (cls.draft && cls.draft.homework);
    if (!res) {
      root.appendChild(U.el('div', { class: 'card pad muted', text: '还没有上传作业。上传后这里按学号顺序显示每个人的提交情况：缺交 / 数量错误 / 命名错误 / 正确。' }));
      return;
    }
    root.appendChild(resultCard(cls, res));
  }
  V.homework = { render };
  V.renderHomework = render;

  /** 保存本节课后清空作业要求与上传结果，为下节课做准备 */
  V.resetHomework = function (cls) {
    cls = cls || S.current();
    state.result = null;
    state.filter = 'all';
    if (cls) {
      cls.homeworkReq = [];
      if (cls.draft) cls.draft.homework = null;
    }
    const view = document.getElementById('view-homework');
    if (view && !view.classList.contains('hidden')) render();
  };

  function reqCard(cls, key) {
    const db = S.load();
    const card = U.el('div', { class: 'card pad', id: 'hwReqCard', style: { marginBottom: '12px' } });
    const termNo = (cls.draft && cls.draft.termNo) || S.nextTermNo(cls);

    card.appendChild(U.el('div', { class: 'req-head' }, [
      U.el('h4', { class: 'section-title', style: { margin: '0', flex: '1' }, text: '作业要求 · 第 ' + termNo + ' 次课' }),
      U.el('button', { class: 'btn sm', text: '+ 文件', onclick: () => { cls.homeworkReq.push(newNode('file')); S.save(); render(); } }),
      U.el('button', { class: 'btn sm', text: '+ 文件夹', onclick: () => { cls.homeworkReq.push(newNode('dir')); S.save(); render(); } }),
      U.el('button', {
        class: 'btn sm ghost', text: '存为同年级模板',
        onclick: () => {
          db.hwTemplates[key] = JSON.parse(JSON.stringify(cls.homeworkReq));
          S.save(); U.toast('已保存：同年级其他班第 ' + termNo + ' 次课会自动套用', 'ok');
        }
      }),
      U.el('button', {
        class: 'btn sm ghost', text: '套用模板',
        onclick: () => {
          const t = db.hwTemplates[key];
          if (!t || !t.length) { U.toast('同年级第 ' + termNo + ' 次课还没有保存过模板', 'err'); return; }
          cls.homeworkReq = JSON.parse(JSON.stringify(t));
          cls.homeworkReq.forEach(ensureRules);
          S.save(); render(); U.toast('已套用模板', 'ok');
        }
      })
    ]));
    card.appendChild(U.el('div', { class: 'small muted', style: { margin: '4px 0 10px' }, html:
      cls.name + '（' + (cls.grade || '初一') + '）· 模板编号 <b>' + key + '</b>' + (db.hwTemplates[key] ? '（已保存）' : '（未保存）') +
      ' —— 同年级其他班上同一次课自动套用；保存本节课后要求会清空，下节课重新设置。' }));

    if (!cls.homeworkReq.length) {
      card.appendChild(U.el('div', { class: 'muted small', style: { marginBottom: '8px' }, text: '还没有要求。点“+ 文件 / + 文件夹”添加；不设置也能统计谁交了、谁没交（空文件夹算缺交）。' }));
      return card;
    }

    card.appendChild(U.el('div', { class: 'req-head-row' }, [
      U.el('span', { text: '要 求' }),
      U.el('span', { text: '类型 / 名称' }),
      U.el('span', { text: '数量' }),
      U.el('span', { text: '命名（每份一格，竖排）' })
    ]));
    nodeList(cls, cls.homeworkReq, 1, card, '学生文件夹');
    return card;
  }

  function nodeList(cls, nodes, level, box, where) {
    if (!nodes.length) return;
    const wrap = U.el('div', { class: 'req-level' });
    wrap.appendChild(U.el('div', { class: 'small muted', style: { margin: '4px 0' }, text: '第 ' + level + ' 层（在「' + where + '」里）' }));
    nodes.forEach((node, i) => wrap.appendChild(nodeRow(cls, nodes, node, i, level)));
    box.appendChild(wrap);
  }

  function nodeRow(cls, siblings, node, i, level) {
    ensureRules(node);
    const row = U.el('div', { class: 'req-node' });

    const kindSel = U.el('select', {
      class: 'input req-kind-sel',
      onchange: e => {
        node.kind = e.target.value;
        if (node.kind === 'file') { node.children = []; node.name = ''; node.types = node.types || []; }
        S.save(); render();
      }
    }, [
      U.el('option', { value: 'file', text: '文件', selected: node.kind !== 'dir' ? 'selected' : null }),
      U.el('option', { value: 'dir', text: '文件夹', selected: node.kind === 'dir' ? 'selected' : null })
    ]);

    const col2 = node.kind === 'dir'
      ? U.el('input', {
        class: 'input req-dirname', value: node.name, placeholder: '文件夹名称，如 截图',
        oninput: e => { node.name = e.target.value; S.save(); }
      })
      : U.el('button', {
        class: 'btn sm ghost req-type-btn', text: typeLabel(node.types),
        onclick: e => pickTypes(e.currentTarget, node)
      });

    const cnt = U.el('input', {
      class: 'input req-count', type: 'number', min: '1', max: '20', value: node.count,
      onchange: e => {
        node.count = Math.max(1, parseInt(e.target.value, 10) || 1);
        ensureRules(node); S.save(); render();
      }
    });

    row.appendChild(U.el('div', { class: 'req-row' }, [
      kindSel, col2,
      U.el('div', { class: 'req-count-cell' }, [cnt]),
      U.el('button', { class: 'btn sm danger req-del', text: '删除', onclick: () => { siblings.splice(i, 1); S.save(); render(); } })
    ]));

    /* 命名格：数量几个就竖着放几个 */
    const rules = U.el('div', { class: 'req-rules' });
    const sid = sampleSid(cls);
    for (let k = 0; k < node.count; k++) {
      const r = node.nameRules[k];
      const on = r && r.length;
      rules.appendChild(U.el('button', {
        class: 'req-rule-btn' + (on ? ' set' : ''),
        title: on ? ('例：' + buildName(cls, sid, r, k)) : '不检查命名',
        onclick: () => editRule(cls, node, k)
      }, [
        U.el('span', { class: 'rule-no', text: (k + 1) }),
        U.el('span', { text: on ? rulePattern(r) : '未设置（不检查）' })
      ]));
    }
    if (node.count > 1) {
      rules.appendChild(U.el('button', {
        class: 'btn sm ghost', style: { marginTop: '2px', alignSelf: 'flex-start' }, text: '其余都用第 1 个的命名',
        onclick: () => {
          const r0 = node.nameRules[0];
          for (let k = 1; k < node.count; k++) node.nameRules[k] = r0 ? JSON.parse(JSON.stringify(r0)) : null;
          S.save(); render();
        }
      }));
    }
    row.appendChild(rules);

    if (node.kind === 'dir') {
      row.appendChild(U.el('div', { class: 'btn-row', style: { marginTop: '4px' } }, [
        U.el('button', {
          class: 'btn sm ghost', text: '+ 在这个文件夹里再要求一项',
          onclick: () => {
            node.children = node.children || [];
            node.children.push(newNode('file'));
            S.save(); render();
          }
        })
      ]));
      if (node.children && node.children.length) {
        nodeList(cls, node.children, level + 1, row, node.name || '文件夹');
      }
    }
    return row;
  }

  function pickTypes(anchor, node) {
    const items = FILE_TYPES.map(t => ({
      label: (node.types.indexOf(t.key) >= 0 ? '✓ ' : '') + t.label + '（' + t.exts.join(' / ') + '）',
      on: () => {
        const i = node.types.indexOf(t.key);
        if (i >= 0) node.types.splice(i, 1); else node.types.push(t.key);
        S.save(); render();
      }
    }));
    items.push('-');
    items.push({ label: '不限类型（任何文件都算）', cls: 'grey', on: () => { node.types = []; S.save(); render(); } });
    U.popover(anchor, { title: '这个要求收哪些类型的文件？（可多选）', list: items });
  }

  /* 命名规则编辑：只编辑“第 k 个” */
  function editRule(cls, node, k) {
    const rule = (node.nameRules[k] || []).slice();
    const box = U.el('div', {});
    const listBox = U.el('div', { class: 'name-list', style: { marginBottom: '10px' } });
    const preview = U.el('div', { class: 'small', style: { marginTop: '6px' } });
    function refresh() {
      listBox.innerHTML = '';
      if (!rule.length) listBox.appendChild(U.el('span', { class: 'muted small', text: '（不检查命名）' }));
      rule.forEach((p, i) => {
        const t = NAME_TOKENS.find(x => x.t === p.t);
        listBox.appendChild(U.el('span', { class: 'name-tag blue' }, [
          U.el('span', { text: t ? t.label : p.v }),
          U.el('span', { class: 'x', text: '×', onclick: () => { rule.splice(i, 1); refresh(); } })
        ]));
      });
      preview.textContent = rule.length
        ? ('第 ' + (k + 1) + ' 个应为：' + buildName(cls, sampleSid(cls), rule, k))
        : '不检查命名';
    }
    const textInput = U.el('input', { class: 'input', placeholder: '自定义文字，如 春', style: { width: '130px' } });
    box.appendChild(U.el('div', { class: 'small muted', text: '依次点按钮拼文件名（比对时忽略大小写和空格）；“序号”用来自动区分第几份。' }));
    box.appendChild(U.el('div', { class: 'btn-row', style: { margin: '8px 0' } },
      NAME_TOKENS.map(t => U.el('button', {
        class: 'btn sm', text: t.label + (t.t === 'grade' ? '（' + A.term.gradeCode(cls.grade) + '）' : (t.t === 'class' ? '（' + U.pad2(parseInt(cls.classNo, 10) || 1) + '）' : '')),
        title: t.hint || '',
        onclick: () => { rule.push({ t: t.t }); refresh(); }
      })).concat([
        textInput,
        U.el('button', {
          class: 'btn sm primary', text: '加文字',
          onclick: () => {
            const v = textInput.value.trim();
            if (!v) { U.toast('先输入文字', 'err'); return; }
            rule.push({ t: 'text', v: v }); textInput.value = ''; refresh();
          }
        })
      ])));
    box.appendChild(listBox);
    box.appendChild(preview);
    refresh();
    U.modal({
      title: '命名 · 第 ' + (k + 1) + ' 个' + (node.kind === 'dir' ? '（文件夹）' : ''),
      body: box,
      buttons: [
        { label: '清除这一格', onClick: () => { node.nameRules[k] = null; S.save(); render(); } },
        { label: '确定', cls: 'primary', onClick: () => { node.nameRules[k] = rule.length ? rule : null; S.save(); render(); } }
      ]
    });
  }

  /* ---------- 上传 ---------- */
  function walkEntry(entry, prefix, out) {
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(f => { out.push({ path: prefix + entry.name, file: f }); resolve(); }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const readBatch = () => reader.readEntries(batch => {
          if (!batch.length) {
            Promise.all(all.map(e => walkEntry(e, prefix + entry.name + '/', out))).then(() => resolve());
            return;
          }
          all.push.apply(all, batch);
          readBatch();
        }, () => resolve());
        readBatch();
      } else resolve();
    });
  }
  async function readDropped(dt) {
    const out = [];
    const items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    for (const it of items) {
      const e = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (e) await walkEntry(e, '', out);
    }
    if (!out.length && dt.files) {
      Array.prototype.slice.call(dt.files).forEach(f => out.push({ path: (f.webkitRelativePath || f.name), file: f }));
    }
    return out;
  }

  function upCard(cls) {
    const room = A.rooms.get(cls);
    const card = U.el('div', { class: 'card pad', style: { marginBottom: '12px' } });
    const drop = U.el('div', { class: 'drop', html:
      '<b>点击选择 或 把整个班的作业文件夹拖到这里</b><br><span class="small">学生文件夹命名：' +
      A.rooms.folderOf(room, 'A01') + '、' + A.rooms.folderOf(room, 'B07') +
      '（' + (room ? room.name : '机房') + '：室号+列+行号；命名不规矩的可以在“机房管理”里登记别名）</span>' });
    drop.onclick = () => pick(false);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('over');
      if (!e.dataTransfer) return;
      const files = await readDropped(e.dataTransfer);
      if (!files.length) { U.toast('没有读取到文件', 'err'); return; }
      handle(cls, files.map(f => f.path));
    });
    card.appendChild(drop);
    card.appendChild(U.el('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
      U.el('button', { class: 'btn sm', text: '选择作业文件夹', onclick: () => pick(true) }),
      U.el('button', { class: 'btn sm', text: '上传 zip 压缩包', onclick: pickZip }),
      U.el('button', {
        class: 'btn sm ghost', text: '清除本次结果', onclick: () => {
          state.result = null;
          if (cls.draft) cls.draft.homework = null;
          S.save(); render();
        }
      })
    ]));
    return card;
  }

  async function pick(directory) {
    const files = await U.pickFile('', true, directory);
    if (!files.length) return;
    handle(S.current(), files.map(f => f.webkitRelativePath || f.name));
  }
  async function pickZip() {
    const files = await U.pickFile('.zip,application/zip', false, false);
    if (!files.length) return;
    try {
      const names = await A.zip.listNames(await files[0].arrayBuffer());
      handle(S.current(), names.map(n => n.replace(/^\//, '')));
    } catch (e) { U.toast('压缩包读取失败：' + e.message, 'err'); }
  }

  function handle(cls, paths) {
    const res = analyze(cls, paths);
    state.result = res;
    state.filter = 'all';
    A.views.ensureDraft(cls, true);
    saveResult(cls, res);
    render();
    U.toast('已分析：正确 ' + res.stat.ok + ' · 命名错误 ' + res.stat.name +
      ' · 数量错误 ' + res.stat.count + ' · 缺交 ' + res.stat.missing +
      (res.stat.leave ? ' · 请假 ' + res.stat.leave : ''), 'ok');
    // 老师时常忘了写作业要求：传完先确认一下（已经设过要求、或同年级模板自动套用了，就不再打扰）
    if (!(cls.homeworkReq || []).length) setTimeout(() => askReq(cls), 500);
    // 老师多半是在“保存前被提醒”才过来传作业的，传完顺手告诉他下一步
    if (cls.draft && cls.draft.ended) {
      setTimeout(() => U.toast('传完了 —— 回“课堂记录”页点“保存本节课数据”', 'ok'), 600);
    }
  }

  /** 上传完作业后的确认：这次有没有作业要求忘了设 */
  function askReq(cls) {
    const box = U.el('div', {});
    box.appendChild(U.el('p', { style: { margin: '0 0 8px' }, text:
      '这次上传的作业还没有“作业要求”，系统现在只能看出谁交了、谁没交，看不出命名对不对、数量够不够。' }));
    box.appendChild(U.el('p', { class: 'small muted', style: { margin: '0 0 8px' }, text:
      '如果这节课确实没有别的作业要求（比如只要交一个文件就行），选“没有要求”即可，不影响批改结果，也不影响总评。' }));
    box.appendChild(U.el('div', { class: 'small muted', text:
      '补上要求以后回到本页点“重新批改”，不用重新上传文件。' }));
    U.modal({
      title: '作业要求设置了吗？',
      body: box,
      buttons: [
        { label: '没有要求，就这样', cls: 'primary' },
        {
          label: '去写作业要求', onClick: () => {
            const card = document.getElementById('hwReqCard');
            if (!card) { U.toast('在页面最上面的“作业要求”里添加', 'err'); return; }
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('flash');
            setTimeout(() => card.classList.remove('flash'), 1600);
            U.toast('点“+ 文件 / + 文件夹”写要求，写完回下面点“重新批改”');
          }
        }
      ]
    });
  }

  /* ---------- 结果 ---------- */
  /** 用当前作业要求重新批改一次（忘了先设要求就上传时，设好后点它） */
  function recheck(cls) {
    const res = (state.result && state.result.clsId === cls.id)
      ? state.result
      : (cls.draft && cls.draft.homework);
    if (!res) { U.toast('还没有上传作业', 'err'); return; }
    if (!res.paths || !res.paths.length) {
      U.toast('找不到上次上传的文件清单，请重新上传一次作业', 'err');
      return;
    }
    if (!(cls.homeworkReq || []).length) {
      U.toast('先在上面设置作业要求，再点“重新批改”', 'err');
      return;
    }
    const fresh = analyze(cls, res.paths);
    fresh.at = U.nowTime();
    fresh.date = U.today();
    fresh.paths = res.paths.slice();
    state.result = fresh;
    state.filter = state.filter || 'all';
    A.views.ensureDraft(cls, true);
    saveResult(cls, fresh);
    render();
    U.toast('已按新的作业要求重新批改：正确 ' + fresh.stat.ok + ' · 命名错误 ' + fresh.stat.name +
      ' · 数量错误 ' + fresh.stat.count + ' · 缺交 ' + fresh.stat.missing +
      (fresh.stat.leave ? ' · 请假 ' + fresh.stat.leave : ''), 'ok');
  }
  V.recheck = recheck;

  /** 状态那一格：点下拉可手动改；手动改过的前面标 *，和自动批改的结论区分开 */
  function statusCell(cls, res, s) {
    if (leaveSet(cls)[s.sid]) {
      return U.el('span', {
        class: 'pill blue', text: STATUS.leave.text,
        title: '该生本节课请假，作业按请假计（不算缺交、不算异常、总评不扣分）；取消请假后自动批改的结论会恢复'
      });
    }
    const opts = [{ v: '', t: '自动' }].concat(
      STATUS_ORDER.filter(k => k !== 'leave').map(k => ({ v: k, t: STATUS[k].text })));
    const sel = U.el('select', {
      class: 'mini-sel',
      title: '手动改了会在前面标 *（自动批改的结论：' + (STATUS[s.auto] || STATUS.ok).text + '）',
      onchange: e => {
        s.manual = e.target.value;
        applyLeave(cls, res);
        saveResult(cls, res);
        render();
      }
    }, opts.map(o => U.el('option', {
      value: o.v, text: o.t, selected: (s.manual || '') === o.v ? 'selected' : null
    })));
    sel.value = s.manual || s.auto || 'ok';
    return U.el('span', { class: 'hw-status-cell' }, [
      s.manual ? U.el('b', {
        class: 'star', text: '*',
        title: '老师手动修改过；自动批改的结论是「' + (STATUS[s.auto] || STATUS.ok).text + '」'
      }) : null,
      sel
    ]);
  }

  function resultCard(cls, res) {
    applyLeave(cls, res);                    // 每次渲染都按最新考勤刷新一次“请假”
    const card = U.el('div', { class: 'card pad' });
    const st = res.stat;
    const manualN = res.statuses.filter(x => x.manual).length;
    const chips = [
      U.el('span', { class: 'chip', html: '应交 <b>' + st.total + '</b>' }),
      U.el('span', { class: 'chip', html: '<b style="color:#16a34a">正确 ' + st.ok + '</b>' }),
      U.el('span', { class: 'chip', html: '<b style="color:#a855f7">命名错误 ' + st.name + '</b>' }),
      U.el('span', { class: 'chip', html: '<b style="color:#ea8c0b">数量错误 ' + st.count + '</b>' }),
      U.el('span', { class: 'chip', html: '<b style="color:#dc2626">缺交 ' + st.missing + '</b>' }),
      st.leave ? U.el('span', { class: 'chip', html: '<b style="color:#2563eb">请假 ' + st.leave + '</b>' }) : null,
      manualN ? U.el('span', { class: 'chip', html: '<b>手动改 ' + manualN + '</b>' }) : null
    ].filter(Boolean);
    card.appendChild(U.el('div', { class: 'req-head', style: { marginBottom: '10px' } }, [
      U.el('h4', { class: 'section-title', style: { margin: '0', flex: '1' }, text: '提交情况（' + res.at + '）' })
    ].concat(chips).concat([
      U.el('button', {
        class: 'btn sm', text: '重新批改',
        title: '改完上面的作业要求后点这里，按新要求把上次上传的文件重算一遍（不用再传一次）',
        onclick: () => recheck(cls)
      }),
      U.el('button', { class: 'btn sm ghost', text: '导出 CSV', onclick: () => exportCsv(cls, res) })
    ])));

    // 状态筛选
    const filterRow = U.el('div', { class: 'btn-row', style: { marginBottom: '10px' } });
    const put = (key, label, n) => filterRow.appendChild(U.el('button', {
      class: 'btn sm ' + (state.filter === key ? 'primary' : 'ghost'),
      text: label + ' ' + n,
      onclick: () => { state.filter = key; render(); }
    }));
    put('all', '全部', st.total);
    STATUS_ORDER.forEach(k => put(k, STATUS[k].text, st[k] || 0));
    card.appendChild(filterRow);

    if (res.unknown.length) {
      const ub = U.el('div', { class: 'small', style: { marginBottom: '8px', color: '#9a3412' } }, [
        U.el('span', { text: '没认出来的文件夹（点一下可登记成某个座位）：' })
      ]);
      res.unknown.forEach(u => {
        ub.appendChild(U.el('span', {
          class: 'name-tag', style: { marginLeft: '6px', cursor: 'pointer' }, text: u.folder,
          onclick: () => assignAlias(cls, u.folder)
        }));
      });
      card.appendChild(ub);
    }

    const rows = [];
    res.statuses.slice()
      .filter(s => state.filter === 'all' || s.status === state.filter)
      .sort((a, b) => a.sid - b.sid)
      .forEach(s => {
        const isLeave = s.status === 'leave';
        rows.push(U.el('tr', { class: (s.status === 'ok' || isLeave) ? '' : 'bad' }, [
          U.el('td', { text: String(s.sid) }),
          U.el('td', { text: SE.name(cls, s.sid) || '—' }),
          U.el('td', { text: s.seat || '—' }),
          U.el('td', { text: s.folder || '—' }),
          U.el('td', { class: 'small submitted', text: s.submitted || '—' }),
          U.el('td', {}, [statusCell(cls, res, s)]),
          U.el('td', {
            class: 'small',
            text: isLeave ? '本节课请假，作业按请假计（不计缺交、不扣分）'
              : (s.detail && s.detail.length ? s.detail.join('；') : '—')
          })
        ]));
      });

    card.appendChild(U.el('div', { class: 'small muted', style: { marginBottom: '6px' }, html:
      '“状态”一格可以直接点开改 —— 手动改过的会在前面标 <b class="star">*</b>，' +
      '方便和自动批改的结论区分；请假的同学按<b>请假</b>计，不计缺交、不算作业异常、总评也不扣分。' }));
    card.appendChild(U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'grid' }, [
        U.el('thead', {}, [U.el('tr', {}, ['学号', '姓名', '座位', '文件夹', '已提交内容', '状态（可手动改）', '说明'].map(t => U.el('th', { text: t })))]),
        U.el('tbody', {}, rows.length ? rows : [U.el('tr', {}, [U.el('td', { class: 'muted', colSpan: '7', text: '该状态下没有学生' })])])
      ])
    ]));
    return card;
  }

  /** 把没认出来的文件夹登记成某个座位（写进机房的别名表，以后都认得） */
  function assignAlias(cls, folder) {
    const room = A.rooms.get(cls);
    if (!room) { U.toast('找不到机房设置', 'err'); return; }
    const grid = U.el('div', { class: 'stu-pick' });
    let m = null;
    SE.allIds().forEach(seat => {
      grid.appendChild(U.el('button', {
        class: (cls.seats[seat] ? '' : 'ghost'),
        text: seat + (cls.seats[seat] ? '（' + cls.seats[seat] + '号）' : '（空）'),
        onclick: () => {
          room.alias[seat] = folder;
          S.save();
          if (m) m.close();
          U.toast(seat + ' 的作业文件夹已登记为「' + folder + '」，以后都按这个识别', 'ok');
          const res = state.result;
          if (res) {
            const paths = [];
            res.subs.concat(res.unknown).forEach(s => {
              (s.entries || []).forEach(e => paths.push(s.folder + '/' + e.rel));
            });
            handle(cls, paths);
          } else render();
        }
      }));
    });
    m = U.modal({
      title: '「' + folder + '」是哪个座位？',
      body: U.el('div', {}, [
        U.el('div', { class: 'small muted', style: { marginBottom: '8px' }, text: '登记后进机房管理也能看到；以后上传作业都按这个对应。' }),
        grid
      ]),
      buttons: [{ label: '关闭' }]
    });
  }

  /** 状态文字：手动改过的加 * 前缀（导出时也保留这个标记） */
  function statusText(s) {
    return (s.manual ? '*' : '') + (STATUS[s.status] || STATUS.ok).text;
  }

  function exportCsv(cls, res) {
    const lines = ['学号,姓名,座位,文件夹,已提交内容,状态,说明'];
    res.statuses.slice().sort((a, b) => a.sid - b.sid).forEach(s => {
      lines.push([s.sid, SE.name(cls, s.sid) || '', s.seat || '', s.folder || '', s.submitted || '',
        statusText(s),
        s.status === 'leave' ? '本节课请假，作业按请假计' : (s.detail || []).join('；')]
        .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
    });
    U.download('作业提交-' + cls.name + '-' + res.date + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv');
  }

})(window.App);
