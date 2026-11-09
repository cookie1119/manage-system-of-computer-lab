/* 课堂记录页：结束上课后保存本节课数据、手动增删改记录 */
(function (A) {
  'use strict';
  const U = A.util, SE = A.seats, S = A.store;
  const V = A.views = A.views || {};

  const state = { open: {}, scope: 'current' };
  const LEAVE_TEXT = { w: '未回校', x: '校医', q: '其他' };

  /* ---------- 从草稿构造一条记录 ---------- */
  function draftToRecord(cls) {
    const d = cls.draft;
    // 老师可能先传作业、后点“请假”，这里按最新考勤再刷一遍作业状态
    if (d.homework && d.homework.statuses && A.homework && A.homework.applyLeave) {
      A.homework.applyLeave(cls, d.homework);
    }
    const st = A.views.computeStats(cls);
    const active = S.activeStudents(cls);
    const lateList = st.late.map(sid => {
      const a = d.att[sid] || {};
      return { sid: sid, min: a.lateMin || (a.lateStart ? Math.max(0, Math.round((Date.now() - a.lateStart) / 60000)) : 0) };
    });
    const leaveList = st.leave.map(sid => ({ sid: sid, type: (d.att[sid] || {}).leave || 'q' }));
    // 早退（有故 ok / 无故 bad）
    const earlyList = active.filter(sid => d.att[sid] && d.att[sid].status === 'early')
      .map(sid => ({ sid: sid, reason: d.att[sid].early === 'bad' ? 'bad' : 'ok' }));
    // 违纪（同一项可以记多次，n 是次数）
    const violList = active.filter(sid => d.att[sid] && d.att[sid].viol && d.att[sid].viol.length)
      .map(sid => ({
        sid: sid,
        list: d.att[sid].viol.map(v => ({ type: v.type, text: v.text || '', n: parseInt(v.n, 10) || 1 }))
      }));
    // 奖励（回答/助人/纪律/值日/其他，期末每项 +1）
    const awardList = active.filter(sid => d.att[sid] && d.att[sid].award && d.att[sid].award.length)
      .map(sid => ({
        sid: sid,
        list: d.att[sid].award.map(v => ({ type: v.type, text: v.text || '', n: parseInt(v.n, 10) || 1 }))
      }));
    // 作业：每个人一个状态（缺交 / 数量错误 / 命名错误 / 正确）
    const hwStatus = (d.homework && d.homework.statuses) ? d.homework.statuses : [];
    let hw = null;
    if (d.homework) {
      // 请假不算“已交”也不算异常，单独一列
      const done = hwStatus.filter(x => x.status !== 'missing' && x.status !== 'leave');
      hw = {
        reqs: d.homework.reqs || [],
        submitted: done.length,
        leave: hwStatus.filter(x => x.status === 'leave').map(x => x.sid),
        missing: hwStatus.filter(x => x.status === 'missing').map(x => x.sid),
        bad: hwStatus.filter(x => x.status !== 'missing' && x.status !== 'ok' && x.status !== 'leave')
          .map(x => ({ sid: x.sid, missing: x.detail && x.detail.length ? x.detail : [x.status] })),
        unknown: (d.homework.unknown || []).map(x => x.folder)
      };
    }
    return {
      id: 'r_' + U.uid(),
      termNo: d.termNo,
      topic: d.topic || '',
      date: d.date,
      time: d.time + (d.endTime ? ' - ' + d.endTime : ''),
      className: cls.name,
      absent: st.absent.slice(),
      late: lateList,
      leave: leaveList,
      early: earlyList,
      violations: violList,
      awards: awardList,
      hwStatus: hwStatus.map(x => ({
        sid: x.sid, status: x.status,
        auto: x.auto || x.status, manual: x.manual || '',
        detail: (x.detail || []).join('；'),
        submitted: x.submitted || ''
      })),
      missing: hw ? hw.missing.slice() : [],
      homework: hw,
      moves: d.moves.slice(),
      redMarked: (d.redMark || []).slice(),   // 本节课当场写过保证书（标红）的学生
      redCounted: Object.assign({}, d.redCounted || {}), // 本节课已当场计档的学生（去重用）
      note: d.note || ''
    };
  }

  function recalc(rec, cls) {
    const total = S.activeStudents(cls).length;
    rec.className = cls.name;
    rec.early = rec.early || [];
    rec.violations = rec.violations || [];
    rec.awards = rec.awards || [];
    rec.hwStatus = rec.hwStatus || [];
    rec.stats = {
      total: total,
      present: total - rec.absent.length - rec.leave.length,
      absent: rec.absent.length,
      late: rec.late.length,
      leave: rec.leave.length,
      missing: rec.missing.length,
      earlyOk: rec.early.filter(x => x.reason !== 'bad').length,
      earlyBad: rec.early.filter(x => x.reason === 'bad').length,
      viol: rec.violations.length,
      award: rec.awards.length,
      // 同一项记了多次就按多次算（回答×2 = 2 项）
      violItem: (rec.violations || []).reduce((n, a) => n + A.views.countOf(a.list), 0),
      awardItem: (rec.awards || []).reduce((n, a) => n + A.views.countOf(a.list), 0)
    };
    if (rec.homework) rec.homework.missing = rec.missing.slice();
    return rec;
  }

  /** “已上 N 节”永远跟着实际记录走：有记录就取记录里最大的“第几次课”，
      一条都不剩就归零。以前用 Math.max 只增不减，删掉记录后首页会一直显示旧数字。 */
  function syncLessonCount(cls) {
    if (!cls) return 0;
    cls.lessonCount = (cls.records || []).reduce((m, r) => Math.max(m, r.termNo || 0), 0);
    return cls.lessonCount;
  }

  /* ---------- 保存本节课 ---------- */
  /** 本节课有没有上传过作业（上传过就有每人一条的状态） */
  function hasHomework(cls) {
    const d = cls.draft;
    return !!(d && d.homework && (d.homework.statuses || []).length);
  }

  function saveCurrentLesson(cls) {
    const d = cls.draft;
    if (!d) { U.toast('本节课还没有开始', 'err'); return; }
    if (!d.ended) {
      U.modal({
        title: '请先结束上课',
        body: U.el('div', { text: '本节课还在进行中。请回到考勤页点“结束上课”，之后即可在这里保存本节课数据。' }),
        buttons: [
          { label: '知道了' },
          { label: '去考勤页', cls: 'primary', onClick: () => A.app.show('attendance') }
        ]
      });
      return;
    }
    // 保存前先问一句：多数时候是忘了改作业就急着存档
    if (!hasHomework(cls)) {
      const reqN = (cls.homeworkReq || []).length;
      U.modal({
        title: '本节课还没上传作业',
        body: U.el('div', {}, [
          U.el('div', { text: '现在保存的话，这次课的作业记录会留空，之后要补就麻烦了。' }),
          U.el('div', {
            class: 'small muted', style: { marginTop: '8px' }, html: reqN
              ? '你已经设好了 <b>' + reqN + ' 条作业要求</b>，先到“作业批改”页把作业传上去？'
              : '本节课还没设置作业要求。要收作业的话，先到“作业批改”页设好要求再上传。'
          }),
          U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text: '这节课本来就不收作业的话，点“不上传，直接保存”。' })
        ]),
        buttons: [
          { label: '取消' },
          { label: '不上传，直接保存', onClick: doSave },
          {
            label: '去上传作业', cls: 'primary', onClick: () => {
              A.app.show('homework');
              U.toast('传完作业再回到“课堂记录”页点保存', 'ok');
            }
          }
        ]
      });
      return;
    }
    doSave();

    function doSave() {
      const rec = draftToRecord(cls);
      recalc(rec, cls);
      openEditor(cls, rec, true, () => {
        cls.records.push(rec);
        syncLessonCount(cls);
        // 行为标签：本节课结束落库，推进值日/红标链；色标显示回到默认隐藏
        if (A.tagSys) A.tagSys.onNewRecord(cls, rec);
        S.load().showTags = false;
        cls.draft = null;
        // 为下节课做准备：作业要求与上传的作业一起清空（同学段同课次的模板还在）
        if (V.resetHomework) V.resetHomework(cls); else cls.homeworkReq = [];
        state.open[rec.id] = true;
        S.save();
        render();
        U.toast('第 ' + rec.termNo + ' 次课已保存，作业要求已清空，可以准备下一节', 'ok');
      });
    }
  }

  /* ---------- 记录编辑弹窗（可手动改动一切） ---------- */
  function openEditor(cls, rec, isNew, onSave) {
    const termInput = U.el('input', { class: 'input', type: 'number', min: '1', value: rec.termNo });
    const topicInput = U.el('input', { class: 'input', value: rec.topic || '', placeholder: '如：用 WPS 做一份自我介绍', maxlength: '40' });
    const dateInput = U.el('input', { class: 'input', type: 'date', value: rec.date || U.today() });
    const timeInput = U.el('input', { class: 'input', value: rec.time || '', placeholder: '如 08:00 - 08:45' });
    const noteInput = U.el('textarea', { class: 'input', rows: '2', value: rec.note || '', placeholder: '备注（可选）' });

    // 同年级同一个课次，上一位老师填的课题自动带过来
    let topicTouched = !!(rec.topic && String(rec.topic).trim());
    const applyTopic = (auto) => {
      if (topicTouched && !auto) return;
      const found = S.topicOf(cls, parseInt(termInput.value, 10) || rec.termNo);
      if (found && !topicTouched) topicInput.value = found;
    };
    applyTopic(true);
    topicInput.addEventListener('input', () => { topicTouched = true; });
    termInput.addEventListener('change', () => applyTopic(false));

    const body = U.el('div', {}, [
      U.el('div', { class: 'form-grid' }, [
        U.el('div', { class: 'field' }, [U.el('label', { text: '本学期第几次课' }), termInput]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '本节课课题（同年级同次课会自动沿用）' }), topicInput]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '上课日期' }), dateInput]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '上课时间' }), timeInput])
      ]),
      U.el('div', { class: 'small muted', style: { marginTop: '10px' }, text: '名单可手动增删：点“添加”从全班里选人，点标签上的 × 删除。' }),
      editorBlock(cls, '缺勤', 'danger', rec.absent, 'plain'),
      editorBlock(cls, '迟到', 'warn', rec.late, 'late'),
      editorBlock(cls, '早退', 'grey', rec.early, 'early'),
      editorBlock(cls, '请假', 'blue', rec.leave, 'leave'),
      editorBlock(cls, '违纪', 'warn', rec.violations, 'viol'),
      editorBlock(cls, '奖励（期末每项 +1）', 'green', rec.awards, 'award'),
      editorBlock(cls, '作业情况', 'grey', rec.hwStatus, 'hw'),
      U.el('div', { class: 'field', style: { marginTop: '12px' } }, [
        U.el('label', { text: '本节课备注' }),
        noteInput
      ])
    ]);
    if (rec.homework) {
      const b = rec.homework.bad || [];
      body.appendChild(U.el('div', { class: 'small muted', style: { marginTop: '10px' }, html:
        '作业：已交 <b>' + rec.homework.submitted + '</b> 人，缺件 <b>' + b.length + '</b> 人' +
        (b.length ? '（' + b.map(x => x.sid + ' 缺 ' + x.missing.join('/')).join('、') + '）' : '') }));
    }
    if (rec.moves && rec.moves.length) {
      body.appendChild(U.el('div', { class: 'small muted', style: { marginTop: '6px' }, html:
        '换座 ' + rec.moves.length + ' 次：' + rec.moves.map(m => m.sid + '号 ' + m.from + '→' + m.to).join('，') }));
    }

    U.modal({
      title: isNew ? '保存本节课数据' : '编辑课堂记录',
      body: body,
      buttons: [
        { label: '取消' },
        {
          label: isNew ? '确认保存' : '保存修改', cls: 'primary', onClick: () => {
            const t = parseInt(termInput.value, 10);
            if (!(t >= 1)) { U.toast('请填写第几次课', 'err'); return false; }
            rec.termNo = t;
            rec.topic = topicInput.value.trim();
            rec.date = dateInput.value || U.today();
            rec.time = timeInput.value.trim();
            rec.note = noteInput.value.trim();
            // 课题写进“同年级同课次”的模板，别的班这个课次会自动带上
            S.setTopic(cls, t, rec.topic);
            if (cls.draft && (!cls.draft.topic || !String(cls.draft.topic).trim())) cls.draft.topic = rec.topic;
            // 作业情况 -> 缺交名单同步
            if (rec.hwStatus && rec.hwStatus.length) {
              rec.missing = rec.hwStatus.filter(x => x.status === 'missing').map(x => x.sid);
              if (rec.homework) rec.homework.missing = rec.missing.slice();
            }
            recalc(rec, cls);
            onSave();
          }
        }
      ]
    });
  }

  /* 备注编辑（单条记录或本节课草稿都能用） */
  function editNote(target, title, after) {
    const ta = U.el('textarea', { class: 'input', rows: '4', placeholder: '这节课的情况、需要处理的事…', value: target.note || '' });
    U.modal({
      title: title || '备注',
      body: U.el('div', {}, [ta, U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text: '备注会随记录一起显示和导出。' })]),
      buttons: [
        { label: '取消' },
        {
          label: '保存备注', cls: 'primary', onClick: () => {
            target.note = ta.value.trim();
            S.save(); after && after();
            U.toast('备注已保存', 'ok');
          }
        }
      ]
    });
  }
  V.editNote = editNote;
  V.draftToRecord = draftToRecord;
  V.recalc = recalc;

  /* 名单编辑区：kind = plain(学号数组) / late({sid,min}) / leave({sid,type}) */
  function editorBlock(cls, title, color, items, kind) {
    const tagBox = U.el('div', { class: 'name-list' });
    function refresh() {
      tagBox.innerHTML = '';
      if (!items.length) tagBox.appendChild(U.el('span', { class: 'muted small', text: '（无）' }));
      items.forEach((it, i) => {
        const sid = kind === 'plain' ? it : it.sid;
        const tag = U.el('span', { class: 'name-tag ' + color }, [
          U.el('span', { text: sid + ' ' + (SE.name(cls, sid) || '') })
        ]);
        if (kind === 'late') {
          const inp = U.el('input', {
            class: 'mini-input', type: 'number', min: '0', value: it.min,
            oninput: e => { it.min = parseInt(e.target.value, 10) || 0; }
          });
          tag.appendChild(inp);
          tag.appendChild(U.el('span', { text: '分' }));
        }
        if (kind === 'leave') {
          tag.appendChild(U.el('select', {
            class: 'mini-sel',
            onchange: e => { it.type = e.target.value; }
          }, ['w', 'x', 'q'].map(v => U.el('option', { value: v, text: LEAVE_TEXT[v], selected: it.type === v ? 'selected' : null }))));
        }
        if (kind === 'early') {
          tag.appendChild(U.el('select', {
            class: 'mini-sel',
            onchange: e => { it.reason = e.target.value; }
          }, ['ok', 'bad'].map(v => U.el('option', { value: v, text: v === 'bad' ? '无故' : '有故', selected: it.reason === v ? 'selected' : null }))));
        }
        if (kind === 'viol' || kind === 'award') {
          // 每一项后面都跟着“− 次数 +”，同一项可以叠加
          const wctx = {
            kind: kind, refs: [],
            get: (type, text) => {
              const hit = (it.list || []).find(v => v.type === type && (type !== '其他' || v.text === text));
              return hit ? (parseInt(hit.n, 10) || 1) : 0;
            },
            change: (type, text, delta) => {
              A.views.changeCount(it.list, type, text, delta);
              const k = items.indexOf(it);
              if (!(it.list || []).length && k >= 0) {
                items.splice(k, 1);       // 全减没了就把这个人整条去掉，整块重建
                refresh();
              } else {
                wctx.refs.forEach(f => f());
              }
            }
          };
          const seg = U.el('span', { class: 'muted' });
          (it.list || []).forEach(v => {
            seg.appendChild(U.el('span', {
              text: (v.type === '其他' ? (v.text || '其他') : v.type),
              style: { marginLeft: '6px' }
            }));
            seg.appendChild(A.views.stepBox(wctx, v.type, v.text));
          });
          tag.appendChild(seg);
        }
        if (kind === 'hw') {
          const HW = A.homework && A.homework.STATUS ? A.homework.STATUS : null;
          // 请假跟着考勤走，不在这里手选；只有记录本身就是“请假”时才显示出来
          const keys = ((A.homework && A.homework.STATUS_ORDER)
            ? A.homework.STATUS_ORDER : ['missing', 'count', 'name', 'ok'])
            .filter(k => k !== 'leave' || it.status === 'leave');
          // 缺交标红、数量/命名错误标黄、正确标绿
          const colorOf = st => (st === 'missing' ? 'danger' : (st === 'ok' ? 'green' : (st === 'leave' ? 'blue' : 'warn')));
          // 手动改过的在前面标 *，和自动批改的结论区分
          const star = U.el('b', {
            class: 'star', text: '*',
            title: '手动改过；自动批改的结论：' + ((HW && HW[it.auto] ? HW[it.auto].text : '') || '—')
          });
          if (!it.manual) star.style.display = 'none';
          tag.appendChild(star);
          tag.className = 'name-tag ' + colorOf(it.status);
          tag.appendChild(U.el('select', {
            class: 'mini-sel',
            onchange: e => {
              it.manual = e.target.value;
              it.status = e.target.value;
              tag.className = 'name-tag ' + colorOf(it.status);
              star.style.display = '';
            }
          }, keys.map(v => U.el('option', {
            value: v, text: HW ? HW[v].text : v, selected: it.status === v ? 'selected' : null
          }))));
        }
        tag.appendChild(U.el('span', {
          class: 'x', text: '×', title: '删除',
          onclick: () => { items.splice(i, 1); refresh(); }
        }));
        tagBox.appendChild(tag);
      });
    }
    refresh();
    const isViol = kind === 'viol';
    const isAward = kind === 'award';
    const addBtn = U.el('button', {
      class: 'btn sm ghost', text: isViol ? '+ 添加违纪' : (isAward ? '+ 添加奖励' : '+ 添加'), style: { marginLeft: '8px' },
      onclick: () => {
        const used = items.map(it => (kind === 'plain' ? it : it.sid));
        pickStudent(cls, (isViol || isAward) ? [] : used, sid => {
          if (kind === 'plain') items.push(sid);
          else if (kind === 'late') items.push({ sid: sid, min: 0 });
          else if (kind === 'early') items.push({ sid: sid, reason: 'ok' });
          else if (kind === 'leave') items.push({ sid: sid, type: 'w' });
          else if (kind === 'hw') items.push({ sid: sid, status: 'missing' });
          else if (kind === 'award') pickAward(sid, items, refresh);   // 奖励：选完人再选项目
          else pickViolation(sid, items, refresh);                     // 违纪：选完人再选行为
          if (!isViol && !isAward) {
            items.sort((a, b) => (kind === 'plain' ? a : a.sid) - (kind === 'plain' ? b : b.sid));
          }
          refresh();
        });
      }
    });
    return U.el('div', { style: { marginBottom: '10px' } }, [
      U.el('div', { class: 'small muted', style: { marginBottom: '4px' }, text: title + '（' + items.length + ' 人）' }),
      U.el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '4px', flexWrap: 'wrap' } }, [tagBox, addBtn])
    ]);
  }

  /* 违纪：选完学生后选行为（“其他”直接在下面一行填写） */
  function pickViolation(sid, items, refresh) {
    const TYPES = ['讲话', '换位', '走动', '脱控', '无关', '值日'];
    let m = null;
    const push = item => {
      const cur = items.find(x => x.sid === sid);
      const list = cur ? cur.list : [];
      A.views.changeCount(list, item.type, item.text, 1);   // 同一项再点一次就 +1
      if (!cur) items.push({ sid: sid, list: list });
      refresh && refresh();
      if (m) m.close();
    };
    const otherInput = U.el('input', { class: 'input', placeholder: '其他：直接填写具体行为', style: { width: '200px' } });
    const body = U.el('div', {}, [
      U.el('div', { class: 'btn-row' }, TYPES.map(t => U.el('button', {
        class: 'btn sm', text: t, onclick: () => push({ type: t })
      }))),
      U.el('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
        otherInput,
        U.el('button', {
          class: 'btn sm primary', text: '记为“其他”',
          onclick: () => {
            const v = otherInput.value.trim();
            if (!v) { U.toast('请先填写具体行为', 'err'); return; }
            push({ type: '其他', text: v });
          }
        })
      ]),
      U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text: '一个人可以记多条；同一项点几次就是几次（在下面的清单里用 − / + 改）。' })
    ]);
    m = U.modal({
      title: '违纪行为（' + sid + '号 ' + (SE.name(clsOf(items), sid) || '') + '）',
      body: body,
      onOpen: root => { const i = root.querySelector('input'); i && i.focus(); },
      buttons: [{ label: '关闭' }]
    });
  }
  /* 奖励：选完学生后选项目（“其他”直接在下面一行填写） */
  function pickAward(sid, items, refresh) {
    const TYPES = ['回答', '助人', '纪律', '值日'];
    let m = null;
    const push = item => {
      const cur = items.find(x => x.sid === sid);
      const list = cur ? cur.list : [];
      A.views.changeCount(list, item.type, item.text, 1);   // 同一项再点一次就 +1
      if (!cur) items.push({ sid: sid, list: list });
      refresh && refresh();
      if (m) m.close();
    };
    const otherInput = U.el('input', { class: 'input', placeholder: '其他：直接填写奖励事由', style: { width: '200px' } });
    const body = U.el('div', {}, [
      U.el('div', { class: 'btn-row' }, TYPES.map(t => U.el('button', {
        class: 'btn sm green-btn', text: t, onclick: () => push({ type: t })
      }))),
      U.el('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
        otherInput,
        U.el('button', {
          class: 'btn sm primary', text: '记为“其他”',
          onclick: () => {
            const v = otherInput.value.trim();
            if (!v) { U.toast('请先填写奖励事由', 'err'); return; }
            push({ type: '其他', text: v });
          }
        })
      ]),
      U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text: '一个人可以记多条；同一项点几次就是几次，期末总评每项 +1 分。' })
    ]);
    m = U.modal({
      title: '奖励（' + sid + '号 ' + (SE.name(clsOf(items), sid) || '') + '）',
      body: body,
      onOpen: root => { const i = root.querySelector('input'); i && i.focus(); },
      buttons: [{ label: '关闭' }]
    });
  }
  function clsOf() { return S.current(); }

  function pickStudent(cls, exclude, cb) {
    const grid = U.el('div', { class: 'stu-pick' });
    exclude = exclude || [];
    const out = [];
    S.activeStudents(cls).forEach(n => {          // 学号与人数不相等时也按真实名单给
      if (exclude.indexOf(n) >= 0) return;
      out.push(n);
    });
    let m = null;
    out.forEach(n => {
      grid.appendChild(U.el('button', {
        text: n + ' ' + (SE.name(cls, n) || ''),
        onclick: () => { if (m) m.close(); cb(n); }
      }));
    });
    if (!grid.children.length) grid.appendChild(U.el('div', { class: 'muted small', text: '没有可选学生了' }));
    m = U.modal({
      title: '选择学生（点一下即可）',
      body: grid,
      buttons: [{ label: '关闭' }]
    });
  }

  /* ---------- 记录页 ---------- */
  function render() {
    const cls = S.current();
    const root = document.getElementById('view-records');
    root.innerHTML = '';

    const head = U.el('div', { class: 'card pad', style: { marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, [
      U.el('h4', { class: 'section-title', style: { margin: '0', flex: '1' }, text: '课堂记录 · ' + cls.name }),
      U.el('button', {
        class: 'btn sm ' + (state.scope === 'current' ? 'primary' : ''), text: '只看本班',
        onclick: () => { state.scope = 'current'; render(); }
      }),
      U.el('button', {
        class: 'btn sm ' + (state.scope === 'all' ? 'primary' : ''), text: '全部班级',
        onclick: () => { state.scope = 'all'; render(); }
      }),
      U.el('button', {
        class: 'btn sm', text: '手动添加记录',
        onclick: () => {
          const maxNo = cls.records.reduce((m, r) => Math.max(m, r.termNo || 0), cls.lessonCount || 0);
          const rec = {
            id: 'r_' + U.uid(), termNo: maxNo + 1, topic: S.topicOf(cls, maxNo + 1), date: U.today(), time: '',
            className: cls.name, absent: [], late: [], leave: [], early: [], violations: [], awards: [], missing: [],
            homework: null, moves: [], note: ''
          };
          recalc(rec, cls);
          openEditor(cls, rec, false, () => {
            cls.records.push(rec);
            syncLessonCount(cls);
            // 手动补的记录同样推进标签链（按记录里的违纪/值日内容判断）
            if (A.tagSys) A.tagSys.onNewRecord(cls, rec);
            state.open[rec.id] = true;
            S.save(); render();
            U.toast('已添加第 ' + rec.termNo + ' 次课记录', 'ok');
          });
        }
      }),
      U.el('button', { class: 'btn sm ghost', text: '导出本班汇总 CSV', onclick: () => exportAll(cls) })
    ]);
    root.appendChild(head);

    // 待保存的本节课
    if (state.scope === 'current' && cls.draft) {
      root.appendChild(pendingCard(cls));
    }

    const all = state.scope === 'all'
      ? S.load().classes.reduce((acc, c) => acc.concat(c.records.map(r => ({ r: r, c: c }))), [])
      : cls.records.map(r => ({ r: r, c: cls }));
    all.sort((a, b) => (b.r.termNo - a.r.termNo));

    if (!all.length && !cls.draft) {
      root.appendChild(U.el('div', { class: 'card pad muted', text: '还没有课堂记录。在考勤页“结束上课”后，到这里点“保存本节课数据”即可归档；也可以手动添加。' }));
      return;
    }
    all.forEach(({ r, c }) => root.appendChild(recordCard(c, r)));
  }
  V.records = { render, saveCurrentLesson };
  V.renderRecords = render;
  A.records = { render, saveCurrentLesson };

  function tag(text, cls) {
    return U.el('span', { class: 'pill ' + (cls || 'grey'), text: text });
  }

  function pendingCard(cls) {
    const d = cls.draft;
    const rec = recalc(draftToRecord(cls), cls);
    const card = U.el('div', { class: 'rec-card pending' });
    const head = U.el('div', { class: 'rec-head' }, [
      U.el('div', { class: 'rec-no', text: '本学期第 ' + d.termNo + ' 次课（未保存）' }),
      d.topic ? tag(d.topic, 'blue') : null,
      U.el('div', { class: 'rec-date', text: d.date + ' ' + d.time + (d.ended ? ' - ' + d.endTime : ' 进行中') + ' · ' + cls.name }),
      U.el('div', { class: 'rec-tags' }, [
        tag('缺勤 ' + rec.stats.absent, 'danger'),
        tag('迟到 ' + rec.stats.late, 'warn'),
        tag('早退 ' + (rec.stats.earlyOk + rec.stats.earlyBad), 'grey'),
        tag('请假 ' + rec.stats.leave, 'blue'),
        rec.stats.viol ? tag('违纪 ' + rec.stats.viol, 'warn') : null,
        rec.stats.award ? tag('奖励 ' + rec.stats.award, 'ok') : null,
        tag('缺交 ' + rec.stats.missing, rec.stats.missing ? 'danger' : 'ok')
      ].filter(Boolean))
    ]);
    card.appendChild(head);
    const btns = U.el('div', { class: 'btn-row', style: { padding: '0 16px 14px' } }, [
      d.ended
        ? U.el('button', { class: 'btn primary sm', text: '保存本节课数据', onclick: () => saveCurrentLesson(cls) })
        : U.el('button', { class: 'btn sm', text: '去结束上课', onclick: () => A.app.show('attendance') }),
      U.el('button', {
        class: 'btn sm', text: d.note ? '查看/修改名单/备注' : '查看/修改名单', onclick: () => {
          const r = recalc(draftToRecord(cls), cls);
        openEditor(cls, r, false, () => {
          // 把修改写回本节课草稿
          const dd = cls.draft;
          dd.termNo = r.termNo; dd.date = r.date; dd.time = r.time; dd.note = r.note; dd.topic = r.topic;
          dd.att = {};
          if (cls.longLeave) cls.longLeave.forEach(sid => { dd.att[sid] = { status: 'leave', leave: 'w' }; });
          r.absent.forEach(sid => { dd.att[sid] = { status: 'absent' }; });
          r.late.forEach(l => { dd.att[l.sid] = { status: 'late', lateMin: l.min || 0, timing: false }; });
          r.early.forEach(e => { dd.att[e.sid] = { status: 'early', early: e.reason === 'bad' ? 'bad' : 'ok' }; });
          r.leave.forEach(l => { dd.att[l.sid] = { status: 'leave', leave: l.type }; });
          r.violations.forEach(v => { dd.att[v.sid] = Object.assign(dd.att[v.sid] || { status: 'present' }, { viol: v.list }); });
          r.awards.forEach(v => { dd.att[v.sid] = Object.assign(dd.att[v.sid] || { status: 'present' }, { award: v.list }); });
          if (dd.homework) dd.homework.missing = r.missing.map(sid => ({ sid: sid, seat: SE.seatOfStudent(cls, sid) }));
          S.save(); render(); U.toast('已写回本节课', 'ok');
        });
      } }),
      U.el('button', { class: 'btn sm', text: d.note ? '修改备注' : '写备注', onclick: () => editNote(cls.draft, '本节课备注', render) }),
      U.el('span', { class: 'small muted', text: d.ended ? '保存后本节课结束，可开始下一节' : '本节课还在进行中，结束后才能保存' })
    ]);
    card.appendChild(btns);
    if (d.note) {
      card.appendChild(U.el('div', { style: { padding: '0 16px 14px' } }, [
        U.el('div', { class: 'small muted', text: '备注' }),
        U.el('div', { class: 'small', text: d.note })
      ]));
    }
    return card;
  }

  function recordCard(cls, r) {
    const st = r.stats || recalc(r, cls).stats;
    if (st.earlyOk === undefined) {   // 兼容旧记录
      st.earlyOk = (r.early || []).filter(x => x.reason !== 'bad').length;
      st.earlyBad = (r.early || []).filter(x => x.reason === 'bad').length;
      st.viol = (r.violations || []).length;
    }
    if (st.award === undefined) {
      st.award = (r.awards || []).length;
      st.awardItem = (r.awards || []).reduce((n, a) => n + A.views.countOf(a.list), 0);
    }
    if (st.violItem === undefined) {
      st.violItem = (r.violations || []).reduce((n, a) => n + A.views.countOf(a.list), 0);
    }
    const card = U.el('div', { class: 'rec-card' });
    const open = !!state.open[r.id];
    const head = U.el('div', { class: 'rec-head' }, [
      U.el('div', { class: 'rec-no', text: '第 ' + r.termNo + ' 次课' }),
      U.el('div', { class: 'rec-date', text: (r.date || '') + ' ' + (r.time || '') + ' · ' + (r.className || cls.name) }),
      r.topic ? tag(r.topic, 'blue') : null,
      r.note ? tag('备注', 'blue') : null,
      U.el('div', { class: 'rec-tags' }, [
        tag('应到 ' + st.total),
        tag('实到 ' + st.present, 'ok'),
        st.absent ? tag('缺勤 ' + st.absent, 'danger') : null,
        st.late ? tag('迟到 ' + st.late, 'warn') : null,
        (st.earlyOk + st.earlyBad) ? tag('早退 ' + (st.earlyOk + st.earlyBad) + '（无故' + st.earlyBad + '）', 'grey') : null,
        st.leave ? tag('请假 ' + st.leave, 'blue') : null,
        st.award ? tag('奖励 ' + st.award, 'ok') : null,
        st.viol ? tag('违纪 ' + st.viol, 'warn') : null,
        st.missing ? tag('缺交 ' + st.missing, 'danger') : tag('缺交 0', 'ok'),
        r.moves && r.moves.length ? tag('换座 ' + r.moves.length) : null
      ].filter(Boolean))
    ]);
    head.onclick = () => { state.open[r.id] = !open; render(); };
    card.appendChild(head);
    if (open) card.appendChild(recordBody(cls, r));
    return card;
  }

  /** 一条记录的详情区 —— 记录页与“归档学期查看”共用；readonly 时不给操作按钮 */
  function recordBody(cls, r, opts) {
    opts = opts || {};
    {
      const body = U.el('div', { class: 'rec-body' });

      /* 整节课的汇总只占一个区域：一行一类，作业/奖励/违纪/换座收起来 */
      const none = () => U.el('span', { class: 'muted small', text: '无' });
      const stu = (sid, extra, suffixCls) => U.el('span', { class: 'rec-stu' }, [
        U.el('b', { text: String(sid) }),
        U.el('span', { text: SE.name(cls, sid) ? ' ' + SE.name(cls, sid) : '' }),
        extra ? U.el('span', { class: 'rec-suffix' + (suffixCls ? ' ' + suffixCls : ''), text: extra }) : null
      ]);
      const line = (label, labelCls, kids) => body.appendChild(U.el('div', { class: 'rec-line' }, [
        U.el('span', { class: 'rec-label ' + labelCls, text: label }),
        U.el('div', { class: 'rec-val' }, kids)
      ]));

      line('缺勤 ' + r.absent.length, r.absent.length ? 'danger' : 'grey',
        r.absent.length ? r.absent.map(sid => stu(sid)) : [none()]);

      line('迟到 ' + r.late.length, r.late.length ? 'warn' : 'grey',
        r.late.length ? r.late.map(l => stu(l.sid, (l.min || 0) + ' 分', 'warn')) : [none()]);

      /* 早退：一栏里，名字后面直接标有故 / 无故 */
      const early = r.early || [];
      line('早退 ' + early.length, early.length ? 'warn' : 'grey',
        early.length
          ? early.map(e => stu(e.sid, e.reason === 'bad' ? '（无故）' : '（有故）', e.reason === 'bad' ? 'bad' : 'good'))
          : [none()]);

      line('请假 ' + r.leave.length, r.leave.length ? 'blue' : 'grey',
        r.leave.length ? r.leave.map(l => stu(l.sid, '（' + (LEAVE_TEXT[l.type] || '其他') + '）', 'blue')) : [none()]);

      /* 作业：只给汇总，点“查看详情”开小窗口看名单和饼图 */
      const hwList = r.hwStatus || [];
      if (hwList.length || r.homework) {
        const c = hwCounts(hwList);
        const badN = c.missing + c.count + c.name;      // 请假不算异常
        body.appendChild(U.el('div', { class: 'rec-line' }, [
          U.el('span', { class: 'rec-label ' + (badN ? 'warn' : 'ok'), text: '作业' }),
          U.el('div', { class: 'rec-val hw-sum' }, [
            hwChip('缺交', c.missing, 'missing'),
            hwChip('数量错误', c.count, 'count'),
            hwChip('命名错误', c.name, 'name'),
            hwChip('正确', c.ok, 'ok'),
            c.leave ? hwChip('请假', c.leave, 'leave') : null,
            U.el('button', {
              class: 'btn sm ghost', text: '查看详情 ›',
              onclick: e => { e.stopPropagation(); openHomeworkDetail(cls, r); }
            })
          ])
        ]));
      }

      /* 奖励：收起（违纪左边那一栏的正面记录） */
      const awards = r.awards || [];
      const aBox = U.el('div', { class: 'rec-fold hidden' }, awards.map(v => U.el('div', { class: 'rec-fold-item' }, [
        U.el('b', { text: String(v.sid) + (SE.name(cls, v.sid) ? ' ' + SE.name(cls, v.sid) : '') }),
        U.el('span', { class: 'muted', text: '（' + V.awardText(v.list) + '）' })
      ])));
      line('奖励 ' + awards.length, awards.length ? 'ok' : 'grey', [foldBtn(awards.length, aBox)]);
      if (awards.length) body.appendChild(aBox);

      /* 违纪：收起，点开看名单（不要饼图） */
      const viols = r.violations || [];
      const vBox = U.el('div', { class: 'rec-fold hidden' }, viols.map(v => U.el('div', { class: 'rec-fold-item' }, [
        U.el('b', { text: String(v.sid) + (SE.name(cls, v.sid) ? ' ' + SE.name(cls, v.sid) : '') }),
        U.el('span', { class: 'muted', text: '（' + A.views.violText(v.list) + '）' })
      ])));
      line('违纪 ' + viols.length, viols.length ? 'warn' : 'grey', [foldBtn(viols.length, vBox)]);
      if (viols.length) body.appendChild(vBox);

      /* 换座：收起 */
      const moves = r.moves || [];
      const mBox = U.el('div', { class: 'rec-fold hidden' }, moves.map(m => U.el('div', { class: 'rec-fold-item' }, [
        U.el('b', { text: String(m.sid) + (SE.name(cls, m.sid) ? ' ' + SE.name(cls, m.sid) : '') }),
        U.el('span', { class: 'muted', text: ' ' + m.from + ' → ' + m.to + (m.at ? ' · ' + m.at : '') })
      ])));
      line('换座 ' + moves.length, 'grey', [foldBtn(moves.length, mBox)]);
      if (moves.length) body.appendChild(mBox);

      /* 备注 */
      body.appendChild(U.el('div', { class: 'rec-line' }, [
        U.el('span', { class: 'rec-label blue', text: '备注' }),
        U.el('div', { class: 'rec-val' }, [
          r.note ? U.el('span', { class: 'small rec-note', text: r.note }) : none(),
          U.el('button', {
            class: 'btn sm ghost', text: r.note ? '修改备注' : '写备注', style: { marginLeft: '8px' },
            onclick: e => { e.stopPropagation(); editNote(r, '第 ' + r.termNo + ' 次课 · 备注', render); }
          })
        ])
      ]));

      if (!opts.readonly) {
        body.appendChild(U.el('div', { class: 'btn-row rec-actions' }, [
          U.el('button', {
            class: 'btn sm', text: '编辑', onclick: e => {
              e.stopPropagation();
              openEditor(cls, r, false, () => { syncLessonCount(cls); if (A.tagSys) A.tagSys.rebuild(cls); S.save(); render(); U.toast('已更新第 ' + r.termNo + ' 次课记录', 'ok'); });
            }
          }),
          U.el('button', { class: 'btn sm ghost', text: '导出本节 CSV', onclick: e => { e.stopPropagation(); exportOne(cls, r); } }),
          U.el('button', {
            class: 'btn sm danger', text: '删除', onclick: e => {
              e.stopPropagation();
              U.confirm('删除第 ' + r.termNo + ' 次课的记录？', () => {
                const i = cls.records.indexOf(r);
                if (i >= 0) cls.records.splice(i, 1);
                // 按被删记录的内容合理回退行为标签（值日 d-1、违纪达标/当场标红 r-1）
                if (A.tagSys) A.tagSys.onDeleteRecord(cls, r);
                // 删完要同步“已上 N 节”：班级管理首页、期末总评都读这个数
                syncLessonCount(cls);
                S.save(); render();
                U.toast('已删除第 ' + r.termNo + ' 次课记录，相关学生的行为标签已回退', 'ok');
              });
            }
          })
        ]));
      }
      return body;
    }
  }

  /** 归档学期里某个班的全部记录：只读，每次课点一下折叠查看 */
  V.viewArchived = function (cls, tagText) {
    const recs = (cls.records || []).slice().sort((a, b) => (a.termNo || 0) - (b.termNo || 0));
    const wrap = U.el('div', {});
    if (!recs.length) {
      wrap.appendChild(U.el('div', { class: 'muted small', text: '这个班在这个学期没有留下课堂记录。' }));
    }
    recs.forEach(r => {
      recalc(r, cls);
      const st = r.stats;
      const card = U.el('div', { class: 'rec-card' });
      let body = null;
      const head = U.el('div', { class: 'rec-head' }, [
        U.el('div', { class: 'rec-no', text: '第 ' + r.termNo + ' 次课' }),
        U.el('div', { class: 'rec-date', text: (r.date || '') + ' ' + (r.time || '') + (r.topic ? ' · ' + r.topic : '') }),
        U.el('div', { class: 'rec-tags' }, [
          tag('应到 ' + st.total),
          tag('实到 ' + st.present, 'ok'),
          st.absent ? tag('缺勤 ' + st.absent, 'danger') : null,
          st.late ? tag('迟到 ' + st.late, 'warn') : null,
          (st.earlyOk + st.earlyBad) ? tag('早退 ' + (st.earlyOk + st.earlyBad), 'grey') : null,
          st.leave ? tag('请假 ' + st.leave, 'blue') : null,
          st.viol ? tag('违纪 ' + st.viol, 'warn') : null,
          st.award ? tag('奖励 ' + st.award, 'ok') : null,
          st.missing ? tag('缺交 ' + st.missing, 'danger') : tag('缺交 0', 'ok')
        ].filter(Boolean))
      ]);
      head.onclick = () => {
        if (body) { body.remove(); body = null; }
        else { body = recordBody(cls, r, { readonly: true }); card.appendChild(body); }
      };
      card.appendChild(head);
      wrap.appendChild(card);
    });
    U.modal({
      title: cls.name + (tagText ? ' · ' + tagText : '') + '（' + recs.length + ' 次课 · 点击展开每次课）',
      body: wrap,
      wide: true,
      buttons: [{ label: '关闭', cls: 'primary' }]
    });
  };

  /* 作业状态统计 / 小色块 / 折叠按钮 */
  const HW_COLOR = { missing: '#dc2626', count: '#ea8c0b', name: '#a855f7', ok: '#16a34a', leave: '#2563eb' };
  function hwCounts(list) {
    const c = { missing: 0, count: 0, name: 0, ok: 0, leave: 0 };
    list.forEach(x => { c[x.status] = (c[x.status] || 0) + 1; });
    return c;
  }
  function hwChip(label, n, key) {
    return U.el('span', { class: 'chip hw-chip', style: { color: HW_COLOR[key] || '#334155' }, text: label + ' ' + n });
  }
  function foldBtn(n, box) {
    if (!n) return U.el('span', { class: 'muted small', text: '无' });
    const btn = U.el('button', { class: 'btn sm ghost rec-fold-btn', text: '展开 ' + n + ' 条 ▾' });
    btn.onclick = e => {
      e.stopPropagation();
      const hidden = box.classList.contains('hidden');
      box.classList.toggle('hidden', !hidden);
      btn.textContent = hidden ? '收起 ▴' : '展开 ' + n + ' 条 ▾';
    };
    return btn;
  }

  /* 作业详情小窗口：名单 + 饼图 */
  function openHomeworkDetail(cls, r) {
    const ST = A.homework && A.homework.STATUS ? A.homework.STATUS : null;
    const order = (A.homework && A.homework.STATUS_ORDER)
      ? A.homework.STATUS_ORDER : ['missing', 'count', 'name', 'ok'];
    const list = (r.hwStatus || []).slice().sort((a, b) => a.sid - b.sid);
    const c = hwCounts(list);
    const total = order.reduce((n, k) => n + (c[k] || 0), 0);
    let acc = 0;
    const stops = order.filter(k => c[k]).map(k => {
      const from = acc / (total || 1) * 100;
      acc += c[k];
      const to = acc / (total || 1) * 100;
      return (HW_COLOR[k] || '#94a3b8') + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
    }).join(', ');
    const pie = U.el('div', { class: 'pie', style: { background: 'conic-gradient(' + (stops || '#e2e8f0 0 100%') + ')' } });
    const legend = U.el('div', { class: 'pie-legend' }, order.map(k => U.el('div', { class: 'pie-leg' }, [
      U.el('span', { class: 'dot', style: { background: HW_COLOR[k] } }),
      U.el('span', { text: ST ? ST[k].text : k }),
      U.el('b', { text: (c[k] || 0) + ' 人' }),
      U.el('span', { class: 'muted', text: total ? Math.round((c[k] || 0) / total * 100) + '%' : '0%' })
    ])));

    // “已提交内容”点一下就能补填（系统没认出他交了什么时，老师可以直接写）
    const submittedCell = x => {
      const td = U.el('td', { class: 'small submitted', title: '点一下可以补填他交了什么' });
      let editing = false;
      const show = () => {
        td.innerHTML = '';
        td.classList.toggle('muted', !x.submitted);
        td.appendChild(U.el('span', { text: x.submitted || '—' }));
      };
      show();
      td.onclick = () => {
        if (editing) return;
        editing = true;
        const inp = U.el('input', { class: 'input mini', value: x.submitted || '', placeholder: '他交了什么' });
        td.innerHTML = '';
        td.appendChild(inp);
        inp.focus();
        inp.onblur = () => {
          if (!editing) return;
          editing = false;
          x.submitted = inp.value.trim();
          S.save();
          show();
        };
        inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
      };
      return td;
    };
    // 只对出了问题的同学列出：先看他到底交了什么，再看判成哪种错（请假不算问题）
    const bad = list.filter(x => x.status !== 'ok' && x.status !== 'leave');
    const rows = bad.map(x => {
      const m = (ST && ST[x.status]) || { cls: 'grey', text: x.status };
      return U.el('tr', {}, [
        U.el('td', { text: String(x.sid) }),
        U.el('td', { text: SE.name(cls, x.sid) || '—' }),
        submittedCell(x),
        U.el('td', {}, [U.el('span', {
          class: 'pill ' + m.cls,
          html: (x.manual ? '<b class="star">*</b>' : '') + U.esc(m.text)
        })]),
        U.el('td', { class: 'small', text: x.detail || '—' })
      ]);
    });

    U.modal({
      title: '第 ' + r.termNo + ' 次课 · 作业情况（' + list.length + ' 人）',
      body: U.el('div', {}, [
        U.el('div', { class: 'pie-wrap' }, [pie, legend]),
        U.el('div', { class: 'sub-title', text: '有问题的学生（' + bad.length + ' 人）' }),
        U.el('div', { class: 'table-wrap' }, [
          U.el('table', { class: 'grid' }, [
            U.el('thead', {}, [U.el('tr', {}, ['学号', '姓名', '已提交内容（可点开补填）', '状态', '说明'].map(t => U.el('th', { text: t })))]),
            U.el('tbody', {}, rows.length ? rows : [U.el('tr', {}, [U.el('td', { class: 'muted', colSpan: '5', text: '全部正确' })])])
          ])
        ])
      ]),
      buttons: [{ label: '关闭' }]
    });
  }

  /* ---------- 导出 ---------- */
  const q = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';

  function exportOne(cls, r) {
    const lines = ['第' + r.termNo + '次课,' + q(r.date) + ',' + q(r.time) + ',' + q(r.className || cls.name) + (r.topic ? ',' + q('课题：' + r.topic) : '')];
    if (r.topic) lines.push('课题,' + q(r.topic));
    if (r.note) lines.push('备注,' + q(r.note));
    lines.push('学号,姓名,状态,说明');
    const push = (sid, status, note) => lines.push([
      q(sid), q(SE.name(cls, sid) || ''), q(status), q(note || '')
    ].join(','));
    r.absent.forEach(sid => push(sid, '缺勤', ''));
    r.late.forEach(l => push(l.sid, '迟到', (l.min || 0) + '分钟'));
    (r.early || []).forEach(e => push(e.sid, '早退', e.reason === 'bad' ? '无故' : '有故'));
    r.leave.forEach(l => push(l.sid, '请假', LEAVE_TEXT[l.type] || '其他'));
    r.missing.forEach(sid => push(sid, '缺交作业', ''));
    (r.violations || []).forEach(v => push(v.sid, '违纪', V.violText(v.list)));
    (r.awards || []).forEach(v => push(v.sid, '奖励', V.awardText(v.list)));
    (r.homework ? r.homework.bad : []).forEach(b => push(b.sid, '作业缺件', b.missing.join('/')));
    U.download('第' + r.termNo + '次课-' + cls.name + '-' + (r.date || '') + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv');
  }

  function exportAll(cls, tag) {
    if (!cls.records.length) { U.toast('本班还没有记录', 'err'); return; }
    const lines = ['第几次课,日期,上课时间,课题,班级,应到,实到,缺勤,迟到,早退有故,早退无故,请假,违纪,奖励,缺交,换座,备注'];
    cls.records.slice().sort((a, b) => a.termNo - b.termNo).forEach(r => {
      const st = r.stats || { total: '', present: '', absent: 0, late: 0, leave: 0, missing: 0 };
      const eo = (r.early || []).filter(x => x.reason !== 'bad').length;
      const eb = (r.early || []).filter(x => x.reason === 'bad').length;
      lines.push([
        r.termNo, q(r.date), q(r.time), q(r.topic || ''), q(r.className), st.total, st.present,
        st.absent, st.late, eo, eb, st.leave, (r.violations || []).length, (r.awards || []).length,
        st.missing, (r.moves || []).length, q(r.note || '')
      ].join(','));
    });
    U.download('课堂记录汇总-' + cls.name + (tag ? '-' + tag : '') + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv');
  }

  A.records = { render, saveCurrentLesson, exportAll, collapseAll: () => { state.open = {}; } };

})(window.App);
