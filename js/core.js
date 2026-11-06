/* 机房课堂管理系统 - 核心层：工具、存储、座位计算、文件解析 */
window.App = window.App || {};
(function (A) {
  'use strict';

  /* 页面版本号：直接取自 index.html 里 <script src="js/core.js?v=xxx">，改版本号只需改一处。
     顶栏会显示它 —— 如果显示的不是最新版本，说明浏览器还在用旧缓存（Ctrl+F5）。 */
  try {
    const me = document.querySelector('script[src*="js/core.js"]');
    const src = me ? (me.getAttribute('src') || me.src || '') : '';
    const m = /\?v=([\w.-]+)/.exec(src);
    A.version = m ? m[1] : '';
  } catch (e) { A.version = ''; }
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('appVer');
    if (el && A.version) el.textContent = 'v' + A.version;
  });

  /* ---------------- 通用工具 ---------------- */
  const U = A.util = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  U.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'value') { node.setAttribute('value', v); if ('value' in node) node.value = v; }
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  U.esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  U.pad2 = n => (n < 10 ? '0' : '') + n;

  U.today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };
  U.nowTime = () => {
    const d = new Date();
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  U.toast = function (msg, type) {
    const wrap = document.getElementById('toast');
    const t = U.el('div', { class: 'toast ' + (type || ''), text: msg });
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; }, 2200);
    setTimeout(() => t.remove(), 2600);
  };

  /* 弹出式菜单 */
  U.popover = function (anchor, items) {
    U.closePopover();
    const pop = document.getElementById('popover');
    pop.innerHTML = '';
    if (items.title) pop.appendChild(U.el('div', { class: 'pop-title', text: items.title }));
    items.list.forEach(it => {
      if (it === '-') { pop.appendChild(U.el('div', { class: 'pop-sep' })); return; }
      // 带内嵌控件（如“− 3 +”）的项不能用 button 包 button，改用 div，且不点关闭
      const tag = it.node ? 'div' : 'button';
      const btn = U.el(tag, {
        class: 'pop-item ' + (it.cls || ''),
        onclick: () => { if (!it.node) U.closePopover(); it.on && it.on(); }
      }, [
        U.el('span', { text: it.label }),
        it.node || null,
        it.key ? U.el('span', { class: 'key', text: it.key }) : null
      ]);
      pop.appendChild(btn);
    });
    if (items.node) pop.appendChild(items.node);   // 菜单里可以带自定义内容（如直接填写的输入框）
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.left + window.scrollX;
    let top = r.bottom + window.scrollY + 4;
    if (left + pw > window.scrollX + document.documentElement.clientWidth - 8) {
      left = window.scrollX + document.documentElement.clientWidth - pw - 8;
    }
    if (top + ph > window.scrollY + document.documentElement.clientHeight - 8) {
      top = r.top + window.scrollY - ph - 4;
    }
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
    if (items.focus !== false) {
      const inp = pop.querySelector('input, textarea');
      if (inp) setTimeout(() => inp.focus(), 0);
    }
    if (items.onKey) {
      pop._keyHandler = e => {
        const k = e.key.toLowerCase();
        const hit = items.list.find(x => x && x.key && x.key.toLowerCase() === k);
        if (hit) { e.preventDefault(); U.closePopover(); hit.on && hit.on(); }
      };
      document.addEventListener('keydown', pop._keyHandler);
    }
    setTimeout(() => {
      document.addEventListener('mousedown', U._popOutside);
    }, 0);
  };
  U._popOutside = function (e) {
    const pop = document.getElementById('popover');
    if (pop && !pop.contains(e.target)) U.closePopover();
  };
  U.closePopover = function () {
    const pop = document.getElementById('popover');
    if (!pop) return;
    pop.classList.add('hidden');
    if (pop._keyHandler) { document.removeEventListener('keydown', pop._keyHandler); pop._keyHandler = null; }
    document.removeEventListener('mousedown', U._popOutside);
  };

  /* 模态框：body 可为 DOM 节点；返回控制器 */
  U.modal = function (opts) {
    // 每次新建容器，支持弹窗叠加（如在编辑框里再打开选人框），关闭时只关最上层
    const root = U.el('div', { class: 'modal-root' });
    document.body.appendChild(root);
    const foot = U.el('div', { class: 'modal-foot' });
    const box = U.el('div', { class: 'modal' + (opts.wide ? ' wide' : '') }, [
      U.el('div', { class: 'modal-head', text: opts.title || '' }),
      U.el('div', { class: 'modal-body' }, [typeof opts.body === 'string' ? U.el('div', { html: opts.body }) : opts.body]),
      foot
    ]);
    const close = () => { root.remove(); };
    (opts.buttons || [{ label: '关闭' }]).forEach(b => {
      foot.appendChild(U.el('button', {
        class: 'btn ' + (b.cls || ''),
        text: b.label,
        onclick: () => { if (!b.onClick || b.onClick(box) !== false) close(); }
      }));
    });
    root.appendChild(box);
    root.classList.remove('hidden');
    root.onclick = e => { if (e.target === root) close(); };
    if (opts.onOpen) opts.onOpen(box);
    return { close, box };
  };

  U.confirm = function (msg, onYes, title) {
    U.modal({
      title: title || '请确认',
      body: U.el('div', { text: msg }),
      buttons: [
        { label: '取消' },
        { label: '确定', cls: 'danger', onClick: () => { onYes && onYes(); } }
      ]
    });
  };

  U.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  U.pickFile = function (accept, multiple, directory) {
    return new Promise(resolve => {
      const input = document.getElementById('hiddenFile');
      input.value = '';
      input.accept = accept || '';
      input.multiple = !!multiple;
      if (directory) { input.setAttribute('webkitdirectory', ''); input.setAttribute('directory', ''); }
      else { input.removeAttribute('webkitdirectory'); input.removeAttribute('directory'); }
      input.onchange = () => resolve(Array.prototype.slice.call(input.files || []));
      input.oncancel = () => resolve([]);
      input.click();
    });
  };

  /* ---------------- 存储层 ---------------- */
  const KEY = 'itlab-class-system-v1';
  const S = A.store = {};
  S.available = true;

  /** 班级名不再手填：年级 + 班号，如 初一（12）班 */
  S.classNameOf = function (grade, classNo) {
    return (grade || '初一') + '（' + (parseInt(classNo, 10) || 1) + '）班';
  };

  function blankClass(name, grade, classNo) {
    return {
      id: 'c_' + U.uid(),
      name: name || S.classNameOf(grade, classNo),
      grade: grade || '初一',       // 初一 / 初二（作业命名用 c1 / c2）
      classNo: parseInt(classNo, 10) || 1,   // 班级号 1-21
      room: '1',           // 机房室号 1-3（作业文件夹前缀）
      studentCount: 54,
      sidList: null,       // 花名册导入的真实学号清单（学号与人数可能不相等，如最大 54 号但只有 52 人）
      maxSid: 0,           // 名单里最大的学号（没有清单时兜底用）
      seats: {},           // 座位ID -> 学号
      broken: {},          // 座位ID -> true（电脑不可用，长期记住）
      seatFix: {},         // 学号 -> 座位ID（因“电脑不可用”而长期改到的座位）
      lastSeats: null,     // 上一节课结束时的座次（座位ID -> 学号），用于下一节课安排有问题的座位
      longLeave: [],       // 长期请假的学号（下一次考勤默认标“未回校”）
      transferred: [],     // 已转学的学号（不排座、不计入应到）
      roster: {},          // 学号(字符串) -> 姓名
      homeworkReq: [],     // 树形作业要求：[{id,kind,name,count,types,nameRule,children}]
      lessonCount: 0,
      exam: {},            // 学号(字符串) -> 考试成绩
      gradeFix: {},        // 学号(字符串) -> 老师手动改过的等级（有值就不再按占比自动算）
      draft: null,
      records: []
    };
  }

  /** 学年：9 月及以后算新学年 */
  function currentSchoolYear() {
    const d = new Date();
    const y = d.getFullYear();
    return (d.getMonth() >= 8) ? (y + '-' + (y + 1)) : ((y - 1) + '-' + y);
  }
  function defaultRooms() {
    return [1, 2, 3].map(n => ({
      id: 'r_' + n, no: String(n), name: n + ' 号机房',
      alias: {},          // 座位ID -> 实际文件夹名（命名不规律时在这里改）
      broken: []          // [{seat, from:'2026-09-01', to:''}]  to 为空表示至今
    }));
  }
  function defaults() {
    const c = blankClass(S.classNameOf('初一', 1), '初一', 1);
    A.seats.autoArrange(c, true);
    return {
      version: 2,
      currentClassId: c.id,
      classes: [c],
      rooms: defaultRooms(),
      term: { schoolYear: currentSchoolYear(), semester: 1 },
      archive: [],        // 已归档的学期 [{id,schoolYear,semester,at,classes,rooms}]
      hwTemplates: {},    // 'c1-6' -> 作业要求树（同年级同一次课复用）
      lessonTopics: {},   // 'c1-6' -> 本节课课题（同年级同一次课自动沿用）
      finalCfg: {         // 期末总评设置
        weights: { perf: 30, hw: 30, exam: 40 },
        grades: [{ name: '优秀', pct: 30 }, { name: '良好', pct: 40 }, { name: '合格', pct: 20 }, { name: '待合格', pct: 10 }]
      }
    };
  }

  let db = null;
  S.load = function () {
    if (db) return db;
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : defaults();
    } catch (e) {
      S.available = false;
      db = defaults();
    }
    if (!db.classes || !db.classes.length) db = defaults();
    if (!db.rooms || !db.rooms.length) db.rooms = defaultRooms();
    if (!db.term) db.term = { schoolYear: currentSchoolYear(), semester: 1 };
    if (!db.archive) db.archive = [];
    if (!db.hwTemplates) db.hwTemplates = {};
    if (!db.lessonTopics) db.lessonTopics = {};
    if (!db.finalCfg) {
      db.finalCfg = {
        weights: { perf: 30, hw: 30, exam: 40 },
        grades: [{ name: '优秀', pct: 30 }, { name: '良好', pct: 40 }, { name: '合格', pct: 20 }, { name: '待合格', pct: 10 }]
      };
    }
    if (!db.finalCfg.weights) db.finalCfg.weights = { perf: 30, hw: 30, exam: 40 };
    if (!db.finalCfg.grades || !db.finalCfg.grades.length) {
      db.finalCfg.grades = [{ name: '优秀', pct: 30 }, { name: '良好', pct: 40 }, { name: '合格', pct: 20 }, { name: '待合格', pct: 10 }];
    }
    db.rooms.forEach(r => { r.alias = r.alias || {}; r.broken = r.broken || []; });
    db.classes.forEach(c => {
      c.broken = c.broken || {};
      c.seatFix = c.seatFix || {};
      c.longLeave = c.longLeave || [];
      c.transferred = c.transferred || [];
      c.roster = c.roster || {};
      c.homeworkReq = c.homeworkReq || [];
      c.records = c.records || [];
      if (c.tagsV !== 2) {
        // 第 1 版标签（黄/橙/隐藏 + ⅓红渐变）迁移到第 2 版（¼ 分档 · 左右渐变）
        const t1 = c.tags || {};
        const t2 = {};
        Object.keys(t1).forEach(k => {
          const o = t1[k] || {};
          let r = 0;
          if (o.r === 1 || o.r === '1h') r = 1;
          else if (o.r === 2) r = 2;
          else if (o.r === 3) r = 4;            // 旧「持续全红」→ 新「全红」
          else r = parseInt(o.r, 10) || 0;
          const od = parseInt(o.d, 10) || 0;
          // 旧版「全橙 / 全橙已隐藏」= 值日已经满 4 次，在新版等同于已转红
          if (od >= 4) r = Math.max(r, 1);
          t2[k] = { d: Math.min(4, od), r: r, rb: r === 4 ? (parseInt(o.rb, 10) || 0) : 0 };
        });
        c.tags = t2;
        c.tagsV = 2;
      }
      c.teacher = c.teacher || '';    // 任教老师（班级管理分组用）
      c.exam = c.exam || {};
      c.gradeFix = c.gradeFix || {};
      if (c.grade === undefined) c.grade = '初一';
      if (c.classNo === undefined) c.classNo = 1;
      if (c.room === undefined) c.room = '1';
      // 名称统一按“年级（班号）班”生成，旧的默认名（班级 1）自动改名
      if (!c.name || /^班级\s*\d+\s*班?$/.test(c.name)) c.name = S.classNameOf(c.grade, c.classNo);
      c.room = String(c.room);
      // 旧的作业要求（{name,type}）升级为树形节点；命名从“每项一条”改为“每份一条”
      const fixNode = n => {
        if (!n || typeof n !== 'object') return { id: U.uid(), kind: 'file', name: '', count: 1, types: [], nameRules: [], children: [] };
        if (!n.kind) n.kind = n.type === 'dir' ? 'dir' : 'file';
        n.count = Math.max(1, parseInt(n.count, 10) || 1);
        n.types = n.types || [];
        if (!Array.isArray(n.nameRules)) n.nameRules = n.nameRule ? [n.nameRule] : [];
        while (n.nameRules.length < n.count) n.nameRules.push(null);
        n.children = (n.children || []).map(fixNode);
        if (!n.id) n.id = U.uid();
        return n;
      };
      c.homeworkReq = (c.homeworkReq || []).map(fixNode);
      if (!c.seats || !Object.keys(c.seats).length) A.seats.autoArrange(c, true);
      if (c.draft && c.draft.ended === undefined) { c.draft.ended = false; c.draft.time = c.draft.time || ''; }
      // 旧记录字段升级
      c.records.forEach(r => {
        if (r.termNo === undefined) r.termNo = r.lessonNo || 0;
        r.absent = r.absent || [];
        r.late = (r.late || []).map(l => ({ sid: l.sid, min: l.min || 0 }));
        r.leave = (r.leave || []).map(l => ({ sid: l.sid, type: (l.type === 's' ? 'q' : (l.type || 'q')) }));
        if (!r.missing) {
          r.missing = r.homework ? (r.homework.missing || []).map(x => (typeof x === 'object' ? x.sid : x)) : [];
        }
        if (!r.stats) {
          r.stats = {
            total: c.studentCount || 0,
            present: (c.studentCount || 0) - r.absent.length - r.leave.length,
            absent: r.absent.length, late: r.late.length, leave: r.leave.length, missing: r.missing.length
          };
        }
        if (r.stats.missing === undefined) r.stats.missing = r.missing.length;
        if (!r.early) r.early = [];
        if (!r.violations) r.violations = [];
        if (!r.awards) r.awards = [];
        if (r.topic === undefined) r.topic = '';
        if (!r.hwStatus) r.hwStatus = [];
        if (r.stats.viol === undefined) r.stats.viol = r.violations.length;
        if (r.stats.award === undefined) {
          r.stats.award = r.awards.length;
          r.stats.awardItem = r.awards.reduce((n, a) => n + (a.list || []).length, 0);
        }
      });
      // 「已上 N 节」必须和实际记录一致。删过记录的班级在旧版本里这个数没退回来，
      // 每次加载都按记录里最大的“第几次课”重算一遍，顺手把历史遗留的错值修掉。
      c.lessonCount = c.records.reduce((m, r) => Math.max(m, r.termNo || 0), 0);
      // 旧版本直接写在班级上的“电脑不可用”标记，迁到机房记录里
      Object.keys(c.broken || {}).forEach(seat => {
        const room = A.rooms.byNo(c.room);
        if (room && !room.broken.some(b => b.seat === seat)) {
          room.broken.push({ seat: seat, from: '', to: '' });
        }
      });
      A.seats.syncBroken(c);
    });
    // 任课老师：单独维护一份名单（班级上的 teacher 只是归属标记，不在班级里填）
    db.teachers = db.teachers || [];
    db.classes.forEach(c => {
      const t = String(c.teacher || '').trim();
      if (t && db.teachers.indexOf(t) < 0) db.teachers.push(t);   // 旧数据里写在班上的老师，收进名单
    });
    // 班级顺序：默认按“年级 → 班级号”，老师手动调过就一直保持他排的顺序
    db.classSortManual = !!db.classSortManual;
    db.showTags = !!db.showTags;                   // 考勤页色标显示开关（下课保存后自动回隐藏）
    db.groupCollapsed = db.groupCollapsed || {};   // 班级管理按老师分组时各组的收起状态
    if (!db.classSortManual) db.classes.sort(defaultClassCompare);
    if (!db.classes.some(c => c.id === db.currentClassId)) db.currentClassId = db.classes[0].id;
    return db;
  };
  S.save = function () {
    if (!db) return;
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { S.available = false; U.toast('本地存储写入失败，请及时备份数据', 'err'); }
    // 本地仍是第一落点（断网也能用），云端由适配层去抖后异步推送
    if (A.cloud && A.cloud.touch) A.cloud.touch();
  };
  S.raw = () => db;
  /** 本机以前是否真的存过数据（用来判断“这台设备是不是全新的”，避免把空数据顶到云端） */
  S.hasLocalData = function () {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  };
  S.setRaw = obj => { db = obj; S.save(); };
  /** 云端拉下来的整库数据：先塞进本地缓存，再清空内存重走一遍 S.load()。
      不能直接赋值 —— 那样会跳过 schema 迁移、默认字段补齐、班级排序这些逻辑。 */
  S.applyRemote = function (obj) {
    if (!obj || typeof obj !== 'object') return;
    try { localStorage.setItem(KEY, JSON.stringify(obj)); }
    catch (e) { S.available = false; }
    db = null;
    S.load();
  };
  S.current = function () {
    const d = S.load();
    return d.classes.find(c => c.id === d.currentClassId) || d.classes[0];
  };
  S.newClass = blankClass;
  S.exportJSON = function () { return JSON.stringify(S.load(), null, 2); };

  /* ---------------- 班级顺序 ----------------
     默认：先按年级（初一 → 初二 → 初三 → …），同年级再按班级号。
     老师手动调整过（拖拽或上移/下移）就记住他的顺序，之后新加的班放到最后；
     点“恢复默认顺序”又回到按年级班级排。 */
  const GRADE_ORDER = ['初一', '初二', '初三', '高一', '高二', '高三'];
  S.gradeRank = function (grade) {
    const i = GRADE_ORDER.indexOf(String(grade || ''));
    return i < 0 ? 99 : i;
  };
  function defaultClassCompare(a, b) {
    const d = S.gradeRank(a.grade) - S.gradeRank(b.grade);
    if (d) return d;
    const na = parseInt(a.classNo, 10) || 0;
    const nb = parseInt(b.classNo, 10) || 0;
    if (na !== nb) return na - nb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
  }
  S.defaultClassCompare = defaultClassCompare;
  /** 没手动调过就重排一遍（改年级/班级号、新加班之后调用） */
  S.autoSortClasses = function () {
    const d = S.load();
    if (!d.classSortManual) { d.classes.sort(defaultClassCompare); S.save(); }
    return d.classes;
  };
  /** 把第 from 个班挪到第 to 个位置（班级管理页的上移/下移、拖拽都走这里） */
  S.moveClassTo = function (from, to) {
    const d = S.load();
    const n = d.classes.length;
    from = parseInt(from, 10); to = parseInt(to, 10);
    if (isNaN(from) || isNaN(to) || from === to || from < 0 || from >= n) return d.classes;
    to = Math.max(0, Math.min(n - 1, to));
    const item = d.classes.splice(from, 1)[0];
    d.classes.splice(to, 0, item);
    d.classSortManual = true;      // 老师自己排过了，以后不再自动按年级班级排
    S.save();
    return d.classes;
  };
  /** 恢复默认顺序：按年级 → 班级号 */
  S.resetClassOrder = function () {
    const d = S.load();
    d.classes.sort(defaultClassCompare);
    d.classSortManual = false;
    S.save();
    return d.classes;
  };

  /* 第几次课 = 已有记录里最大的一次 + 1（删了记录就退回重算） */
  S.nextTermNo = function (cls) {
    let max = 0;
    (cls.records || []).forEach(r => { if ((r.termNo || 0) > max) max = r.termNo; });
    return max + 1;
  };
  /**
   * 该班实际要考虑的学生学号（已排除转学）。
   * 有花名册就严格按花名册里的学号走 —— 人数和学号可以不相等（比如最后学号 54 但只有 52 人）。
   */
  S.activeStudents = function (cls) {
    const out = [];
    const tr = cls.transferred || [];
    const push = n => { if (tr.indexOf(n) < 0 && out.indexOf(n) < 0) out.push(n); };
    if (cls.sidList && cls.sidList.length) {
      cls.sidList.slice().sort((a, b) => a - b).forEach(push);
      return out;
    }
    const top = Math.max(cls.studentCount || 0, cls.maxSid || 0);
    for (let n = 1; n <= top; n++) push(n);
    return out;
  };

  /* ---------------- 课题：同年级同一个课次自动复用 ---------------- */
  S.topicKey = function (cls, no) {
    return A.term.gradeCode(cls && cls.grade) + '-' + (no || 0);
  };
  /** 这个班这节课的课题（同年级同课次别的班填过了就自动带过来） */
  S.topicOf = function (cls, no) {
    const db = S.load();
    db.lessonTopics = db.lessonTopics || {};
    const n = no || (cls && cls.draft && cls.draft.termNo) || S.nextTermNo(cls);
    return db.lessonTopics[S.topicKey(cls, n)] || '';
  };
  /** 记住这节课的课题；留空表示清掉 */
  S.setTopic = function (cls, no, topic) {
    const db = S.load();
    db.lessonTopics = db.lessonTopics || {};
    const v = String(topic || '').trim();
    if (v) db.lessonTopics[S.topicKey(cls, no)] = v;
    S.save();
    return v;
  };

  /* ---------------- 机房（机房管理） ---------------- */
  const R = A.rooms = {};
  R.byNo = function (no) {
    const db = S.load();
    return (db.rooms || []).find(r => r.no === String(no)) || null;
  };
  R.get = cls => R.byNo((cls && cls.room) || '1');
  /** 座位 -> 实际文件夹名（没设别名就按 室号+座位号） */
  R.folderOf = function (room, seatId) {
    const a = room && room.alias && room.alias[seatId];
    if (a) return a;
    return ((room && room.no) || '1') + seatId;
  };
  /** 实际文件夹名 -> 座位（先看别名，再看 室号+座位号 规则） */
  R.seatOfFolder = function (room, folder) {
    const key = String(folder || '').replace(/\s|　/g, '').toUpperCase();
    if (room && room.alias) {
      for (const seat in room.alias) {
        if (String(room.alias[seat] || '').replace(/\s|　/g, '').toUpperCase() === key) return seat;
      }
    }
    const m = /^(\d)?[^\w]*([A-E])[^\w]*(\d{1,2})$/.exec(key) || /^([A-E])(\d{1,2})$/.exec(key);
    if (!m) return null;
    const col = m[m.length - 2], row = parseInt(m[m.length - 1], 10);
    if (SE.COLS.indexOf(col) < 0 || !(row >= 1 && row <= SE.ROWS)) return null;
    return SE.id(col, row);
  };
  /** 该座位在某天是否不可用 */
  R.isBrokenOn = function (room, seat, date) {
    if (!room) return false;
    const d = date || U.today();
    return (room.broken || []).some(b => {
      if (b.seat !== seat) return false;
      if (b.from && b.from > d) return false;      // 还没开始
      if (b.to && b.to < d) return false;          // 已经修好
      return true;
    });
  };
  R.setBroken = function (room, seat, on, date) {
    if (!room) return;
    room.broken = room.broken || [];
    if (on) {
      if (!room.broken.some(b => b.seat === seat && (!b.to || b.to >= (date || U.today())))) {
        room.broken.push({ seat: seat, from: date || U.today(), to: '' });
      }
    } else {
      room.broken = room.broken.filter(b => b.seat !== seat);
    }
    S.save();
  };

  /* ---------------- 学期（管理页标题 / 归档） ---------------- */
  const T = A.term = {};
  T.get = () => { const db = S.load(); return db.term; };
  T.title = function () {
    const t = T.get();
    return (t.schoolYear || '') + '学年 第' + (t.semester === 2 ? '二' : '一') + '学期';
  };
  T.short = function () {
    const t = T.get();
    return (t.schoolYear || '') + (t.semester === 2 ? '第二' : '第一') + '学期';
  };
  /** 年级 -> 命名代号：初一 c1，初二 c2 */
  T.gradeCode = grade => (grade === '初二' ? 'c2' : (grade === '初三' ? 'c3' : 'c1'));

  /* ---------------- 座位计算 ---------------- */
  const SE = A.seats = {};
  SE.COLS = ['A', 'B', 'C', 'D', 'E'];
  SE.ROWS = 13;
  // 老师站讲台往下看：1 号机房最左是 A；2、3 号机房最右是 A
  SE.DISPLAY_COLS = ['E', 'D', 'C', 'B', 'A'];
  SE.displayCols = function (cls) {
    return String((cls && cls.room) || '1') === '1'
      ? ['A', 'B', 'C', 'D', 'E']
      : ['E', 'D', 'C', 'B', 'A'];
  };

  SE.id = (col, row) => col + U.pad2(row);
  SE.allIds = function () {
    const ids = [];
    for (let r = 1; r <= SE.ROWS; r++) SE.COLS.forEach(c => ids.push(SE.id(c, r)));
    return ids;
  };
  /** 学号 -> 默认座位：1-10=A1..A10，11-20=B1..B10 ... 51=A11... */
  SE.defaultSeatOf = function (n) {
    const i = n - 1;
    if (i < 50) {
      const col = SE.COLS[Math.floor(i / 10)];
      const row = (i % 10) + 1;
      return SE.id(col, row);
    }
    const k = i - 50;                       // 51 -> A11
    if (k < SE.COLS.length) return SE.id(SE.COLS[k], 11);
    return SE.id(SE.COLS[k % SE.COLS.length], 12 + Math.floor(k / SE.COLS.length));
  };
  /** 按学号算出来的“初始座次”（用于换座记录回放） */
  SE.baseSeats = function (cls) {
    const s = {};
    S.activeStudents(cls).forEach(n => { s[SE.defaultSeatOf(n)] = n; });
    return s;
  };
  /** 只按学号排座、不参考任何历史（force=true 忽略已有安排）。坏座位一定避开。
   *  日常请用 SE.reseat / SE.settle —— 那才是“归位优先 → 换位原则”的完整规则。 */
  SE.autoArrange = function (cls, force) {
    if (!cls.broken) cls.broken = {};
    const seats = force ? {} : Object.assign({}, cls.seats || {});
    // 清理无效
    Object.keys(seats).forEach(k => { if (!/^[A-E]\d{2}$/.test(k)) delete seats[k]; });
    const used = {};
    Object.keys(seats).forEach(k => { used[seats[k]] = k; });
    S.activeStudents(cls).forEach(n => {
      if (used[n]) return;
      const def = SE.defaultSeatOf(n);
      let sid = def;
      // 原位是坏电脑、或者已经有人了 → 按统一规则换（本列最靠近讲台的长期空位 → 旁列）
      if (cls.broken[def] || seats[def] !== undefined) sid = SE.findRelocate(cls, def, seats) || def;
      if (sid !== def && seats[sid] !== undefined) sid = SE.placeAny(cls, seats) || def;
      seats[sid] = n;
      used[n] = sid;
    });
    cls.seats = seats;
    return seats;
  };
  /** 座位 -> 学号（反向） */
  SE.studentAt = (cls, seatId) => cls.seats[seatId];
  SE.seatOfStudent = function (cls, sid) {
    const s = cls.seats;
    for (const k in s) if (s[k] === sid) return k;
    return null;
  };
  /** 在某个座次表里查学生的座位 */
  SE.seatOfIn = function (seats, sid) {
    for (const k in (seats || {})) if (seats[k] === sid) return k;
    return null;
  };
  /** 在位学生各自的原始座位（座位 -> 学号）。没人“认领”的座位才算长期空位 */
  SE.ownerMap = function (cls) {
    const m = {};
    S.activeStudents(cls).forEach(n => { m[SE.defaultSeatOf(n)] = n; });
    return m;
  };
  /** 长期空位：电脑没坏、现在没人坐、而且没有在位学生把它当原始座位（转学腾出来的就算） */
  SE.isLongFree = function (cls, seat, occupied) {
    if (!seat || cls.broken[seat]) return false;
    if (occupied && occupied[seat] !== undefined) return false;
    return !SE.ownerMap(cls)[seat];
  };
  /**
   * 电脑不可用（或座位被占）时，座上的学生挪到哪？—— 全局只有这一套规则：
   *   ① 本列最靠近讲台（1 排）的“长期空位”；
   *   ② 本列没有，就往旁边列找（左右由近及远），同样是那列最靠近讲台的长期空位；
   *   ③ 一个长期空位都没有（比如满员），才退而求其次用“当前空着”的位置。
   * seatId 用来确定“本列”（传他现在坐的位置或原始座位都行，都在同一列）。
   */
  SE.findRelocate = function (cls, seatId, occupied) {
    if (!cls.broken) cls.broken = {};
    const cols = SE.COLS;
    let ci = cols.indexOf(String(seatId || '').charAt(0));
    if (ci < 0) ci = 0;
    const owners = SE.ownerMap(cls);
    const usable = s => !!s && !cls.broken[s] && !(occupied && occupied[s] !== undefined);
    const longFree = s => usable(s) && !owners[s];
    // 列的搜索顺序：本列 → 左右交替，近的优先
    const order = [];
    for (let d = 0; d < cols.length; d++) {
      if (ci - d >= 0) order.push(cols[ci - d]);
      if (d > 0 && ci + d < cols.length) order.push(cols[ci + d]);
    }
    for (let pass = 0; pass < 2; pass++) {          // 第一轮只要长期空位，第二轮退而求其次
      const test = pass === 0 ? longFree : usable;
      for (let i = 0; i < order.length; i++) {
        for (let r = 1; r <= SE.ROWS; r++) {        // 从 1 排（最靠近讲台）往上找
          const s = SE.id(order[i], r);
          if (test(s)) return s;
        }
      }
    }
    return null;
  };
  /** 最后一个可用位：不看电脑好坏，只要没人坐（座位真的不够时才用到） */
  SE.placeAny = function (cls, occupied) {
    const all = SE.allIds();
    for (let i = 0; i < all.length; i++) if (!occupied || occupied[all[i]] === undefined) return all[i];
    return null;
  };
  /**
  /**
   * 【普适规则 · 座次结算】—— 所有“重新排一次座位”的时刻都只走这一条路：
   *   ① 归位优先（最重要）：只要这位同学的原始座位没坏，他就一定坐回自己的座位，
   *      不管他之前是因为电脑坏被挪走的、还是临时换过座、还是系统记着长期调整。
   *      电脑修好 / 新学年清空不可用记录 / 到期自动恢复 → 他会自己“回家”，不用老师手动改。
   *   ② 原位不可用的人：先沿用“长期记住的位置 → 上节课的位置”，这两个都不能用
   *      才按换位的统一规则找 —— 本列最靠近讲台的长期空位 → 旁列 → 兜底。
   *      找到的位置会长期记住（seatFix），以后每节课都照这个安排。
   *   ③ 兜底：机房座位真的不够时，也先坐回原位并提示老师，绝不让人凭空消失。
   * 它不参考当前的 cls.seats（上一节课的临时换座不带到这一节），只用于“没有正在上的课”的时刻。
   * 返回 { seats, moves:[{sid,from,to,reason:'return'|'broken'}], forced:[], unseated:[] }
   */
  SE.settle = function (cls) {
    if (!cls.broken) cls.broken = {};
    if (!cls.seatFix) cls.seatFix = {};
    const out = {};       // 座位 -> 学号
    const moves = [];     // 这次结算动了谁（用于提示老师 / 记进换座记录）
    const deferred = [];  // 原位不可用的，稍后按换位规则安排
    const forced = [];    // 一个可用位置都没有、只能先坐回原位的人
    const unseated = [];  // 连原位都腾不出来（理论上不会发生）

    // ① 归位：原位没坏的一律回原位
    S.activeStudents(cls).forEach(n => {
      const def = SE.defaultSeatOf(n);
      if (cls.broken[def]) { deferred.push(n); return; }
      if (out[def] !== undefined) { deferred.push(n); return; }   // 同一座位被两人认领（超过 65 人才可能）
      const from = SE.seatOfIn(cls.seats, n) || SE.seatOfIn(cls.lastSeats, n);
      out[def] = n;
      if (cls.seatFix[n] && cls.seatFix[n] !== def) delete cls.seatFix[n];   // 原位好了，长期调整作废
      if (from && from !== def) moves.push({ sid: n, from: from, to: def, reason: 'return' });
    });

    // ② 原位不可用的人：长期记住的位置 → 上节课的位置 → 换位规则（本列长期空位 → 旁列 → 兜底）
    deferred.forEach(n => {
      const def = SE.defaultSeatOf(n);
      const fix = cls.seatFix[n];
      const last = SE.seatOfIn(cls.lastSeats, n);
      let target = null;
      [fix, last].forEach(t => {
        if (target) return;
        if (t && t !== def && !cls.broken[t] && out[t] === undefined) target = t;
      });
      if (!target) target = SE.findRelocate(cls, def, out);
      if (!target) {
        // 机房座位不够也别让人凭空消失：先坐回原位，由页面提示老师
        target = (out[def] === undefined) ? def : SE.placeAny(cls, out);
        if (!target) { unseated.push(n); return; }
        if (target === def) forced.push(n);
      }
      out[target] = n;
      cls.seatFix[n] = target;
      const from = SE.seatOfIn(cls.seats, n) || SE.seatOfIn(cls.lastSeats, n) || def;
      moves.push({ sid: n, from: from, to: target, reason: 'broken' });
    });

    cls.seats = out;
    return { seats: out, moves: moves, forced: forced, unseated: unseated };
  };

  /** 这个座位按学号本来属于谁（在位的才算） */
  SE.ownerOf = function (cls, seatId) {
    const list = S.activeStudents(cls);
    for (let i = 0; i < list.length; i++) if (SE.defaultSeatOf(list[i]) === seatId) return list[i];
    return null;
  };
  /** 电脑修好了（取消“不可用”标记）：让这个座位的本人立刻回来（座位空着才行；有人占着就等下次结算） */
  SE.returnOwner = function (cls, seatId) {
    if (cls.broken[seatId]) return null;
    const owner = SE.ownerOf(cls, seatId);
    if (!owner) return null;
    delete cls.seatFix[owner];
    const now = SE.seatOfStudent(cls, owner);
    if (now === seatId) return null;
    if (cls.seats[seatId] !== undefined) return null;   // 被别人占着，交给下节课的结算
    if (now) delete cls.seats[now];
    cls.seats[seatId] = owner;
    return { sid: owner, from: now || seatId, to: seatId };
  };

  /** 座位可用性 / 名单变了，统一走这里：
   *  上课中只做最小修补（不动老师手动换的座），没上课就按普适规则完整结算一遍 */
  SE.reseat = function (cls) {
    SE.syncBroken(cls);
    if (cls.draft) return SE.repairSeats(cls);
    const r = SE.settle(cls);
    return {
      moved: r.moves.filter(m => m.reason === 'broken'),
      back: r.moves.filter(m => m.reason === 'return'),
      stuck: r.forced.slice(),
      missing: r.unseated.slice()
    };
  };

  /**
   * 座次自检（上课中才用）：
   *   ① 坐在“电脑不可用”座位上的人，按统一规则挪到别处（并长期记住，下节课照样用这个位置）；
   *   ② 名单上有、座次表里没有的人（换过座、导过花名册、别班标记了坏电脑都可能造成），补一个座位。
   * 任何情况下都不会把人“弄丢”——真的没位置时他仍留在原座位，由页面提示老师。
   */
  SE.repairSeats = function (cls) {
    const out = {};
    const moved = [];
    if (!cls.seatFix) cls.seatFix = {};
    if (!cls.broken) cls.broken = {};
    // ① 先把坐在坏座位（或重复座位）上的人挑出来
    Object.keys(cls.seats || {}).forEach(seat => {
      const sid = cls.seats[seat];
      if (sid === undefined || sid === null || sid === '') return;
      if (cls.broken[seat]) { moved.push({ sid: sid, from: seat, to: null }); return; }
      if (out[seat] === undefined) out[seat] = sid;
      else moved.push({ sid: sid, from: seat, to: null });
    });
    moved.forEach(m => {
      const fix = cls.seatFix && cls.seatFix[m.sid];
      let t = (fix && !cls.broken[fix] && out[fix] === undefined) ? fix : null;
      if (!t) t = SE.findRelocate(cls, m.from, out);
      if (!t) t = SE.placeAny(cls, out);
      if (!t) return;                                  // 真的没位置：留在原处，下面会提示
      out[t] = m.sid;
      m.to = t;
      cls.seatFix[m.sid] = t;
    });
    // ② 名单里还有谁没有座位
    const missing = [];
    S.activeStudents(cls).forEach(n => {
      if (SE.seatOfIn(out, n)) return;
      const def = SE.defaultSeatOf(n);
      let t = (out[def] === undefined && !cls.broken[def]) ? def : SE.findRelocate(cls, def, out);
      if (!t) t = SE.placeAny(cls, out);
      if (!t) { missing.push(n); return; }
      out[t] = n;
      if (cls.broken[def]) cls.seatFix[n] = t;
    });
    cls.seats = out;
    return {
      moved: moved.filter(m => m.to),
      stuck: moved.filter(m => !m.to).map(m => m.sid),
      missing: missing
    };
  };

  /** 用机房里的“不可用记录（带起止日期）”刷新班级的 broken 表 */
  SE.syncBroken = function (cls) {
    const room = A.rooms.get(cls);
    const out = {};
    SE.allIds().forEach(seat => { if (A.rooms.isBrokenOn(room, seat, U.today())) out[seat] = true; });
    cls.broken = out;
    // 失效的长期调整要清掉：
    //   ① 挪过去的那个位置也不可用了；
    //   ② 本人的原始座位修好了 —— 那他该回家了，不用再记着“因为电脑坏而换到某处”
    Object.keys(cls.seatFix || {}).forEach(sid => {
      const seat = cls.seatFix[sid];
      if (!seat) return;
      if (out[seat]) { delete cls.seatFix[sid]; return; }
      const def = SE.defaultSeatOf(parseInt(sid, 10));
      if (def && !out[def]) delete cls.seatFix[sid];
    });
    return out;
  };
  SE.name = function (cls, sid) {
    if (!sid) return '';
    return cls.roster[String(sid)] || '';
  };
  SE.label = function (cls, sid) {
    return sid + (cls.roster[String(sid)] ? ' ' + cls.roster[String(sid)] : '');
  };
  /** 作业文件夹名：室号 + 座位号，如 1A01 */
  SE.folderName = (cls, seatId) => (cls.room || '1') + seatId;

  /* ---------------- ZIP（xlsx / 作业压缩包）读取 ---------------- */
  const Z = A.zip = {};
  async function inflateRaw(u8, start, end) {
    const blob = new Blob([u8.subarray(start, end)]);
    if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持解压，请改用 Chrome/Edge 新版');
    const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  Z.read = async function (buf) {
    const u8 = new Uint8Array(buf);                 // 兼容 ArrayBuffer / 各种 TypedArray
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    const min = Math.max(0, u8.length - 22 - 65535);
    for (let i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx / zip 文件');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const entries = [];
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < count; i++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
      const lnameLen = dv.getUint16(lho + 26, true);
      const lextraLen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnameLen + lextraLen;
      entries.push({ name, method, dataStart: start, dataEnd: start + csize });
      off += 46 + nameLen + extraLen + commentLen;
    }
    const get = async name => {
      const e = entries.find(x => x.name === name);
      if (!e) return null;
      let bytes;
      if (e.method === 0) bytes = u8.subarray(e.dataStart, e.dataEnd);
      else bytes = await inflateRaw(u8, e.dataStart, e.dataEnd);
      return new TextDecoder('utf-8').decode(bytes);
    };
    return { entries, get };
  };
  /** 只列出条目名（用于作业 zip） */
  Z.listNames = async buf => (await Z.read(buf)).entries.map(e => e.name);

  /* ---------------- 表格文件解析（xlsx / csv） ---------------- */
  const X = A.sheet = {};

  function colToIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function xmlNodes(doc, tag) { return Array.prototype.slice.call(doc.getElementsByTagNameNS('*', tag)); }
  function nodeText(node) {
    let s = '';
    xmlNodes(node, 't').forEach(t => { s += t.textContent; });
    return s;
  }

  X.parseXlsx = async function (buf) {
    const zip = await Z.read(buf);
    let shared = [];
    const ssXml = await zip.get('xl/sharedStrings.xml');
    if (ssXml) {
      const doc = new DOMParser().parseFromString(ssXml, 'application/xml');
      xmlNodes(doc, 'si').forEach(si => shared.push(nodeText(si)));
    }
    let sheetName = 'xl/worksheets/sheet1.xml';
    if (!(await zip.get(sheetName))) {
      const hit = zip.entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
        .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
      sheetName = hit ? hit.name : null;
    }
    if (!sheetName) throw new Error('未找到工作表内容');
    const xml = await zip.get(sheetName);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [];
    xmlNodes(doc, 'row').forEach(row => {
      const cells = [];
      xmlNodes(row, 'c').forEach(c => {
        const ref = c.getAttribute('r') || '';
        const t = c.getAttribute('t') || 'n';
        const ci = colToIndex(ref);
        if (ci < 0) return;
        let v = '';
        if (t === 's') {
          const vNode = xmlNodes(c, 'v')[0];
          const idx = vNode ? parseInt(vNode.textContent, 10) : -1;
          v = shared[idx] || '';
        } else if (t === 'inlineStr') {
          const is = xmlNodes(c, 'is')[0];
          v = is ? nodeText(is) : '';
        } else {
          const vNode = xmlNodes(c, 'v')[0];
          v = vNode ? vNode.textContent : '';
        }
        cells[ci] = String(v).trim();
      });
      rows.push(cells);
    });
    return rows;
  };

  X.parseCsv = function (text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',' || ch === '\t') { row.push(cur.trim()); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(cur.trim()); rows.push(row); row = []; cur = '';
        } else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur.trim()); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ''));
  };

  X.readFile = async function (file) {
    const isCsv = /\.csv$/i.test(file.name);
    if (isCsv) {
      let buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (/\uFFFD/.test(text)) {
        try { text = new TextDecoder('gbk').decode(buf); } catch (e) { /* 忽略 */ }
      }
      return X.parseCsv(text.replace(/^\uFEFF/, ''));
    }
    return await X.parseXlsx(await file.arrayBuffer());
  };

  /** 从任意样式的表格中识别花名册：姓名列 + 其左侧学号列 */
  /**
   * 读花名册第一行：A1“初”右边填年级、A3“班”左边填班号
   * 兼容几种写法：初 | 1 | 12 | 班；初二 12 班；12班（缺年级）；都不填
   */
  X.headInfo = function (rows) {
    const out = { grade: null, classNo: null };
    if (!rows || !rows.length) return out;
    const CN = { '一': 1, '二': 2, '三': 3, '1': 1, '2': 2, '3': 3 };
    const GRADE = { 1: '初一', 2: '初二', 3: '初三' };
    const only = v => String(v == null ? '' : v).trim();
    // 只认“单独一个数字”的格子，长句子里的数字一律不算
    const num = (v, lo, hi) => {
      const m = /^(\d{1,2}|[一二三])$/.exec(only(v));
      if (!m) return null;
      const n = CN[m[1]] || parseInt(m[1], 10);
      return (n >= lo && n <= hi) ? n : null;
    };
    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const cells = (rows[r] || []).map(only);
      const gi = cells.findIndex(v => v === '初' || /^初[一二三1-3]?$/.test(v));
      const bi = cells.findIndex(v => v === '班');
      let gNum = null, cNum = null;
      // 整格写法：“初二14班”“12班”
      if (gi < 0 && bi < 0) {
        const txt = cells.filter(Boolean).join(' ');
        const mg = /初\s*([一二三1-3])/.exec(txt);
        const mc = /(\d{1,2})\s*班/.exec(txt);
        if (mg) gNum = CN[mg[1]];
        if (mc) cNum = parseInt(mc[1], 10);
        if (gNum && GRADE[gNum]) out.grade = GRADE[gNum];
        if (cNum >= 1 && cNum <= 21) out.classNo = cNum;
        if (out.grade || out.classNo) break;
        continue;
      }
      // ① “初”右边那格：1 / 2 / 3（也认“初二”这种整格写法）
      if (gi >= 0) {
        const inline = /^初([一二三1-3])$/.exec(cells[gi]);
        gNum = inline ? CN[inline[1]] : num(cells[gi + 1], 1, 3);
      }
      // ② “班”左边那格（模板就是这么留的）；老师填到右边也认
      if (bi >= 0) {
        const gCell = gi >= 0 ? gi + 1 : -1;
        if (bi - 1 >= 0 && bi - 1 !== gCell) cNum = num(cells[bi - 1], 1, 21);
        if (cNum === null) cNum = num(cells[bi + 1], 1, 21);
      }
      // ③ 整格写法：“初二12班”“12班”，只在没找到独立格子时才用
      const joined = cells.filter(Boolean).join(' ');
      if (gi < 0) { const m = /初\s*([一二三1-3])/.exec(joined); if (m) gNum = CN[m[1]]; }
      if (bi < 0 && cNum === null) {
        const m = /(\d{1,2})\s*班/.exec(joined) || /班\s*(\d{1,2})/.exec(joined);
        if (m) cNum = parseInt(m[1], 10);
      }
      if (gNum && GRADE[gNum]) out.grade = GRADE[gNum];
      if (cNum >= 1 && cNum <= 21) out.classNo = cNum;
      if (out.grade || out.classNo) break;
    }
    return out;
  };

  X.extractRoster = function (rows) {
    if (!rows || !rows.length) return [];
    const maxLen = Math.max.apply(null, rows.map(r => r.length));
    const isName = s => /^[\u4e00-\u9fa5·]{2,6}$/.test(s || '');
    const isNum = s => /^\d{1,12}$/.test(String(s || '').trim());

    // 1) 先找表头中的“姓名”列（格子本身要短，长句子里提到“姓名”的不算）
    let nameCol = -1, idCol = -1, headerRow = -1;
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      for (let c = 0; c < maxLen; c++) {
        const v = String(rows[r][c] || '').replace(/\s/g, '');
        if (!v || v.length > 8 || !/姓名|名字/.test(v)) continue;
        // 这一列下面得真的有名字，否则那只是说明文字
        let has = 0;
        for (let k = r + 1; k < rows.length; k++) if (isName(rows[k][c])) has++;
        if (!has) continue;
        nameCol = c; headerRow = r;
        for (let left = c - 1; left >= 0; left--) {
          const hv = String(rows[r][left] || '').replace(/\s/g, '');
          if (hv && hv !== v) { idCol = left; break; }
        }
        if (idCol < 0) idCol = c - 1;
        break;
      }
      if (nameCol >= 0) break;
    }
    // 2) 回退：统计各列疑似姓名数量
    if (nameCol < 0) {
      let best = 0, bestCol = -1;
      for (let c = 0; c < maxLen; c++) {
        let n = 0;
        rows.forEach(r => { if (isName(r[c])) n++; });
        if (n > best) { best = n; bestCol = c; }
      }
      if (best < 2) return [];
      nameCol = bestCol;
      idCol = -1;
      for (let left = nameCol - 1; left >= 0; left--) {
        let n = 0;
        rows.forEach(r => { if (isNum(r[left])) n++; });
        if (n >= best) { idCol = left; break; }
      }
      if (idCol < 0) idCol = nameCol - 1;
      headerRow = -1;
    }
    if (nameCol < 0 || idCol < 0) return [];

    const out = [];
    let blank = 0;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const nm = String(rows[r][nameCol] || '').replace(/\s/g, '');
      let idv = String(rows[r][idCol] === undefined ? '' : rows[r][idCol]).replace(/\s/g, '');
      if (!nm && !idv) { if (++blank >= 3) break; continue; }
      blank = 0;
      if (!nm || !isName(nm)) continue;
      idv = idv.replace(/[^\d]/g, '');
      if (!idv) continue;
      out.push({ id: parseInt(idv, 10), raw: idv, name: nm });
    }
    return out;
  };

  /** 学号可能很长（如 20240101），按出现顺序重编为 1..N */
  X.normalizeIds = list => {
    if (!list.length) return list;
    const maxId = Math.max.apply(null, list.map(x => x.id));
    if (maxId > 200 && maxId > list.length * 3) {
      return list.map((x, i) => ({ id: i + 1, raw: x.raw, name: x.name, sourceId: x.id }));
    }
    return list;
  };

  /* ---------------- 新一节课的座次重建 ----------------
     规则（两条）：
     ① 座位没问题的同学：一律回到按学号的原始座位（上一节课的临时换座不带到新课）；
     ② 座位有问题的同学（电脑不可用 / 座位被别人占了）：按“上一节课的安排”就座
        —— 优先用它上次坐的位置（cls.seatFix 或 cls.lastSeats），那个位置不能坐
        再顺延到最近的空位。绝不动座位没问题的人。
     转学的学生不再排座。
     具体规则全部在 SE.settle 里（归位优先 → 换位原则 → 兜底），这里只是把它包一层。 */
  SE.buildLessonSeats = function (cls) {
    const r = SE.settle(cls);
    return { seats: r.seats, autoMoves: r.moves, forced: r.forced, unseated: r.unseated };
  };

  /* ---------------- 花名册模板（本地生成 xlsx，无需网络） ---------------- */
  const TPL = A.tpl = {};
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const nb = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = new Uint8Array(30 + nb.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nb.length, true); lv.setUint16(28, 0, true);
      lh.set(nb, 30);
      parts.push(lh, data);
      const ch = new Uint8Array(46 + nb.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true);
      ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [eocd]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  /* 单元格格式：0=常规 1=文本（学号等，不会被改成数字） 2=数值 0.0（成绩） */
  const XLS_STYLE = { normal: 0, text: 1, number: 2 };
  const XLS_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="176" formatCode="0.0"/></numFmts>' +
    '<fonts count="1"><font><sz val="11"/><name val="\u5b8b\u4f53"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="176" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="\u5e38\u89c4" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /**
   * 本地生成一个 xlsx 表格（rows 为二维数组）
   * opts.types  {列序号: 'text' | 'number'} —— 学号用 text（保住 01），成绩用 number
   * opts.widths [10, 12, 10] —— 列宽
   */
  TPL.sheet = function (filename, sheetName, rows, opts) {
    opts = opts || {};
    const enc = new TextEncoder();
    const part = s => enc.encode(s);
    const esc = s => String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const typeOf = ci => (opts.types && opts.types[ci]) || null;
    const blank = (ref, s) => s ? '<c r="' + ref + '" s="' + s + '"/>' : '';
    const cell = (ref, v, ci) => {
      const t = typeOf(ci);
      if (v === '' || v === null || v === undefined) return blank(ref, t ? XLS_STYLE[t] : null);
      if (t === 'number') {
        const n = Number(v);
        if (v !== '' && isNaN(n)) {   // 表头这类文字照写，只是保留数值格式
          return '<c r="' + ref + '" s="' + XLS_STYLE.number + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>';
        }
        if (isNaN(n)) return blank(ref, XLS_STYLE.number);
        return '<c r="' + ref + '" s="' + XLS_STYLE.number + '"><v>' + n + '</v></c>';
      }
      if (t === 'text') {
        return '<c r="' + ref + '" s="' + XLS_STYLE.text + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>';
      }
      if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>';
    };
    const body = (rows || []).map((row, ri) =>
      '<row r="' + (ri + 1) + '">' + row.map((v, ci) =>
        cell(String.fromCharCode(65 + ci) + (ri + 1), v, ci)).join('') +
      '</row>').join('');
    const cols = (opts.widths && opts.widths.length)
      ? '<cols>' + opts.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
      : '';
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' + cols +
      '<sheetData>' + body + '</sheetData></worksheet>';
    const files = [
      { name: '[Content_Types].xml', data: part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
      { name: '_rels/.rels', data: part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name: 'xl/workbook.xml', data: part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc(sheetName || 'Sheet1') + '" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
      { name: 'xl/styles.xml', data: part(XLS_STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: part(sheet) }
    ];
    const blob = zipStore(files);
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  /** 花名册模板：第一行“初 _ _ 班” + 填写要求，第二行表头（学号 / 姓名），第三行起填名单 */
  TPL.rosterTemplate = function () {
    const rows = [
      ['初', '', '', '班', '填写要求：在“初”右边的空格填年级（1=初一、2=初二、3=初三），在“班”左边的空格填班号（如 12）；名单从第三行起往下填，A 列学号、B 列姓名，学号和人数不相等也没关系（按实际名单人数算）'],
      ['学号', '姓名']
    ];
    TPL.sheet('花名册模板.xlsx', '花名册', rows, {
      types: { 0: 'text' }, widths: [9, 12, 12, 9, 46]
    });
  };

  /** 期末总评：考试成绩模板（学号 / 姓名 / 成绩）—— 不带真实名单，只给一行示例 */
  TPL.examTemplate = function (cls) {
    const rows = [['学号', '姓名', '成绩'], ['1', '张三', 90]];
    TPL.sheet('考试成绩模板-' + cls.name + '.xlsx', '成绩', rows, {
      types: { 0: 'text', 1: 'text', 2: 'number' }, widths: [10, 14, 12]
    });
  };

  /* ================= 行为标签（第 2 版）：¼ 分档 · 左右渐变 =================
     每个学生一条状态（按学号存字符串键）：
       r 红档　：违纪「达标」（一节课违纪 ≥3 项，或老师当场写保证书标红）累计的次数
                 0 无 · 1 ¼红 · 2 ½红 · 3 ¾红 · 4 全红；红带从左往右铺
       rb 回退 ：只在全红时可用，每退一档红带少 ¼、平时分 +20（封顶 60）；回退后再犯清零
       d 值日　：累计次数，黄带 ¼/½/¾（第 1/2/3 次）；第 4 次值日转红（红档 +1），之后值日再犯红档继续 +1
     显示：红带占左边、黄带只补右边剩余（红 > 黄）；被盖住只是盖住，记忆还在。
     色标默认隐藏（db.showTags 开关控制）；当堂当场标红的始终显示，下课保存后回到隐藏。 */
  const TAG = A.tagSys = {};
  const TAG_COLOR = { yellow: '#FBF0C8', red: '#F2BCBC' };

  function tagState(cls, sid) {
    const t = cls.tags = cls.tags || {};
    const k = String(sid);
    return t[k] = t[k] || { d: 0, r: 0, rb: 0 };
  }
  TAG.stateOf = tagState;

  /** 这条记录里该生有没有被记「值日」违纪（奖励里的“值日”是表扬，不算） */
  function dutyMarked(rec, sid) {
    return (rec.violations || []).some(v => v.sid === sid &&
      (v.list || []).some(it => it && it.type === '值日' && (it.n || 0) > 0));
  }

  /** 一节课违纪扣分合计（一项算一次） */
  TAG.violCount = function (rec, sid) {
    return (rec.violations || []).filter(v => v.sid === sid)
      .reduce((n, v) => n + A.views.countOf(v.list), 0);
  };

  /** 本节课到目前为止该生记了几项违纪（含同一项记多次）——用来当场提示红标 */
  TAG.violNow = function (cls, sid) {
    const a = cls.draft && cls.draft.att ? cls.draft.att[sid] : null;
    if (!a || !a.viol) return 0;
    return a.viol.reduce((n, v) => n + (parseInt(v.n, 10) || 1), 0);
  };

  /** 红档 +1（封顶全红）；已在全红则只清回退进度 */
  function redUp(st) {
    if (st.r >= 4) { st.rb = 0; return; }
    st.r += 1;
    if (st.r === 4) st.rb = 0;
  }

  /** 保存一条新课记录后推进全班标签。违纪满 3 的档在课堂上已当场计过（rec.redCounted），保存时不重复。 */
  TAG.onNewRecord = function (cls, rec) {
    if (!cls || !rec) return;
    const marked = rec.redMarked || [];
    const counted = rec.redCounted || {};
    S.activeStudents(cls).forEach(sid => {
      const st = tagState(cls, sid);
      // 值日：黄带只累计到第 3 次，第 4 次起转红（之后每次再犯红档继续 +1）
      if (dutyMarked(rec, sid)) {
        st.d += 1;
        if (st.d >= 4) redUp(st);
      }
      // 违纪达标（≥3 项）或当场写过保证书：这节课 +1 档红；当场已经计过的不再重复
      if ((TAG.violCount(rec, sid) >= 3 || marked.indexOf(sid) >= 0) && !counted[sid]) redUp(st);
    });
  };

  /** 名字菜单里该出现哪些按钮（当场标红与草稿有关，由考勤页单独加） */
  TAG.actions = function (cls, sid) {
    const st = (cls.tags || {})[String(sid)];
    if (!st) return [];
    const list = [];
    if (st.letter) list.push('letterDone');             // 待写保证书：跨课保留，点了才消失
    if (st.d >= 1 && st.d <= 3) list.push('dutyFix');   // 已转红（d≥4）的清不了
    if (st.r === 4 && st.rb < 3) list.push('redBack');
    return list;
  };

  /** 执行按钮动作，成功返回 true */
  TAG.doAction = function (cls, sid, act) {
    const st = tagState(cls, sid);
    if (act === 'letterDone' && st.letter) { st.letter = 0; return true; }
    if (act === 'dutyFix' && st.d >= 1 && st.d <= 3) { st.d = 0; return true; }
    if (act === 'redBack' && st.r === 4 && st.rb < 3) { st.rb++; return true; }
    return false;
  };

  /** 当场计 1 档红：立即 r+1，并记入本节课草稿（一节课只计一次）。
      kind='auto'（违纪满3自动）| 'hand'（手动当场标红）。
      返回是否应该"马上标红"显示 —— 全红之后不再马上显示，只跟着色标开关。 */
  TAG.stageNow = function (cls, sid, kind) {
    if (!cls.draft) return false;
    const d = cls.draft;
    d.redCounted = d.redCounted || {};
    if (d.redCounted[sid]) return false;   // 一节课只加一档
    d.redCounted[sid] = kind === 'hand' ? 'hand' : 'auto';
    if (kind === 'hand') {                  // 手动标红 = 当场写保证书，记入本节名单（记录页/导出用）
      const m = d.redMark = d.redMark || [];
      if (m.indexOf(sid) < 0) m.push(sid);
    }
    const st = tagState(cls, sid);
    const wasFull = st.r >= 4;
    redUp(st);                              // 全红后再犯：只清回退进度
    st.letter = 1;                          // 待写保证书（跨课保留）
    return !wasFull;
  };

  /** 本节课是否已当场计过档 */
  TAG.stagedNow = function (cls, sid) {
    return !!(cls.draft && cls.draft.redCounted && cls.draft.redCounted[sid]);
  };

  /** 违纪增减之后调用：满 3 项当场自动计档；自动计的档在违纪减回 3 项以下时自动退 */
  TAG.autoStage = function (cls, sid) {
    if (!cls.draft) return;
    const d = cls.draft;
    d.redCounted = d.redCounted || {};
    if (TAG.violNow(cls, sid) >= 3) {
      TAG.stageNow(cls, sid, 'auto');
    } else if (d.redCounted[sid] === 'auto') {
      delete d.redCounted[sid];
      const st = tagState(cls, sid);
      if (st.r > 0) st.r -= 1;
      if (!st.r) st.letter = 0;
    }
  };

  /** 撤销本节课当场计的档（点错了 / 恢复出勤） */
  TAG.unstageNow = function (cls, sid) {
    if (!cls.draft) return false;
    const d = cls.draft;
    d.redCounted = d.redCounted || {};
    if (!d.redCounted[sid]) return false;
    delete d.redCounted[sid];
    const m = d.redMark || [];
    const mi = m.indexOf(sid);
    if (mi >= 0) m.splice(mi, 1);
    const st = tagState(cls, sid);
    if (st.r > 0) st.r -= 1;
    st.letter = 0;
    return true;
  };

  /** 本节课是否应该"马上标红"显示（不看色标开关）：当场计过档且还没到全红 */
  TAG.showNow = function (cls, sid) {
    if (!TAG.stagedNow(cls, sid)) return false;
    const st = (cls.tags || {})[String(sid)] || {};
    return (st.r || 0) < 4;
  };

  /** 状态一句话（菜单标题用） */
  TAG.stateText = function (cls, sid) {
    const st = (cls.tags || {})[String(sid)] || {};
    const R = ['', '¼红', '½红', '¾红', '全红'];
    const D = ['', '¼黄', '½黄', '¾黄'];
    const parts = [];
    if (st.r) parts.push('红:' + R[st.r] + (st.r === 4 && st.rb ? '（已回退' + st.rb + '档）' : ''));
    if (st.d >= 1 && st.d <= 3) parts.push('值日:' + D[st.d]);
    if (st.d >= 4) parts.push('值日:已转红（累计第' + st.d + '次）');
    const vn = TAG.violNow(cls, sid);
    if (TAG.stagedNow(cls, sid)) parts.push('本节课已计 1 档红');
    else if (vn >= 3) parts.push('本节课已记' + vn + '项违纪');
    if (st.letter) parts.push('待写保证书');
    return parts.join(' · ');
  };

  /** 座位标签背景：从左往右的分带渐变（红带在前、黄带补右），没有可见标签返回 ''。
      plus=1 时预览“当场标红后”的样子（红档临时 +1）。 */
  TAG.bg = function (cls, sid, plus) {
    let st = (cls.tags || {})[String(sid)];
    if (!st) {
      if (!plus) return '';
      // 还没落过库的学生（比如开学第一节课）：当场预览也要能画出来
      st = { d: 0, r: 0, rb: 0 };
    }
    let r = st.r, rb = st.rb;
    if (plus) { r = Math.min(4, r + plus); rb = 0; }
    const red = Math.max(0, Math.min(4, r - rb));            // 全红回退 n 档，红带少 n/4
    const yellow = (st.d >= 1 && st.d <= 3) ? st.d : 0;      // 转红后黄带不再显示（记忆保留）
    if (red <= 0 && yellow <= 0) return '';
    const wR = red / 4;
    const wY = Math.max(0, Math.min(yellow / 4, 1 - wR));    // 红优先占位，黄只补右侧剩余
    const bands = [];
    if (wR > 0) bands.push([TAG_COLOR.red, wR]);
    if (wY > 0) bands.push([TAG_COLOR.yellow, wY]);
    // 每段之间留 1.5% 的柔和过渡，整体保持淡淡的感觉
    let acc = 0;
    const parts = [];
    bands.forEach((b, i) => {
      const from = acc * 100, to = (acc + b[1]) * 100;
      const f = Math.round(from + (i ? 1.5 : 0));
      const t = Math.round(to - (i < bands.length - 1 ? 1.5 : 0));
      parts.push(b[0] + ' ' + f + '%', b[0] + ' ' + t + '%');
      acc += b[1];
    });
    return 'linear-gradient(90deg,' + parts.join(',') + ')';
  };


})(window.App);
