/* 期末总评：课堂表现 100 + 作业 100 + 考试 100，按占比合成总评并按等级占比划分等级 */
(function (A) {
  'use strict';
  const U = A.util, SE = A.seats, S = A.store;
  const V = A.views = A.views || {};

  /* 作业扣分：缺交 -3 / 数量错误 -2 / 命名错误 -1（没有“类型错误”）；请假不扣分 */
  const HW_DEDUCT = { missing: 3, count: 2, name: 1, leave: 0 };
  /** 长期请假：请假次数 > 本学期课次的 70% */
  const LONG_LEAVE_PCT = 70;

  function cfg() {
    const db = S.load();
    return db.finalCfg;
  }

  /** 计算全班三项得分 */
  function compute(cls) {
    const recs = cls.records || [];
    // 本学期课次：按已有记录里最大的“第几次课”算（删掉记录会自动退回）
    let lessonTotal = cls.lessonCount || 0;
    recs.forEach(r => { if ((r.termNo || 0) > lessonTotal) lessonTotal = r.termNo; });

    const rows = [];
    S.activeStudents(cls).forEach(sid => {
      let perf = 100, hw = 100;
      const pLog = [], hLog = [];
      let leaveN = 0;
      recs.forEach(r => {
        const no = r.termNo;
        if ((r.absent || []).indexOf(sid) >= 0) { perf -= 5; pLog.push('第' + no + '次缺勤 -5'); }
        // 请假不扣课堂表现分，只记次数（用来判断长期请假）
        if ((r.leave || []).some(l => (typeof l === 'object' ? l.sid : l) === sid)) leaveN++;
        (r.late || []).forEach(l => {
          if (l.sid !== sid) return;
          const m = Math.min(l.min || 0, 5);
          perf -= m; pLog.push('第' + no + '次迟到' + (l.min || 0) + '分 -' + m);
        });
        (r.early || []).forEach(e => {
          if (e.sid !== sid || e.reason !== 'bad') return;
          perf -= 5; pLog.push('第' + no + '次无故早退 -5');
        });
        (r.violations || []).forEach(v => {
          if (v.sid !== sid) return;
          const n = A.views.countOf(v.list);      // 同一项记了几次就算几项
          if (!n) return;
          perf -= n; pLog.push('第' + no + '次违纪' + n + '项 -' + n);
        });
        (r.awards || []).forEach(a => {
          if (a.sid !== sid) return;
          const n = A.views.countOf(a.list);      // 同一项记了几次就加几分
          if (!n) return;
          perf += n; pLog.push('第' + no + '次奖励' + n + '项 +' + n);
        });
        const st = r.hwStatus || [];
        if (st.length) {
          const mine = st.filter(x => x.sid === sid);
          mine.forEach(x => {
            const d = HW_DEDUCT[x.status] || 0;
            if (d) { hw -= d; hLog.push('第' + no + '次' + (A.homework.STATUS[x.status] || {}).text + ' -' + d); }
          });
        } else if ((r.missing || []).indexOf(sid) >= 0) {
          hw -= HW_DEDUCT.missing; hLog.push('第' + no + '次缺交 -' + HW_DEDUCT.missing);
        }
      });
      // 长期请假：请假次数超过本学期课次的 70%
      const longLeave = lessonTotal > 0 && (leaveN * 100 > lessonTotal * LONG_LEAVE_PCT);
      if (longLeave) {
        pLog.unshift('长期请假（本学期 ' + lessonTotal + ' 次课，请假 ' + leaveN + ' 次）');
      }
      const examRaw = cls.exam ? cls.exam[String(sid)] : undefined;
      const exam = (examRaw === undefined || examRaw === null || examRaw === '') ? null : Number(examRaw);
      rows.push({
        sid: sid,
        perf: Math.min(100, Math.max(0, r1(perf))),   // 奖励可以加回来，但不超过 100
        hw: Math.max(0, r1(hw)),
        exam: exam === null ? null : Math.max(0, Math.min(100, r1(exam))),
        pLog: pLog, hLog: hLog,
        leaveN: leaveN, lessonTotal: lessonTotal, longLeave: longLeave
      });
    });
    // 持续红标（r===3）：课堂表现按回退进度覆盖 —— 每回退一档 +20，封顶 60，没回退过就是 0
    rows.forEach(x => {
      const st = (cls.tags || {})[String(x.sid)];
      if (st && st.r === 3) {
        x.perf = Math.min(60, st.rb * 20);
        x.pLog.unshift('持续红标：平时分 = 回退 ' + st.rb + ' 次 × 20（封顶 60）');
      }
    });
    const w = cfg().weights;
    const sum = (num(w.perf) + num(w.hw) + num(w.exam)) || 1;
    rows.forEach(x => {
      const e = x.exam === null ? 0 : x.exam;
      x.total = r1((x.perf * num(w.perf) + x.hw * num(w.hw) + e * num(w.exam)) / sum);
    });
    grade(rows);
    // 老师手动改过的等级优先，前面标 *
    const fix = cls.gradeFix = cls.gradeFix || {};
    rows.forEach(x => {
      const v = fix[String(x.sid)];
      if (v) { x.grade = v; x.gradeManual = true; }
      if (x.longLeave) x.gradeTitle = '长期请假：直接给第 3 级（' + (x.grade || '') + '）';
    });
    rows.sort((a, b) => a.sid - b.sid);
    return rows;
  }
  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function r1(v) { return Math.round(v * 10) / 10; }

  /** 按等级占比切分（总分从高到低） */
  function grade(rows) {
    const gs = (cfg().grades || []).slice();
    // 长期请假的同学不占前几级的名额，直接给第 3 级
    const third = gs.length >= 3 ? gs[2].name : (gs.length ? gs[gs.length - 1].name : '');
    const pool = rows.filter(x => !x.longLeave);
    const sorted = pool.slice().sort((a, b) => b.total - a.total);
    let idx = 0;
    gs.forEach(g => {
      const n = Math.round(pool.length * num(g.pct) / 100);
      for (let k = 0; k < n && idx < sorted.length; k++, idx++) sorted[idx].autoGrade = g.name;
    });
    while (idx < sorted.length) {
      sorted[idx].autoGrade = gs.length ? gs[gs.length - 1].name : '';
      idx++;
    }
    rows.filter(x => x.longLeave).forEach(x => { x.autoGrade = third; });
    rows.forEach(x => { x.grade = x.autoGrade || ''; });
  }

  function render() {
    const cls = S.current();
    const root = document.getElementById('view-summary');
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(setCard(cls));

    const rows = compute(cls);
    root.appendChild(tableCard(cls, rows));
  }
  V.summary = { render };
  V.renderSummary = render;

  function setCard(cls) {
    const c = cfg();
    const card = U.el('div', { class: 'card pad', style: { marginBottom: '12px' } });
    card.appendChild(U.el('h4', { class: 'section-title', style: { margin: '0 0 8px' }, text: '期末总评设置 · ' + cls.name + '（' + A.term.title() + '）' }));

    /* 三项占比 */
    const wRow = U.el('div', { class: 'weight-row' });
    const win = {};
    ['perf', 'hw', 'exam'].forEach(k => {
      const label = { perf: '课堂表现', hw: '作业', exam: '考试' }[k];
      win[k] = U.el('input', {
        class: 'input', type: 'number', min: '0', max: '100', style: { width: '72px' }, value: c.weights[k],
        oninput: e => { c.weights[k] = num(e.target.value); S.save(); }
      });
      wRow.appendChild(U.el('span', { class: 'w-item' }, [
        U.el('span', { text: label }), win[k], U.el('span', { class: 'muted', text: '%' })
      ]));
    });
    const wSum = U.el('span', { class: 'small' });
    const refreshSum = () => {
      const s = num(c.weights.perf) + num(c.weights.hw) + num(c.weights.exam);
      wSum.textContent = s === 100 ? '合计 100%（正常）' : '合计 ' + s + '%（不等于 100% 时按比例折算）';
      wSum.className = 'small ' + (s === 100 ? 'muted' : 'warn-text');
    };
    refreshSum();
    card.appendChild(U.el('div', { class: 'field' }, [
      U.el('label', { text: '各项占比（满分都是 100 分）' }),
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [wRow, wSum])
    ]));

    /* 等级占比 */
    const gBox = U.el('div', { class: 'grade-box' });
    function refreshGrades() {
      gBox.innerHTML = '';
      c.grades.forEach((g, i) => {
        gBox.appendChild(U.el('div', { class: 'w-item' }, [
          U.el('input', {
            class: 'input', style: { width: '90px' }, value: g.name,
            oninput: e => { g.name = e.target.value; S.save(); }
          }),
          U.el('input', {
            class: 'input', type: 'number', min: '0', max: '100', style: { width: '64px' }, value: g.pct,
            oninput: e => { g.pct = num(e.target.value); S.save(); }
          }),
          U.el('span', { class: 'muted', text: '%' }),
          U.el('button', {
            class: 'btn sm danger', text: '×',
            onclick: () => { c.grades.splice(i, 1); S.save(); refreshGrades(); }
          })
        ]));
      });
      const s = c.grades.reduce((n, g) => n + num(g.pct), 0);
      gBox.appendChild(U.el('div', { class: 'small ' + (s === 100 ? 'muted' : 'warn-text'), style: { marginTop: '4px' }, text: '等级占比合计 ' + s + '%（按总分从高到低切分）' }));
    }
    refreshGrades();
    const gradeField = U.el('div', { class: 'field', style: { marginTop: '10px' } }, [
      U.el('label', { text: '等级与占比' }), gBox,
      U.el('button', {
        class: 'btn sm ghost', text: '+ 增加等级', style: { marginTop: '6px' },
        onclick: () => { c.grades.push({ name: '等级' + (c.grades.length + 1), pct: 0 }); S.save(); refreshGrades(); }
      })
    ]);
    card.appendChild(gradeField);

    /* 考试 */
    const examCount = Object.keys(cls.exam || {}).length;
    card.appendChild(U.el('div', { class: 'field', style: { marginTop: '10px' } }, [
      U.el('label', { text: '考试成绩（下载模板按它填：学号 / 姓名 / 成绩；学号和成绩列已设好格式，第一行“张三”是示例，删掉换成自己的名单）' }),
      U.el('div', { class: 'btn-row' }, [
        U.el('button', { class: 'btn sm', text: '下载成绩模板', onclick: () => A.tpl.examTemplate(cls) }),
        U.el('button', { class: 'btn sm', text: '上传成绩表', onclick: importExam }),
        examCount ? U.el('span', { class: 'small muted', text: '已录入 ' + examCount + ' 人' }) : U.el('span', { class: 'small warn-text', text: '还没有成绩（未录入按 0 分计）' }),
        examCount ? U.el('button', {
          class: 'btn sm danger', text: '清空成绩',
          onclick: () => U.confirm('清空本班考试成绩？', () => { cls.exam = {}; S.save(); render(); })
        }) : null
      ])
    ]));

    card.appendChild(U.el('div', { class: 'small muted', style: { marginTop: '10px', lineHeight: '1.8' }, html:
      '扣分规则：课堂表现——每次缺勤 -5，迟到 n 分钟 -n（每节课最多 -5），每次无故早退 -5，每项违纪 -1，' +
      '<b style="color:#16a34a">每项奖励 +1（回答 / 助人 / 纪律 / 值日 / 其他），加到 100 分为止</b>；' +
      '作业——每次缺交 -3，数量错误 -2，命名错误 -1（数量对了才看命名）。各项扣到 0 分为止。<br>' +
      '<b style="color:#2563eb">请假</b>：不扣课堂表现分；当次作业按<b>请假</b>计，不算缺交、不算作业异常，也不扣分。<br>' +
      '<b style="color:#2563eb">长期请假</b>（本学期请假次数超过课次的 <b>' + LONG_LEAVE_PCT + '%</b>）：等级<b>直接给第 3 级</b>（不管上面设了几级），' +
      '扣分明细里写“长期请假”；但他回校期间的每一项加分、扣分仍像其他同学一样逐条列出。' }));
    return card;
  }

  function tableCard(cls, rows) {
    const card = U.el('div', { class: 'card pad' });
    const w = cfg().weights;
    const head = U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' } }, [
      U.el('h4', { class: 'section-title', style: { margin: '0', flex: '1' }, text: '总评结果（按学号）' }),
      U.el('span', { class: 'chip', html: '课堂表现 <b>' + w.perf + '%</b>' }),
      U.el('span', { class: 'chip', html: '作业 <b>' + w.hw + '%</b>' }),
      U.el('span', { class: 'chip', html: '考试 <b>' + w.exam + '%</b>' }),
      U.el('button', { class: 'btn sm primary', text: '导出 Excel', onclick: () => exportXlsx(cls, rows) }),
      U.el('button', { class: 'btn sm ghost', text: '导出 CSV', onclick: () => exportCsv(cls, rows) })
    ]);
    card.appendChild(head);

    const tb = U.el('tbody', {}, rows.map(x => U.el('tr', {}, [
      U.el('td', { text: String(x.sid) }),
      U.el('td', { text: SE.name(cls, x.sid) || '—' }),
      U.el('td', { text: fmt(x.perf), title: x.pLog.join('；') }),
      U.el('td', { text: fmt(x.hw), title: x.hLog.join('；') }),
      U.el('td', { text: x.exam === null ? '未录入' : fmt(x.exam) }),
      U.el('td', {}, [U.el('b', { text: fmt(x.total) })]),
      U.el('td', {}, [gradeCell(cls, x)]),
      U.el('td', { class: 'small muted', text: (x.pLog.concat(x.hLog).join('；') || '—') })
    ])));
    const ll = rows.filter(x => x.longLeave);
    if (ll.length) {
      card.appendChild(U.el('div', { class: 'small', style: { marginBottom: '8px', color: '#2563eb' }, text:
        '长期请假（请假次数超过本学期课次的 ' + LONG_LEAVE_PCT + '%）：' +
        ll.map(x => x.sid + ' ' + (SE.name(cls, x.sid) || '')).join('、') +
        ' —— 等级直接给第 3 级；回校期间的加扣分仍照常列出。' }));
    }
    card.appendChild(U.el('div', { class: 'small muted', style: { marginBottom: '6px' }, html:
      '“等级”一格可以直接点开改 —— 手动改过的会在前面标 <b class="star">*</b>。' }));
    card.appendChild(U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'grid' }, [
        U.el('thead', {}, [U.el('tr', {}, ['学号', '姓名', '课堂表现', '作业', '考试', '总评', '等级', '扣分明细'].map(t => U.el('th', { text: t })))]),
        tb
      ])
    ]));
    return card;
  }
  /** 等级那一格：点下拉可手改；手改过的前面标 * */
  function gradeCell(cls, x) {
    const gs = cfg().grades || [];
    const fix = cls.gradeFix = cls.gradeFix || {};
    const k = String(x.sid);
    const opts = [{ v: '', t: '自动（' + (x.autoGrade || '—') + '）' }]
      .concat(gs.map(g => ({ v: g.name, t: g.name })));
    const sel = U.el('select', {
      class: 'mini-sel',
      title: x.gradeManual
        ? ('手动改的等级（按占比自动算出的是「' + (x.autoGrade || '—') + '」）')
        : '按占比自动算出的等级；改了之后前面会标 *',
      onchange: e => {
        if (e.target.value) fix[k] = e.target.value; else delete fix[k];
        S.save(); render();
      }
    }, opts.map(o => U.el('option', {
      value: o.v, text: o.t, selected: (fix[k] || '') === o.v ? 'selected' : null
    })));
    const pill = U.el('span', { class: 'pill ' + gradeCls(x.grade), text: x.grade || '—' });
    if (x.gradeTitle) pill.title = x.gradeTitle;
    return U.el('span', { class: 'grade-cell' }, [
      x.gradeManual ? U.el('b', { class: 'star', text: '*' }) : null,
      pill, sel
    ]);
  }

  function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
  function gradeCls(g) {
    const i = (cfg().grades || []).findIndex(x => x.name === g);
    return ['ok', 'blue', 'warn', 'danger'][i] || 'grey';
  }

  async function importExam() {
    const files = await U.pickFile('.xlsx,.csv,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false, false);
    if (!files || !files.length) return;
    const cls = S.current();
    let rows;
    try {
      rows = await A.sheet.readFile(files[0]);
    } catch (e) { U.toast('读取失败：' + e.message, 'err'); return; }
    const parsed = parseExam(rows);
    if (!parsed.length) {
      U.modal({
        title: '没能识别出成绩',
        body: U.el('div', { class: 'small' }, [
          U.el('div', { text: '请按模板填写：第一列学号、第二列姓名、第三列成绩。' }),
          U.el('div', { class: 'muted', style: { marginTop: '6px' }, text: '读到的前 3 行：' }),
          U.el('div', { style: { whiteSpace: 'pre-wrap' }, text: rows.slice(0, 3).map(r => r.join(' | ')).join('\n') })
        ]),
        buttons: [
          { label: '知道了' },
          { label: '下载模板', cls: 'primary', onClick: () => A.tpl.examTemplate(cls) }
        ]
      });
      return;
    }
    cls.exam = cls.exam || {};
    parsed.forEach(x => { cls.exam[String(x.id)] = x.score; });
    S.save();
    render();
    U.toast('已录入 ' + parsed.length + ' 个成绩', 'ok');
  }

  /** 从任意表格里找 学号 / 姓名 / 成绩 三列 */
  function parseExam(rows) {
    if (!rows || !rows.length) return [];
    const maxLen = Math.max.apply(null, rows.map(r => r.length));
    let idCol = 0, nameCol = 1, scoreCol = 2, start = 0;
    let found = false;
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const line = rows[r].map(v => String(v || '').replace(/\s/g, ''));
      const i1 = line.findIndex(v => /学号|考号|编号/.test(v));
      const i2 = line.findIndex(v => /姓名|名字/.test(v));
      const i3 = line.findIndex(v => /成绩|分数|得分/.test(v));
      if (i1 >= 0 || i3 >= 0) {
        if (i1 >= 0) idCol = i1;
        if (i2 >= 0) nameCol = i2;
        if (i3 >= 0) scoreCol = i3;
        start = r + 1; found = true; break;
      }
    }
    if (!found && maxLen < 3) return [];
    const out = [];
    for (let r = start; r < rows.length; r++) {
      const idv = String(rows[r][idCol] === undefined ? '' : rows[r][idCol]).replace(/[^\d]/g, '');
      const sv = String(rows[r][scoreCol] === undefined ? '' : rows[r][scoreCol]).trim();
      if (!idv) continue;
      const sc = parseFloat(sv);
      if (isNaN(sc)) continue;
      out.push({ id: parseInt(idv, 10), score: sc });
    }
    return out;
  }

  /** 导出 Excel（学号列按文本写，成绩类列按数值写） */
  function exportXlsx(cls, rows) {
    const head = ['学号', '姓名', '课堂表现', '作业', '考试', '总评', '等级', '加减分明细'];
    const body = rows.map(x => [
      String(x.sid), SE.name(cls, x.sid) || '', x.perf, x.hw,
      (x.exam === null ? '' : x.exam), x.total,
      (x.gradeManual ? '*' : '') + (x.grade || ''),
      x.pLog.concat(x.hLog).join('；')
    ]);
    A.tpl.sheet('期末总评-' + cls.name + '-' + A.term.short() + '.xlsx', '期末总评', [head].concat(body), {
      types: { 0: 'text', 1: 'text', 2: 'number', 3: 'number', 4: 'number', 5: 'number', 6: 'text', 7: 'text' },
      widths: [8, 12, 11, 10, 10, 10, 10, 60]
    });
    U.toast('已导出 ' + rows.length + ' 人的期末总评', 'ok');
  }

  function exportCsv(cls, rows) {
    const lines = ['学号,姓名,课堂表现,作业,考试,总评,等级,扣分明细'];
    rows.forEach(x => lines.push([
      x.sid, SE.name(cls, x.sid) || '', x.perf, x.hw, (x.exam === null ? '' : x.exam), x.total,
      (x.gradeManual ? '*' : '') + (x.grade || ''),
      x.pLog.concat(x.hLog).join(' ')
    ].map(v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"').join(',')));
    U.download('期末总评-' + cls.name + '-' + A.term.short() + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv');
  }

  A.finalScore = { compute, parseExam };

})(window.App);
