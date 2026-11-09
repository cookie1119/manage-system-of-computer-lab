/* 考勤页：座位网格（讲台在下）、格内状态按钮、违纪、长期请假/转学、换座模式、开始/结束上课 */
(function (A) {
  'use strict';
  const U = A.util, SE = A.seats, S = A.store;

  const V = A.views = A.views || {};
  const state = { moving: false, pickFrom: null, timer: null };

  const ACT = {
    absent: { text: '缺勤', tip: '缺勤（再点一次取消）' },
    late: { text: '迟到', tip: '迟到：第1次开始计时，第2次到达停表，第3次取消' },
    early: { text: '早退', tip: '早退：第1次有故（绿），第2次无故（红），第3次取消' },
    w: { text: '未回校', tip: '请假 · 未回校（再点一次取消）' },
    x: { text: '校医', tip: '请假 · 校医（再点一次取消）' },
    q: { text: '其他', tip: '请假 · 其他原因（再点一次取消）' }
  };
  const VIOL_TYPES = ['讲话', '换位', '走动', '脱控', '无关', '值日', '其他'];
  const AWARD_TYPES = ['回答', '助人', '纪律', '值日', '其他'];
  const LEAVE_TEXT = { w: '未回校', x: '校医', q: '其他' };

  /* ---------- 课时草稿 ---------- */
  function ensureDraft(cls, auto) {
    if (cls.draft) return cls.draft;
    if (!auto) return null;

    // 新的一节课：先用机房里的不可用记录刷新，再排座
    SE.syncBroken(cls);
    const built = SE.buildLessonSeats(cls);
    cls.seats = built.seats;
    const at = U.nowTime();

    const d = cls.draft = {
      termNo: S.nextTermNo(cls),
      topic: S.topicOf(cls) || '',      // 同年级同课次别的班填过的课题自动带上
      date: U.today(),
      time: at,
      startAt: Date.now(),
      ended: false, endAt: null, endTime: null,
      att: {}, moves: [], homework: null,
      note: '',
      seatsSnapshot: Object.assign({}, cls.seats)
    };
    // 电脑修好 / 新学年清空了不可用记录：原来被挪走的同学这节课回到自己的座位
    const backMoves = (built.autoMoves || []).filter(m => m.reason === 'return');
    if (backMoves.length) {
      setTimeout(() => U.toast('电脑修好了：' + backMoves.map(m => m.sid + '号回到 ' + m.to).join('、'), 'ok'), 700);
    }
    // 机房座位不够时，先坐回原位的人也给个明确提示（不能让人“悄悄不见”）
    if (built.forced && built.forced.length) {
      setTimeout(() => U.toast('机房座位不够：' + built.forced.join('、') + ' 号暂时坐回原位（电脑不可用），请手动安排', 'err'), 800);
    }
    if (built.unseated && built.unseated.length) {
      setTimeout(() => U.toast('没有可用座位：' + built.unseated.join('、') + ' 号', 'err'), 800);
    }
    // 因电脑不可用而自动调整的同学，也要记进本节课的换座记录
    built.autoMoves.forEach(m => {
      d.moves.push({ sid: m.sid, from: m.from, to: m.to, at: at, swap: null, empty: true, auto: true, reason: m.reason });
    });
    // 长期请假的同学默认标“未回校”
    (cls.longLeave || []).forEach(sid => {
      if ((cls.transferred || []).indexOf(sid) >= 0) return;
      d.att[sid] = { status: 'leave', leave: 'w', auto: true };
    });
    S.save();
    return d;
  }
  V.ensureDraft = ensureDraft;

  function attOf(cls, sid) {
    const d = cls.draft;
    if (!d) return { status: 'present' };
    return d.att[sid] || (d.att[sid] = { status: 'present' });
  }
  function resetAtt(a) {
    a.status = 'present';
    delete a.leave; delete a.lateStart; delete a.lateMin; delete a.early;
    a.timing = false;
  }
  function lateMinutes(a) {
    if (!a.lateStart) return a.lateMin || 0;
    return Math.max(0, Math.round((Date.now() - a.lateStart) / 60000));
  }
  /** 一项的显示名，同一项记了多次就写“回答×2” */
  function itemLabel(v) {
    const t = v.type === '其他' ? (v.text || '其他') : v.type;
    const n = parseInt(v.n, 10) || 1;
    return n > 1 ? (t + '×' + n) : t;
  }
  function violText(list) { return (list || []).map(itemLabel).join('、'); }
  V.violText = violText;
  function awardText(list) { return (list || []).map(itemLabel).join('、'); }
  V.awardText = awardText;

  /** 一项一共记了几次 */
  function countOf(list) {
    return (list || []).reduce((n, v) => n + (parseInt(v.n, 10) || 1), 0);
  }
  V.countOf = countOf;

  /* ---------- 奖励 / 违纪：同一项可以叠加次数 ---------- */
  /** 加 / 减一次；减到 0 就把这一项去掉 */
  function changeCount(list, type, text, delta) {
    const i = list.findIndex(v => v.type === type && (type !== '其他' || v.text === text));
    if (i >= 0) {
      const n = (parseInt(list[i].n, 10) || 1) + delta;
      if (n <= 0) list.splice(i, 1);
      else list[i].n = n;
      return;
    }
    if (delta <= 0) return;
    const o = { type: type, n: delta };
    if (type === '其他') o.text = text;
    list.push(o);
  }
  V.changeCount = changeCount;

  function addAward(cls, sid, type, text, delta) {
    if (!cls.draft) { U.toast('请先点“开始上课”，再记录奖励', 'err'); return; }
    ensureDraft(cls, true);
    const a = attOf(cls, sid);
    a.award = a.award || [];
    changeCount(a.award, type, text, delta);
    if (!a.award.length) delete a.award;
    S.save(); refresh();
  }
  V.addAward = addAward;
  V.openAwardMenu = openAwardMenu;
  V.openViolMenu = openViolMenu;
  function addViolation(cls, sid, type, text, delta) {
    if (!cls.draft) { U.toast('请先点“开始上课”，再记录违纪', 'err'); return; }
    ensureDraft(cls, true);
    const a = attOf(cls, sid);
    a.viol = a.viol || [];
    changeCount(a.viol, type, text, delta);
    if (!a.viol.length) delete a.viol;
    // 违纪满 3 项当场自动计 1 档红（减回 3 项以下自动退）
    if (A.tagSys) A.tagSys.autoStage(cls, sid);
    S.save(); refresh();
  }
  V.addViolation = addViolation;
  V.toggleViolation = (cls, sid, type, text) => addViolation(cls, sid, type, text, 1);

  /** “− 次数 +”的小控件，供菜单和记录编辑器共用（ctx 提供 get / change / refs）
      removable=true 的项（临时填的“其他”）减到 0 时整行撤掉；固定项只是收起 − 和数字 */
  function stepBox(ctx, type, text, removable) {
    const cnt = () => ctx.get(type, text);
    const box = U.el('div', { class: 'pop-step' });
    const minus = U.el('button', { class: 'step-btn', text: '−', title: '减少一次' });
    const num = U.el('b', { class: 'step-n' });
    const plus = U.el('button', { class: 'step-btn', text: '+', title: '增加一次' });
    minus.onclick = e => { e.stopPropagation(); ctx.change(type, text, -1); };
    plus.onclick = e => { e.stopPropagation(); ctx.change(type, text, 1); };
    box.appendChild(minus); box.appendChild(num); box.appendChild(plus);
    const upd = () => {
      const n = cnt();
      if (n <= 0 && removable && ctx.drop) {
        const row = box.parentNode;
        if (row && row.parentNode) row.parentNode.removeChild(row);
        return;
      }
      num.textContent = n ? String(n) : '';
      num.hidden = !n;
      minus.hidden = !n;
    };
    ctx.refs.push(upd);
    upd();
    return box;
  }
  V.stepBox = stepBox;

  /** 菜单里“其他”那一块：填了什么就单独成一行，跟固定项一样带 − 次数 + */
  function otherBlock(ctx, getList, cls) {
    const box = U.el('div', { class: 'pop-others' });
    const fill = () => {
      box.innerHTML = '';
      (getList() || []).forEach(v => {
        if (v.type !== '其他') return;
        box.appendChild(U.el('div', { class: 'pop-item ' + cls }, [
          U.el('span', { text: v.text || '其他' }),
          stepBox(ctx, '其他', v.text, true)
        ]));
      });
    };
    fill();
    return { box: box, fill: fill };
  }

  /** 奖励菜单：“其他”直接在菜单底部填；每一项后面都能加减次数 */
  function openAwardMenu(node, cls, sid) {
    const a = attOf(cls, sid);
    const refs = [];
    const ctx = {
      kind: 'award', refs: refs,
      drop: el => { if (el && el.parentNode) el.parentNode.removeChild(el); },
      get: (type, text) => {
        const list = attOf(cls, sid).award || [];
        const hit = list.find(v => v.type === type && (type !== '其他' || v.text === text));
        return hit ? (parseInt(hit.n, 10) || 1) : 0;
      },
      change: (type, text, delta) => {
        addAward(cls, sid, type, text, delta);
        refs.forEach(f => f());
      }
    };
    const items = AWARD_TYPES.filter(t => t !== '其他').map(t => ({
      label: t, cls: 'green', node: stepBox(ctx, t, null),
      on: () => ctx.change(t, null, 1)
    }));
    const ob = otherBlock(ctx, () => attOf(cls, sid).award || [], 'green');
    if (a.award && a.award.length) {
      items.push('-');
      items.push({
        label: '清除全部奖励', cls: 'danger',
        on: () => { delete attOf(cls, sid).award; S.save(); refresh(); }
      });
    }
    const otherInput = U.el('input', {
      class: 'input pop-input', placeholder: '其他事由（临时项，下次上课不会带过来）', maxlength: '20',
      title: '不属于上面几类的，直接写在这里，回车即可记下；记下后可以像固定项一样加减次数'
    });
    function addOther() {
      const v = otherInput.value.trim();
      if (!v) { U.toast('请填写具体的奖励事由', 'err'); return; }
      addAward(cls, sid, '其他', v, 1);
      otherInput.value = '';
      ob.fill();                     // 立刻变成一行，菜单不关，方便继续加减
      U.toast(sid + '号 ' + (SE.name(cls, sid) || '') + '：已奖励“' + v + '”', 'ok');
    }
    otherInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addOther(); }
      e.stopPropagation();
    });
    U.popover(node, {
      title: sid + '号 ' + (SE.name(cls, sid) || '') + ' · 奖励（同一项可记多次）',
      list: items,
      node: U.el('div', {}, [
        ob.box,
        U.el('div', { class: 'pop-other' }, [
          otherInput,
          U.el('button', { class: 'btn sm primary', text: '记下', onclick: addOther })
        ])
      ])
    });
  }

  /* 点格内按钮 */
  function clickAct(cls, sid, act) {
    if (!cls.draft) { U.toast('请先点“开始上课”，再标记出勤', 'err'); return; }
    ensureDraft(cls, true);
    const a = attOf(cls, sid);
    if (act === 'absent') {
      if (a.status === 'absent') resetAtt(a); else { resetAtt(a); a.status = 'absent'; }
    } else if (act === 'late') {
      if (a.status !== 'late') { resetAtt(a); a.status = 'late'; a.timing = true; a.lateStart = Date.now(); }
      else if (a.timing) { a.timing = false; a.lateMin = lateMinutes(a); U.toast(sid + '号 ' + (SE.name(cls, sid) || '') + ' 迟到 ' + a.lateMin + ' 分钟'); }
      else resetAtt(a);
    } else if (act === 'early') {
      if (a.status !== 'early') { resetAtt(a); a.status = 'early'; a.early = 'ok'; }   // 有故（绿）
      else if (a.early === 'ok') { a.early = 'bad'; }                                   // 无故（红）
      else resetAtt(a);                                                                 // 第三次取消
    } else {
      if (a.status === 'leave' && a.leave === act) resetAtt(a);
      else { resetAtt(a); a.status = 'leave'; a.leave = act; }
    }
    S.save();
    refresh();
  }
  V.clickAct = clickAct;

  /* ---------- 违纪（每一项同样可以叠加次数） ---------- */
  /** 违纪菜单：“其他”直接在菜单里填，不用先点“其他”再弹框 */
  function openViolMenu(node, cls, sid) {
    const a = attOf(cls, sid);
    const refs = [];
    const ctx = {
      kind: 'viol', refs: refs,
      drop: el => { if (el && el.parentNode) el.parentNode.removeChild(el); },
      get: (type, text) => {
        const list = attOf(cls, sid).viol || [];
        const hit = list.find(v => v.type === type && (type !== '其他' || v.text === text));
        return hit ? (parseInt(hit.n, 10) || 1) : 0;
      },
      change: (type, text, delta) => {
        addViolation(cls, sid, type, text, delta);
        refs.forEach(f => f());
      }
    };
    const items = VIOL_TYPES.filter(t => t !== '其他').map(t => ({
      label: t, cls: 'warn', node: stepBox(ctx, t, null),
      on: () => ctx.change(t, null, 1)
    }));
    const ob = otherBlock(ctx, () => attOf(cls, sid).viol || [], 'warn');
    if (a.viol && a.viol.length) {
      items.push('-');
      items.push({
        label: '清除全部违纪', cls: 'danger',
        on: () => { delete attOf(cls, sid).viol; S.save(); refresh(); }
      });
    }
    const otherInput = U.el('input', {
      class: 'input pop-input', placeholder: '其他行为（临时项，下次上课不会带过来）', maxlength: '20',
      title: '不属于上面几类的，直接写在这里，回车即可记下；记下后可以像固定项一样加减次数'
    });
    function addOther() {
      const v = otherInput.value.trim();
      if (!v) { U.toast('请填写具体行为', 'err'); return; }
      addViolation(cls, sid, '其他', v, 1);
      otherInput.value = '';
      ob.fill();                     // 立刻变成一行，菜单不关
      U.toast(sid + '号 ' + (SE.name(cls, sid) || '') + '：已记“' + v + '”', 'ok');
    }
    otherInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addOther(); }
      e.stopPropagation();
    });
    U.popover(node, {
      title: sid + '号 ' + (SE.name(cls, sid) || '') + ' · 违纪行为（同一项可记多次）',
      list: items,
      node: U.el('div', {}, [
        ob.box,
        U.el('div', { class: 'pop-other' }, [
          otherInput,
          U.el('button', { class: 'btn sm primary', text: '记下', onclick: addOther })
        ])
      ])
    });
  }

  /* ---------- 长期请假 / 转学 ---------- */
  function openStudentMenu(node, cls, sid) {
    const long = (cls.longLeave || []).indexOf(sid) >= 0;
    const items = [];

    /* 行为标签按钮：当场计档的随本节课结束消失，待办类（保证书/整改/回退）跨课保留 */
    if (A.tagSys) {
      const nm = SE.name(cls, sid) || '';
      const st = (cls.tags || {})[String(sid)] || {};
      if (cls.draft) {
        if (A.tagSys.stagedNow(cls, sid)) {
          items.push({
            label: '取消本节标红',
            on: () => {
              A.tagSys.unstageNow(cls, sid); S.save(); refresh();
              U.toast(sid + '号 ' + nm + '：已撤销本节课的红档', 'ok');
            }
          });
        } else if ((st.r || 0) < 4) {
          items.push({
            label: '当场标红',
            on: () => {
              A.tagSys.stageNow(cls, sid, 'hand'); S.save(); refresh();
              U.toast(sid + '号 ' + nm + '：已当场标红并计 1 档红', 'ok');
            }
          });
        }
      }
      (A.tagSys.actions(cls, sid) || []).forEach(act => {
        if (act === 'letterDone') items.push({
          label: '保证书已写',
          on: () => {
            A.tagSys.doAction(cls, sid, act); S.save(); refresh();
            U.toast(sid + '号 ' + nm + '：保证书已写，提醒消失', 'ok');
          }
        });
        if (act === 'dutyFix') items.push({
          label: '值日已整改',
          on: () => {
            A.tagSys.doAction(cls, sid, act); S.save(); refresh();
            U.toast(sid + '号 ' + nm + '：值日黄标已清零（整改已记入本节课，可撤销），再犯从头记录', 'ok');
          }
        });
        if (act === 'dutyUndo') items.push({
          label: '撤销整改',
          on: () => {
            const n = A.tagSys.undoFix(cls, sid); S.save(); refresh();
            U.toast(sid + '号 ' + nm + '：已撤销最近一次整改，黄标恢复 ' + n + ' 格', 'ok');
          }
        });
        if (act === 'redBack') items.push({
          label: '红标回退',
          on: () => {
            A.tagSys.doAction(cls, sid, act); S.save(); refresh();
            U.toast(sid + '号 ' + nm + '：红标已退一档，平时分上限 ' + (((((cls.tags || {})[String(sid)] || {}).rb) || 0) * 20) + ' 分', 'ok');
          }
        });
      });
      if (items.length) items.push('-');
    }

    items.push({
      label: long ? '取消长期请假' : '长期请假', cls: 'blue',
      on: () => {
        const arr = cls.longLeave = cls.longLeave || [];
        const i = arr.indexOf(sid);
        if (i >= 0) arr.splice(i, 1); else arr.push(sid);
        if (i < 0 && cls.draft) {
          const a = attOf(cls, sid);
          resetAtt(a); a.status = 'leave'; a.leave = 'w';
        }
        S.save(); refresh();
        U.toast(sid + '号 ' + (SE.name(cls, sid) || '') + (i < 0 ? '：以后默认标记“未回校”' : '：已取消长期请假'), 'ok');
      }
    });
    items.push('-');
    items.push({
      label: '电脑不可用',
      on: () => {
        const seat = SE.seatOfStudent(cls, sid);
        if (!seat) return;
        setBroken(cls, seat, true);
      }
    });
    items.push({
      label: '转学', cls: 'blue',
      on: () => {
        U.confirm('把 ' + sid + '号 ' + (SE.name(cls, sid) || '') + ' 标记为转学？该学生会从座位和考勤名单中移除（可在班级管理中恢复）。', () => {
          const seat = SE.seatOfStudent(cls, sid);
          if (seat) delete cls.seats[seat];
          if ((cls.transferred || []).indexOf(sid) < 0) cls.transferred.push(sid);
          delete cls.seatFix[sid];
          const i = (cls.longLeave || []).indexOf(sid);
          if (i >= 0) cls.longLeave.splice(i, 1);
          S.save(); refresh();
          U.toast('已标记转学，原座位变为空位', 'ok');
        });
      }
    });
    const tagTip = A.tagSys ? A.tagSys.stateText(cls, sid) : '';
    U.popover(node, { title: sid + '号 ' + (SE.name(cls, sid) || '') + '　座位 ' + SE.seatOfStudent(cls, sid) + (tagTip ? '　【' + tagTip + '】' : ''), list: items });
  }

  /* ---------- 电脑不可用 / 座次长期调整 ---------- */
  /**
   * 某台电脑坏了，把座上的学生挪到哪里？
   * 用的是全局同一套规则（SE.findRelocate）：本列最靠近讲台的长期空位 → 旁列 → 兜底。
   * 长期空位 = 没有在位学生把它当原始座位的位置，比如转学同学腾出来的座位。
   */
  function brokenTarget(cls, seatId) {
    return SE.findRelocate(cls, seatId, cls.seats);
  }
  V.brokenTarget = brokenTarget;
  /** 按学号规则，这个座位原本属于谁 */
  function originalOwner(cls, seatId) {
    return SE.ownerOf(cls, seatId);
  }
  function setBroken(cls, seatId, on) {
    const room = A.rooms.get(cls);
    if (on) {
      cls.broken[seatId] = true;
      A.rooms.setBroken(room, seatId, true, U.today());
      const sid = cls.seats[seatId];
      if (sid) {
        // 座位上还有人：挪到“本列最靠近讲台的长期空位”（本列没有再往旁列找），并长期记住
        const target = brokenTarget(cls, seatId);
        if (target) {
          delete cls.seats[seatId];
          cls.seats[target] = sid;
          cls.seatFix[sid] = target;
          if (cls.draft) {
            cls.draft.moves.push({ sid: sid, from: seatId, to: target, at: U.nowTime(), swap: null, empty: true, reason: 'broken' });
          }
          U.toast((SE.name(cls, sid) || sid + '号') + ' 已改到 ' + target + '（以后都记住这个位置）', 'ok');
        }
      } else {
        // 座位已经空了（老师先把人调走再标记不可用）：把他现在坐的位置记为长期位置
        const owner = originalOwner(cls, seatId);
        const now = owner ? SE.seatOfStudent(cls, owner) : null;
        if (owner && now && now !== seatId) {
          cls.seatFix[owner] = now;
          U.toast(owner + ' 号现在坐在 ' + now + '，以后每节课都按这个安排（' + seatId + ' 不可用）', 'ok');
        }
      }
    } else {
      delete cls.broken[seatId];
      A.rooms.setBroken(room, seatId, false);
      // 电脑修好了：座位空着就让本人立刻回来，不用等下节课
      const back = SE.returnOwner(cls, seatId);
      if (back) {
        if (cls.draft) {
          cls.draft.moves.push({ sid: back.sid, from: back.from, to: back.to, at: U.nowTime(), swap: null, empty: true, auto: true, reason: 'return' });
        }
        U.toast('已取消标记，' + back.sid + ' ' + (SE.name(cls, back.sid) || '') + ' 回到自己的座位 ' + seatId, 'ok');
      } else {
        const owner = originalOwner(cls, seatId);
        if (owner && cls.seatFix[owner] && cls.seatFix[owner] !== seatId) {
          delete cls.seatFix[owner];
          U.toast('已取消标记，' + owner + ' 号下节课回到 ' + seatId, 'ok');
        }
      }
    }
    cls.lastSeats = Object.assign({}, cls.seats);
    S.save(); refresh();
  }
  V.setBroken = setBroken;

  /* ---------- 渲染 ---------- */
  function render() {
    const cls = S.current();
    // 还没开始上课：机房里的“电脑不可用”可能刚被别的班改过，先对齐一遍座次，
    // 免得出现“座位标了不可用、人却还写在这个座位上（格子里只剩‘电脑不可用’，人看起来不见了）”
    if (!cls.draft) {
      const before = JSON.stringify(cls.broken || {});
      const beforeSeats = JSON.stringify(cls.seats || {});
      const rep = SE.reseat(cls);      // 统一结算：原位修好的回家，原位还坏的按规则换
      if (JSON.stringify(cls.broken || {}) !== before || JSON.stringify(cls.seats || {}) !== beforeSeats) S.save();
      const say = (t, k) => setTimeout(() => U.toast(t, k), 300);
      if (rep.back && rep.back.length) {
        say('电脑修好了：' + rep.back.map(m => m.sid + '号回到 ' + m.to).join('、'), 'ok');
      }
      if (rep.moved.length) {
        say('有 ' + rep.moved.length + ' 人因“电脑不可用”已按规则换到新座位（见右侧换座记录）', 'err');
      }
      if (rep.stuck.length) {
        say('座位不够：' + rep.stuck.join('、') + ' 号还没安排座位，请先修好电脑或在“换座”里手动安排', 'err');
      }
    }
    const root = document.getElementById('view-attendance');
    root.innerHTML = '';
    root.appendChild(toolbar(cls));
    const wrap = U.el('div', { class: 'att-wrap' });
    wrap.appendChild(stage(cls));
    wrap.appendChild(U.el('div', { class: 'side', id: 'attSide' }));
    root.appendChild(wrap);
    renderSide(cls);
    startTimer(cls);
  }
  V.attendance = { render };
  V.renderAttendance = render;

  function refresh() {
    const cls = S.current();
    const old = document.getElementById('seatGrid');
    if (old) old.parentNode.replaceChild(buildGrid(cls), old);
    renderSide(cls);
  }

  function renderSide(cls) {
    const old = document.getElementById('attSide');
    if (!old) return;
    const side = U.el('div', { class: 'side', id: 'attSide' });
    side.appendChild(statsCard(cls));
    side.appendChild(listsCard(cls));
    side.appendChild(movesCard(cls));
    old.parentNode.replaceChild(side, old);
  }

  /* ---------- 工具条 ---------- */
  function toolbar(cls) {
    const d = cls.draft;
    const tb = U.el('div', { class: 'att-toolbar' });

    if (!d) {
      tb.appendChild(U.el('button', {
        class: 'btn primary', text: '开始上课',
        onclick: () => {
          const nd = ensureDraft(cls, true);
          if (A.tagSys && A.tagSys.revealDuty) A.tagSys.revealDuty(cls);   // 上节课值日的黄标从现在起显示
          if (A.records && A.records.collapseAll) A.records.collapseAll(); // 上节课的记录自动折叠
          render();
          U.toast('本学期第 ' + nd.termNo + ' 次课已开始 · ' + nd.time, 'ok');
          const badN = nd.moves.filter(m => m.reason !== 'return').length;
          if (badN) U.toast('有 ' + badN + ' 人因座位“电脑不可用”已自动调整，见右侧换座记录', 'err');
        }
      }));
    } else if (!d.ended) {
      tb.appendChild(U.el('button', {
        class: 'btn stop', text: '结束上课',
        onclick: () => {
          d.ended = true; d.endAt = Date.now(); d.endTime = U.nowTime();
          state.moving = false; state.pickFrom = null;
          cls.lastSeats = Object.assign({}, cls.seats);   // 记住本节课的座次，供下节课安排有问题的座位
          S.save(); render();
          // 不弹窗打断：作业可能还没改，老师改完再去课堂记录页保存
          U.toast('第 ' + d.termNo + ' 次课已结束（' + d.time + ' — ' + d.endTime + '）', 'ok');
          U.toast('改完作业后到“课堂记录”页点“保存本节课数据”归档');
        }
      }));
    } else {
      tb.appendChild(U.el('button', {
        class: 'btn', text: '继续上课（撤销结束）',
        onclick: () => { d.ended = false; d.endAt = null; d.endTime = null; S.save(); render(); }
      }));
    }

    if (d) {
      tb.appendChild(U.el('div', { class: 'att-lesson', html:
        '本学期第 <span class="no">' + d.termNo + '</span> 次课' + (d.topic ? ' · ' + d.topic : '') +
        ' · ' + d.date + ' ' + d.time +
        (d.ended ? ' — ' + d.endTime + '（已结束）' : '（进行中）') }));
      if (d.ended) tb.appendChild(U.el('span', { class: 'chip', html: '<b>待保存到课堂记录</b>' }));
    } else {
      tb.appendChild(U.el('div', { class: 'att-lesson', text: cls.name + ' · 尚未开始上课（下一节：本学期第 ' + S.nextTermNo(cls) + ' 次课）' }));
    }

    tb.appendChild(U.el('div', { style: { marginLeft: 'auto' } }));

    tb.appendChild(U.el('button', {
      class: 'btn sm ' + (S.load().showTags ? 'on' : ''),
      text: S.load().showTags ? '隐藏色标' : '显示色标',
      title: '显示 / 隐藏本学期的红黄标签；当堂当场标红的始终显示，下课保存后自动回到隐藏',
      onclick: () => { S.load().showTags = !S.load().showTags; S.save(); render(); }
    }));
    tb.appendChild(U.el('button', {
      class: 'btn sm ' + (state.moving ? 'on' : ''),
      text: state.moving ? '换座中（点击退出）' : '换座',
      onclick: () => {
        if (!cls.draft) { U.toast('请先开始上课', 'err'); return; }
        state.moving = !state.moving; state.pickFrom = null;
        render();
        if (state.moving) U.toast('换座模式：拖动名片到目标座位，或先后点击两个座位（空位也可以）');
      }
    }));
    tb.appendChild(U.el('button', {
      class: 'btn sm', text: '重置座次',
      onclick: () => U.confirm('把学生按学号重新排回原始座位？（本节课的换座调整会清空；标记为“电脑不可用”的座位仍然不可用）', () => {
        ensureDraft(cls, true);
        const built = SE.buildLessonSeats(cls);
        cls.seats = built.seats;
        cls.draft.moves = built.autoMoves.map(m => ({
          sid: m.sid, from: m.from, to: m.to, at: U.nowTime(), swap: null, empty: true, auto: true, reason: m.reason
        }));
        cls.draft.seatsSnapshot = Object.assign({}, cls.seats);
        S.save(); render(); U.toast('已重置座次', 'ok');
      })
    }));
    tb.appendChild(U.el('button', { class: 'btn sm', text: '上传花名册', onclick: () => A.roster.upload(cls, render) }));
    tb.appendChild(U.el('button', {
      class: 'btn sm', text: '全班恢复出勤',
      onclick: () => {
        if (!cls.draft) { U.toast('请先开始上课', 'err'); return; }
        U.confirm('把全班都恢复成“出勤”吗？本节点过的缺勤、迟到、早退、请假、违纪都会被清空。', () => {
          cls.draft.att = {};
          // 因违纪满 3 当场自动计的档，随违纪清空一起退回；手动当场标红的保留
          if (A.tagSys && cls.draft.redCounted) {
            Object.keys(cls.draft.redCounted).forEach(sid => {
              if (cls.draft.redCounted[sid] === 'auto') {
                const st2 = A.tagSys.stateOf(cls, sid);
                if (st2 && st2.r > 0) st2.r -= 1;
                delete cls.draft.redCounted[sid];
              }
            });
          }
          (cls.longLeave || []).forEach(sid => { cls.draft.att[sid] = { status: 'leave', leave: 'w', auto: true }; });
          S.save(); refresh(); U.toast('已全部恢复为出勤（长期请假仍标未回校）', 'ok');
        });
      }
    }));
    return tb;
  }

  /* ---------- 舞台 ---------- */
  function stage(cls) {
    const st = U.el('div', { class: 'stage' });
    if (state.moving) {
      st.appendChild(U.el('div', {
        class: 'move-tip',
        text: '换座模式：把学生名片拖到新座位（空位也可以放），或先点一个座位再点目标座位。再次点上方“换座中”按钮退出。'
      }));
    }
    const head = U.el('div', { class: 'grid-head' });
    SE.displayCols(cls).forEach(c => head.appendChild(U.el('div', { text: c + ' 列' })));
    st.appendChild(head);
    st.appendChild(buildGrid(cls));
    st.appendChild(U.el('div', { class: 'platform', text: '讲 台 / 教师机' }));
    return st;
  }

  function buildGrid(cls) {
    const grid = U.el('div', { class: 'seat-grid' + (state.moving ? ' moving' : ''), id: 'seatGrid' });
    const cols = SE.displayCols(cls);
    for (let row = SE.ROWS; row >= 1; row--) {
      cols.forEach(col => grid.appendChild(seatNode(cls, SE.id(col, row))));
    }
    return grid;
  }

  /* ---------- 座位 ---------- */
  function seatNode(cls, seatId) {
    const sid = cls.seats[seatId];
    const node = U.el('div', { class: 'seat', 'data-seat': seatId });

    if (cls.broken[seatId]) {
      node.classList.add('broken');
      node.appendChild(U.el('div', { class: 'sid', text: seatId }));
      // 兜底：万一还有人被记在这个座位上（机房座位不够时），至少把名字显示出来，不能让人凭空消失
      node.appendChild(U.el('div', { class: 'sname', text: sid ? (sid + '号 ' + (SE.name(cls, sid) || '') + ' · 无电脑') : '电脑不可用' }));
      bindSeat(node, cls, seatId, null);
      return node;
    }
    if (!sid) {
      node.classList.add('empty');
      node.appendChild(U.el('div', { class: 'sid', text: seatId }));
      node.appendChild(U.el('div', { class: 'sname', text: '空位' }));
      bindSeat(node, cls, seatId, null);
      return node;
    }

    const a = attOf(cls, sid);
    const st = a.status || 'present';
    node.classList.add(st);
    if (st === 'early') node.classList.add(a.early === 'bad' ? 'early-bad' : 'early-ok');

    // 行为标签：未上课跟「显示色标」开关；上课期间两类强制显示（无视开关）——
    // ① 本节课当场计过红档的红（全红除外）；② 上节课值日积累、还没整改的黄标（转红后跟开关）。
    // 用 backgroundImage 叠加，保留座位本身的底色，渐变末端已用 transparent 截断成真实格子宽。
    // 两层色带上下分开：第一层（红）占上半，第二层（黄）占下半，互不遮挡、互不挤压。
    if (A.tagSys) {
      const tagBg = (A.tagSys.autoShow(cls, sid) || S.load().showTags) ? A.tagSys.bg(cls, sid) : '';
      if (tagBg) {
        node.style.backgroundImage = tagBg;
        node.style.backgroundSize = '100% 50%, 100% 50%';
        node.style.backgroundRepeat = 'no-repeat, no-repeat';
        node.style.backgroundPosition = '0 0, 0 100%';
      }
    }

    const isLong = (cls.longLeave || []).indexOf(sid) >= 0;
    const top = U.el('div', { class: 's-top' });
    top.appendChild(U.el('span', { class: 'sid', text: String(sid) }));
    const nameBtn = U.el('button', {
      class: 'sname-btn' + (isLong ? ' long-leave' : ''),
      text: (SE.name(cls, sid) || '（未录入姓名）') + (isLong ? ' ·长休' : ''),
      title: '点这里：标记长期请假 / 转学'
    });
    nameBtn.addEventListener('click', e => { e.stopPropagation(); openStudentMenu(nameBtn, cls, sid); });
    top.appendChild(nameBtn);

    const aN = countOf(a.award);
    const aBtn = U.el('button', {
      class: 'vbtn award' + (aN ? ' has' : ''),
      text: aN ? String(aN) : '奖',
      title: '记录奖励：回答 / 助人 / 纪律 / 值日 / 其他（同一项可以记多次）'
    });
    aBtn.addEventListener('click', e => { e.stopPropagation(); openAwardMenu(aBtn, cls, sid); });
    top.appendChild(aBtn);

    const vN = countOf(a.viol);
    const vBtn = U.el('button', {
      class: 'vbtn viol' + (vN ? ' has' : ''),
      text: vN ? String(vN) : '违',
      title: '记录违纪行为（同一项可以记多次）'
    });
    vBtn.addEventListener('click', e => { e.stopPropagation(); openViolMenu(vBtn, cls, sid); });
    top.appendChild(vBtn);

    if (st === 'late') {
      top.appendChild(U.el('span', { class: 'late-min', text: (a.timing ? '⏱' : '') + lateMinutes(a) + '分' }));
    } else {
      top.appendChild(U.el('span', { class: 'seatno', text: seatId }));
    }
    node.appendChild(top);

    node.appendChild(U.el('div', { class: 's-btns' }, [
      actBtn(cls, sid, 'absent'), actBtn(cls, sid, 'late'), actBtn(cls, sid, 'early')
    ]));
    node.appendChild(U.el('div', { class: 's-btns' }, [
      actBtn(cls, sid, 'w'), actBtn(cls, sid, 'x'), actBtn(cls, sid, 'q')
    ]));

    if (a.viol && a.viol.length) {
      node.appendChild(U.el('div', { class: 'viol-line', title: violText(a.viol), text: violText(a.viol) }));
    }
    if (a.award && a.award.length) {
      node.appendChild(U.el('div', { class: 'award-line', title: '奖励：' + awardText(a.award), text: awardText(a.award) }));
    }

    node.title = '学号 ' + sid + '　座位 ' + seatId + '　作业文件夹：' + SE.folderName(cls, seatId);
    if (state.moving) node.draggable = true;
    bindSeat(node, cls, seatId, sid);
    if (state.pickFrom === seatId) node.classList.add('pick-src');
    return node;
  }

  function actBtn(cls, sid, act) {
    const a = attOf(cls, sid);
    let on = false, color = '';
    if (act === 'absent') { on = a.status === 'absent'; color = 'red'; }
    else if (act === 'late') { on = a.status === 'late'; color = 'orange'; }
    else if (act === 'early') { on = a.status === 'early'; color = a.status === 'early' ? (a.early === 'bad' ? 'red' : 'green') : 'green'; }
    else { on = a.status === 'leave' && a.leave === act; color = 'blue'; }
    const cfg = ACT[act];
    const b = U.el('button', {
      class: 'abtn' + (on ? ' on ' + color : ''),
      text: cfg.text, title: cfg.tip, 'data-act': act
    });
    b.addEventListener('click', e => { e.stopPropagation(); clickAct(cls, sid, act); });
    return b;
  }

  function bindSeat(node, cls, seatId, sid) {
    node.addEventListener('click', e => {
      if (state.moving) {
        if (!state.pickFrom) {
          if (!sid) { U.toast('请先点击一个“有学生”的座位', 'err'); return; }
          state.pickFrom = seatId; refresh(); U.toast('已选择 ' + sid + ' 号，请点击目标座位');
        } else {
          if (state.pickFrom === seatId) { state.pickFrom = null; refresh(); return; }
          doMove(cls, state.pickFrom, seatId);
          state.pickFrom = null;
          refresh();
        }
        return;
      }
      if (!sid) openEmptyMenu(node, cls, seatId);
    });
    node.addEventListener('dragstart', e => {
      if (!state.moving || !sid) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', seatId);
      e.dataTransfer.effectAllowed = 'move';
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));
    node.addEventListener('dragover', e => {
      if (!state.moving || cls.broken[seatId]) return;
      e.preventDefault();
      node.classList.add('drop-hint');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-hint'));
    node.addEventListener('drop', e => {
      e.preventDefault();
      node.classList.remove('drop-hint');
      if (!state.moving) return;
      const from = e.dataTransfer.getData('text/plain');
      if (!from || from === seatId) return;
      doMove(cls, from, seatId);
      refresh();
    });
  }

  function doMove(cls, from, to) {
    if (cls.broken[to]) { U.toast('该座位已标记为电脑不可用', 'err'); return; }
    const a = cls.seats[from], b = cls.seats[to];
    if (!a) return;
    if (b) cls.seats[from] = b; else delete cls.seats[from];
    cls.seats[to] = a;
    if (cls.broken[from]) cls.seatFix[a] = to;   // 从坏电脑位挪走的，长期记住
    const d = ensureDraft(cls, true);
    d.moves.push({ sid: a, from: from, to: to, at: U.nowTime(), swap: b || null, empty: !b });
    cls.lastSeats = Object.assign({}, cls.seats);
    S.save();
    U.toast((SE.name(cls, a) || a + '号') + '：' + from + ' → ' + to +
      (b ? '（与 ' + (SE.name(cls, b) || b + '号') + ' 互换）' : '（移到空位）'), 'ok');
  }
  V.doMove = doMove;

  /** 单独撤销某一条换座：只把这位同学挪回去，后面的调整照旧 */
  function undoMove(cls, i) {
    const d = cls.draft;
    if (!d || !d.moves[i]) { U.toast('这条换座记录已经不在了', 'err'); return; }
    const m = d.moves[i];
    if (cls.seats[m.to] !== m.sid) {
      U.toast(m.sid + '号现在不在 ' + m.to + '，这条不能单独撤销', 'err');
      return;
    }
    const back = cls.seats[m.from];
    if (back === undefined) delete cls.seats[m.to];
    else cls.seats[m.to] = back;          // 原位置现在有人：两边换回来
    cls.seats[m.from] = m.sid;
    if (cls.seatFix && cls.seatFix[m.sid] === m.to) delete cls.seatFix[m.sid];
    d.moves.splice(i, 1);
    cls.lastSeats = Object.assign({}, cls.seats);
    S.save(); refresh();
    U.toast('已撤销：' + m.sid + '号 ' + m.from + ' → ' + m.to, 'ok');
  }
  V.undoMove = undoMove;

  function openEmptyMenu(node, cls, seatId) {
    U.popover(node, {
      title: '空位 ' + seatId + '　作业文件夹：' + SE.folderName(cls, seatId),
      list: [
        {
          label: cls.broken[seatId] ? '取消“电脑不可用”' : '标记此电脑不可用', cls: 'danger',
          on: () => setBroken(cls, seatId, !cls.broken[seatId])
        },
        {
          label: '把最近移出的学生放回这里', on: () => {
            const d = ensureDraft(cls, true);
            if (!d.moves.length) { U.toast('本节课还没有换座记录'); return; }
            const last = d.moves[d.moves.length - 1];
            doMove(cls, last.to, seatId); refresh();
          }
        }
      ]
    });
  }

  /* 把座次按给定的换座记录从开课快照重放一遍 */
  function replaySeats(cls, moves) {
    const d = cls.draft || {};
    const base = Object.assign({}, d.seatsSnapshot || SE.baseSeats(cls));
    (moves || []).forEach(m => {
      const a = base[m.from];
      if (a === undefined) return;
      const b = base[m.to];
      if (b !== undefined) { base[m.from] = b; base[m.to] = a; }
      else { delete base[m.from]; base[m.to] = a; }
    });
    cls.seats = base;
  }
  V.replaySeats = replaySeats;

  /* ---------- 统计 ---------- */
  function computeStats(cls) {
    const d = cls.draft || { att: {}, moves: [] };
    const active = S.activeStudents(cls);
    const total = active.length;
    const absent = [], late = [], leave = [], timing = [], earlyOk = [], earlyBad = [], viol = [], award = [];
    active.forEach(n => {
      const a = d.att[n] || { status: 'present' };
      if (a.status === 'absent') absent.push(n);
      else if (a.status === 'late') { late.push(n); if (a.timing) timing.push(n); }
      else if (a.status === 'leave') leave.push(n);
      else if (a.status === 'early') { if (a.early === 'bad') earlyBad.push(n); else earlyOk.push(n); }
      if (a.viol && a.viol.length) viol.push({ sid: n, list: a.viol });
      if (a.award && a.award.length) award.push({ sid: n, list: a.award });
    });
    return { total, absent, late, leave, timing, earlyOk, earlyBad, viol, award, present: total - absent.length - leave.length - timing.length };
  }
  V.computeStats = computeStats;

  function statsCard(cls) {
    const st = computeStats(cls);
    const card = U.el('div', { class: 'card pad' });
    card.appendChild(U.el('h4', { class: 'section-title', text: '本节统计' }));
    const g = U.el('div', { class: 'stat-grid' });
    const add = (n, l, c) => g.appendChild(U.el('div', { class: 'stat ' + (c || '') }, [
      U.el('div', { class: 'n', text: String(n) }), U.el('div', { class: 'l', text: l })
    ]));
    add(st.total, '应到', '');
    add(st.present, '实到', 'ok');
    add(st.absent.length, '缺勤', 'danger');
    add(st.late.length, '迟到', 'warn');
    add(st.earlyOk.length + st.earlyBad.length, '早退', '');
    add(st.leave.length, '请假', 'blue');
    add(st.viol.length, '违纪', 'warn');
    add(st.award.length, '奖励', 'ok');
    add(Object.keys(cls.broken).length, '座位不可用', '');
    card.appendChild(g);
    if (st.earlyOk.length || st.earlyBad.length) {
      card.appendChild(U.el('div', { class: 'small', style: { marginTop: '8px' }, html:
        '早退：有故 <b style="color:#16a34a">' + st.earlyOk.length + '</b> 人 · 无故 <b style="color:#dc2626">' + st.earlyBad.length + '</b> 人' }));
    }
    return card;
  }

  function nameTags(cls, ids, c) {
    if (!ids.length) return U.el('div', { class: 'muted small', text: '无' });
    return U.el('div', { class: 'name-list' }, ids.map(id =>
      U.el('span', { class: 'name-tag ' + (c || ''), text: id + ' ' + (SE.name(cls, id) || '') })));
  }

  function listsCard(cls) {
    const st = computeStats(cls);
    const card = U.el('div', { class: 'card pad' });
    card.appendChild(U.el('h4', { class: 'section-title', text: '名单' }));
    const block = (title, node) => card.appendChild(U.el('div', { style: { marginBottom: '10px' } }, [
      U.el('div', { class: 'small muted', text: title }), node
    ]));
    block('缺勤（' + st.absent.length + '）', nameTags(cls, st.absent, 'danger'));
    block('迟到（' + st.late.length + '）', st.late.length
      ? U.el('div', { class: 'name-list' }, st.late.map(sid => {
        const a = (cls.draft.att[sid] || {});
        return U.el('span', { class: 'name-tag warn', text: sid + ' ' + (SE.name(cls, sid) || '') + ' · ' + lateMinutes(a) + '分' });
      }))
      : U.el('div', { class: 'muted small', text: '无' }));
    block('早退 · 有故（' + st.earlyOk.length + '）', nameTags(cls, st.earlyOk, 'green'));
    block('早退 · 无故（' + st.earlyBad.length + '）', nameTags(cls, st.earlyBad, 'danger'));
    block('请假（' + st.leave.length + '）', st.leave.length
      ? U.el('div', { class: 'name-list' }, st.leave.map(sid => {
        const a = (cls.draft.att[sid] || {});
        return U.el('span', { class: 'name-tag blue', text: sid + ' ' + (SE.name(cls, sid) || '') + ' · ' + (LEAVE_TEXT[a.leave] || '') });
      }))
      : U.el('div', { class: 'muted small', text: '无' }));
    block('违纪（' + st.viol.length + '人）', st.viol.length
      ? U.el('div', { class: 'name-list' }, st.viol.map(v =>
        U.el('span', { class: 'name-tag warn', text: v.sid + '（' + violText(v.list) + '）' })))
      : U.el('div', { class: 'muted small', text: '无' }));
    block('奖励（' + st.award.length + '人）', st.award.length
      ? U.el('div', { class: 'name-list' }, st.award.map(v =>
        U.el('span', { class: 'name-tag green', text: v.sid + '（' + awardText(v.list) + '）' })))
      : U.el('div', { class: 'muted small', text: '无' }));
    const longOn = (cls.longLeave || []).filter(s => (cls.transferred || []).indexOf(s) < 0);
    if (longOn.length) block('长期请假（' + longOn.length + '）', nameTags(cls, longOn, 'blue'));
    return card;
  }

  function movesCard(cls) {
    const d = cls.draft || { moves: [] };
    const card = U.el('div', { class: 'card pad' });
    card.appendChild(U.el('h4', { class: 'section-title', text: '本节换座记录（' + d.moves.length + '）' }));
    const list = U.el('div', { class: 'log-list' });
    if (!d.moves.length) list.appendChild(U.el('div', { class: 'muted small', text: '暂无调整' }));
    d.moves.slice().reverse().forEach((m, idx) => {
      const real = d.moves.length - 1 - idx;
      list.appendChild(U.el('div', { class: 'log-item' }, [
        U.el('span', { html: '<b>' + m.sid + ' ' + (SE.name(cls, m.sid) || '') + '</b> ' + m.from + ' → ' + m.to +
          (m.reason === 'return' ? '<span class="tag-auto">归位</span>'
            : (m.auto ? '<span class="tag-auto">不可用</span>' : (m.swap ? '（互换）' : '（空位）'))) +
          '　<span class="muted">' + m.at + '</span>' }),
        U.el('button', {
          class: 'btn ghost sm', text: '撤销',
          style: { marginLeft: '6px', padding: '1px 6px' },
          title: '只撤销这一条，后面的调整不受影响',
          onclick: () => undoMove(cls, real)
        })
      ]));
    });
    card.appendChild(list);
    return card;
  }

  function startTimer(cls) {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => {
      const d = cls.draft;
      if (!d) return;
      U.$$('#view-attendance .seat').forEach(node => {
        const sid = cls.seats[node.getAttribute('data-seat')];
        if (!sid) return;
        const a = d.att[sid];
        if (!a || a.status !== 'late' || !a.timing) return;
        const m = node.querySelector('.late-min');
        if (m) m.textContent = '⏱' + lateMinutes(a) + '分';
      });
    }, 20000);
  }

})(window.App);
