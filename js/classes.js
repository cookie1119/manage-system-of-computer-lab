/* 班级管理页 + 花名册上传识别 */
(function (A) {
  'use strict';
  const U = A.util, SE = A.seats, S = A.store;
  const V = A.views = A.views || {};

  /* ---------- 花名册上传 ---------- */
  const roster = A.roster = {};

  /** 上传花名册：点一下直接打开文件选择框（要模板就在班级页“花名册 → 下载模板”） */
  roster.upload = async function (cls, cb) {
    const files = await U.pickFile('.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false, false);
    if (!files || !files.length) return;
    const file = files[0];
    let rows;
    try {
      rows = await A.sheet.readFile(file);
    } catch (e) {
      U.modal({
        title: '文件读取失败',
        body: U.el('div', {}, [
          U.el('div', { text: e.message }),
          U.el('div', { class: 'small muted', style: { marginTop: '8px' }, text: '如果是老版本的 .xls 或者 WPS 另存的格式，请在 Excel/WPS 里“另存为”→“Excel 工作簿（.xlsx）”后再上传；也可以直接用我们提供的模板。' }),
          U.el('div', { class: 'btn-row', style: { marginTop: '12px' } }, [
            U.el('button', { class: 'btn primary', text: '下载标准模板', onclick: () => A.tpl.rosterTemplate() })
          ])
        ]),
        buttons: [{ label: '知道了' }]
      });
      return;
    }
    let list = A.sheet.extractRoster(rows);
    if (!list.length) {
      U.modal({
        title: '没能识别出花名册',
        body: U.el('div', {}, [
          U.el('div', { text: '没有找到“姓名”列。请把表格整理为：某一列是学生姓名，它左边紧邻的一列是学号。' }),
          U.el('div', { class: 'small muted', style: { marginTop: '8px' }, text: '已读取到的前 3 行：' }),
          U.el('div', { class: 'small', style: { marginTop: '4px', whiteSpace: 'pre-wrap' }, text: rows.slice(0, 3).map(r => r.join(' | ')).join('\n') }),
          U.el('div', { class: 'btn-row', style: { marginTop: '12px' } }, [
            U.el('button', { class: 'btn primary', text: '下载标准模板重填', onclick: () => A.tpl.rosterTemplate() })
          ])
        ]),
        buttons: [{ label: '知道了' }]
      });
      return;
    }
    const maxId = Math.max.apply(null, list.map(x => x.id));
    const suggestRenumber = maxId > 200 || maxId > Math.max(cls.studentCount || 54, cls.maxSid || 0);
    preview(cls, list, suggestRenumber, cb, A.sheet.headInfo(rows));
  };

  function preview(cls, list, suggestRenumber, cb, head) {
    let renumber = suggestRenumber;
    head = head || {};
    const ids = list.map(x => x.id);
    // 第一行里写了“初 1 / 班 12”的话，顺手把班级对上
    const headLine = (head.grade || head.classNo)
      ? U.el('div', { class: 'small', style: { marginBottom: '8px', color: '#15803d' }, html:
          '从表格第一行读到了：<b>' +
          (head.grade ? head.grade : '（年级没填）') +
          (head.classNo ? '（' + head.classNo + '）班' : '（班号没填）') +
          '</b>' + (head.grade && head.classNo ? '，导入后会自动把本班的年级班别改成它。' : '，没读全的部分保持现在的值。') })
      : null;
    const box = U.el('div', {}, [
      headLine,
      U.el('div', { html: '识别到 <b>' + list.length + '</b> 名学生' +
        '（人数按名单条数算，与学号无关）。学号范围：' + Math.min.apply(null, ids) + ' ~ ' + Math.max.apply(null, ids) +
        (Math.max.apply(null, ids) !== list.length ? '　<span class="muted">学号和人数对不上（例如缺号），按实际名单布置座位</span>' : '') }),
      U.el('label', {
        class: 'small', style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '10px 0' }
      }, [
        U.el('input', { type: 'checkbox', checked: renumber ? 'checked' : null, onchange: e => { renumber = e.target.checked; } }),
        U.el('span', { text: '把学号按顺序重编为 1、2、3…（当花名册学号是长号如 20240101 时请勾选）' })
      ]),
      U.el('div', { class: 'roster-preview' }, [
        U.el('table', {}, [
          U.el('thead', {}, [U.el('tr', {}, [U.el('th', { text: '学号' }), U.el('th', { text: '姓名' })])]),
          U.el('tbody', {}, list.slice(0, 60).map(x => U.el('tr', {}, [
            U.el('td', { text: String(x.id) }), U.el('td', { text: x.name })
          ])))
        ])
      ]),
      list.length > 60 ? U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text: '仅预览前 60 条，共 ' + list.length + ' 条' }) : null
    ]);
    U.modal({
      title: '花名册识别结果',
      body: box,
      buttons: [
        { label: '取消' },
        {
          label: '确认导入', cls: 'primary', onClick: () => {
            const finalList = renumber ? list.map((x, i) => ({ id: i + 1, name: x.name })) : list;
            const r = {}, ids2 = [];
            finalList.forEach(x => { r[String(x.id)] = x.name; ids2.push(x.id); });
            cls.roster = r;
            // 人数 = 名单里实际有多少人（不算学号），座位按真实学号排
            cls.studentCount = finalList.length;
            cls.sidList = ids2.slice().sort((a, b) => a - b);
            cls.maxSid = ids2.length ? Math.max.apply(null, ids2) : finalList.length;
            // 表格第一行写了年级/班号就自动对上
            if (head.grade) cls.grade = head.grade;
            if (head.classNo) cls.classNo = head.classNo;
            cls.name = S.classNameOf(cls.grade, cls.classNo);
            SE.reseat(cls);              // 按机房记录标出坏座位 → 原位的回原位、坏的按规则换
            S.save();
            U.toast('已导入 ' + finalList.length + ' 人' +
              (cls.maxSid !== finalList.length ? '（学号最大 ' + cls.maxSid + '，座位仍按学号排）' : '') +
              (head.grade || head.classNo ? '，班级已设为 ' + cls.name : ''), 'ok');
            cb && cb();
            if (A.views.renderAll) A.views.renderAll();
          }
        }
      ]
    });
  }

  /* ---------- 花名册菜单：下载模板 / 上传 / 下载本班 ---------- */
  /** 毕业届：本学年起始年 +（4 - 年级数）。如 2025-2026 学年的初二 → 2027 年毕业 → 27 届 */
  function graduateYear(cls, schoolYear) {
    const t = schoolYear || A.term.get().schoolYear || '';
    const m = /^(\d{4})/.exec(String(t));
    const y0 = m ? parseInt(m[1], 10) : new Date().getFullYear();
    const gi = cls.grade === '初二' ? 2 : (cls.grade === '初三' ? 3 : 1);
    return y0 + (4 - gi);
  }
  /** 文件名用：27届14班 */
  function jieName(cls, schoolYear) {
    const y = graduateYear(cls, schoolYear);
    return String(y).slice(-2) + '届' + (parseInt(cls.classNo, 10) || 1) + '班';
  }
  A.jieName = jieName;

  function rosterMenu(btn, cls) {
    const named = Object.keys(cls.roster || {}).length;
    U.popover(btn, {
      title: cls.name + ' · 花名册（' + (named ? '已录入 ' + named + ' 人' : '未上传') + '）',
      list: [
        { label: '下载模板', on: () => A.tpl.rosterTemplate() },
        { label: '上传花名册', cls: 'blue', on: () => roster.upload(cls, render) },
        { label: '下载本班花名册', cls: 'blue', on: () => downloadRoster(cls) }
      ]
    });
  }

  /** 导出本班花名册（学号 + 姓名），文件名带毕业届：27届14班花名册.xlsx */
  function downloadRoster(cls) {
    const ids = S.activeStudents(cls);
    if (!ids.length) { U.toast('本班还没有学生', 'err'); return; }
    const rows = [['学号', '姓名']];
    ids.forEach(sid => rows.push([String(sid), SE.name(cls, sid) || '']));
    A.tpl.sheet(jieName(cls) + '花名册.xlsx', '花名册', rows, {
      types: { 0: 'text', 1: 'text' }, widths: [10, 16]
    });
    U.toast('已下载 ' + jieName(cls) + ' 花名册（' + ids.length + ' 人）', 'ok');
  }
  A.downloadRoster = downloadRoster;

  /* ---------- 学年学期 ---------- */
  const termState = { openArch: {} };

  function termBar() {
    const db = S.load();
    return U.el('div', { class: 'card pad term-bar', style: { marginBottom: '12px' } }, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
        U.el('div', { class: 'term-title', text: A.term.title() }),
        U.el('button', { class: 'btn sm', text: '编辑学年学期', onclick: editTerm }),
        U.el('button', { class: 'btn sm ghost', text: '学期结束并归档', onclick: archiveAndStart })
      ]),
      U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text:
        '备份文件的名字会带上这个标题（如 机房课堂数据-' + A.term.short() + '-' + U.today() + '.json）。学期结束后点“学期结束并归档”，本学期全部班级数据会折叠保存到底端。' })
    ]);
  }
  V.termBar = termBar;

  function editTerm() {
    const db = S.load();
    const yInput = U.el('input', { class: 'input', value: db.term.schoolYear || '', placeholder: '如 2025-2026' });
    const sSel = U.el('select', { class: 'input' }, [
      U.el('option', { value: '1', text: '第一学期', selected: db.term.semester !== 2 ? 'selected' : null }),
      U.el('option', { value: '2', text: '第二学期', selected: db.term.semester === 2 ? 'selected' : null })
    ]);
    U.modal({
      title: '学年 / 学期',
      body: U.el('div', { class: 'form-grid' }, [
        U.el('div', { class: 'field' }, [U.el('label', { text: '学年（如 2025-2026）' }), yInput]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '学期' }), sSel])
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: () => {
            const y = yInput.value.trim();
            if (!/^\d{4}-\d{4}$/.test(y)) { U.toast('请按 2025-2026 这样的格式填写', 'err'); return false; }
            db.term.schoolYear = y;
            db.term.semester = parseInt(sSel.value, 10) === 2 ? 2 : 1;
            S.save(); renderAll(); U.toast('已改为 ' + A.term.title(), 'ok');
          }
        }
      ]
    });
  }

  function archiveAndStart() {
    const db = S.load();
    U.confirm('把「' + A.term.title() + '」的全部班级数据归档吗？\n归档后本学期数据会折叠保存到页面底端（可随时查看、导出），然后开始新的学期。', () => {
      db.archive.push({
        id: 'a_' + U.uid(),
        schoolYear: db.term.schoolYear,
        semester: db.term.semester,
        at: U.today(),
        classes: JSON.parse(JSON.stringify(db.classes)),
        rooms: JSON.parse(JSON.stringify(db.rooms))
      });
      db.lessonTopics = {};      // 新学期的课题不沿用上学期（各班记录里的课题仍在归档里）
      S.save();
      chooseNewTerm();
    });
  }

  function chooseNewTerm() {
    const db = S.load();
    const y = db.term.schoolYear || '2025-2026';
    const ym = /^(\d{4})-(\d{4})$/.exec(y);
    const nextY = ym ? (parseInt(ym[2], 10) + '-' + (parseInt(ym[2], 10) + 1)) : y;
    let m = null;
    const body = U.el('div', {}, [
      U.el('div', { class: 'small', style: { lineHeight: '1.9' }, html:
        '<b>第一学期</b>：清空原来的班级和机房不可用标记，学年顺延为 <b>' + nextY + '</b>。<br>' +
        '<b>第二学期</b>：沿用上学期的班级设置（年级、班级、人数、机房、花名册都保留），学年仍为 <b>' + y + '</b>，课堂记录从第 1 次课重新算。' }),
      U.el('div', { class: 'btn-row', style: { marginTop: '12px' } }, [
        U.el('button', { class: 'btn primary', text: '新建第一学期（清空）', onclick: () => { m.close(); newTerm(1); } }),
        U.el('button', { class: 'btn', text: '新建第二学期（沿用班级）', onclick: () => { m.close(); newTerm(2); } })
      ])
    ]);
    m = U.modal({ title: '归档完成，新建哪个学期？', body: body, buttons: [{ label: '稍后再说' }] });
  }

  function newTerm(semester) {
    const db = S.load();
    const y = db.term.schoolYear || '2025-2026';
    const m = /^(\d{4})-(\d{4})$/.exec(y);
    if (semester === 1) {
      db.term.schoolYear = m ? (parseInt(m[2], 10) + '-' + (parseInt(m[2], 10) + 1)) : y;
      db.term.semester = 1;
      const c = S.newClass(S.classNameOf('初一', 1), '初一', 1);
      SE.reseat(c);
      db.classes = [c];
      db.classSortManual = false;    // 新学年班级全新，顺序回到默认的“年级 → 班级号”
      db.currentClassId = c.id;
      db.rooms.forEach(r => { r.broken = []; });
      db.hwTemplates = {};
      db.lessonTopics = {};      // 课题不跨学期沿用
      db.classes.forEach(cc => { cc.seats = SE.buildLessonSeats(cc).seats; });
    } else {
      db.term.semester = 2;
      db.classes.forEach(c => {
        c.records = []; c.draft = null; c.lessonCount = 0; c.lastSeats = null;
        // 新学年/新学期：不可用的记录可能已经到期或被清空，统一结算一遍，
        // 座位修好的同学自动回到自己的座位，还坏着的按规则另安排
        c.seats = SE.buildLessonSeats(c).seats;
      });
      db.hwTemplates = {};
      db.lessonTopics = {};      // 课题不跨学期沿用
      if (!db.classes.length) {
        const c = S.newClass(S.classNameOf('初一', 1), '初一', 1);
        SE.reseat(c); db.classes.push(c); db.currentClassId = c.id;
      }
    }
    S.save(); renderAll();
    U.toast('已进入 ' + A.term.title(), 'ok');
  }

  /** 已归档的学期（折叠在管理页底端） */
  function archiveArea() {
    const db = S.load();
    const box = U.el('div', { class: 'card pad', style: { marginTop: '14px' } });
    const total = (db.archive || []).reduce((n, a) => n + a.classes.length, 0);
    box.appendChild(U.el('h4', { class: 'section-title', style: { margin: '0 0 6px' }, text: '已归档的学期（' + db.archive.length + ' 个学期 · ' + total + ' 个班）' }));
    if (!db.archive.length) {
      box.appendChild(U.el('div', { class: 'small muted', text: '学期结束后点上面的“学期结束并归档”，本学期数据会折叠保存在这里。' }));
      return box;
    }
    db.archive.slice().reverse().forEach(a => {
      const recCount = a.classes.reduce((n, c) => n + (c.records ? c.records.length : 0), 0);
      const open = !!termState.openArch[a.id];
      const row = U.el('div', { class: 'arch-item' }, [
        U.el('div', { class: 'arch-head' }, [
          U.el('span', { class: 'arch-title', text: a.schoolYear + '学年 第' + (a.semester === 2 ? '二' : '一') + '学期' }),
          U.el('span', { class: 'small muted', text: a.classes.length + ' 个班 · ' + recCount + ' 条课堂记录 · 归档于 ' + a.at }),
          U.el('button', { class: 'btn sm ghost', text: open ? '收起' : '展开', onclick: () => { termState.openArch[a.id] = !open; renderAll(); } }),
          U.el('button', {
            class: 'btn sm ghost', text: '导出',
            onclick: () => U.download('机房课堂归档-' + a.schoolYear + '第' + (a.semester === 2 ? '二' : '一') + '学期.json',
              JSON.stringify(a, null, 2), 'application/json')
          }),
          U.el('button', {
            class: 'btn sm danger', text: '删除',
            onclick: () => U.confirm('删除这个归档？（删除后无法恢复）', () => {
              db.archive = db.archive.filter(x => x.id !== a.id);
              S.save(); renderAll();
            })
          })
        ])
      ]);
      if (open) {
        const list = U.el('div', { class: 'arch-body' });
        const tagText = a.schoolYear + '学年 第' + (a.semester === 2 ? '二' : '一') + '学期';
        a.classes.forEach(c => {
          const cnt = (c.records || []).length;
          // 请假不算异常
          const person = (c.records || []).reduce((n, r) =>
            n + (r.absent || []).length + (r.late || []).length + (r.early || []).length +
            (r.missing || []).length +
            (r.violations || []).length + (r.awards || []).length, 0);
          const leaveN = (c.records || []).reduce((n, r) => n + (r.leave || []).length, 0);
          list.appendChild(U.el('div', { class: 'arch-class' }, [
            U.el('b', { text: c.name }),
            U.el('span', { class: 'muted', text: '　' + (c.studentCount || 0) + ' 人 · ' + cnt + ' 节课 · 异常 ' + person + ' 人次' + (leaveN ? ' · 请假 ' + leaveN + ' 人次（不计异常）' : '') }),
            U.el('button', {
              class: 'btn sm', text: cnt ? '查看记录' : '查看记录（空）',
              onclick: () => A.views.viewArchived(c, tagText)
            }),
            U.el('button', {
              class: 'btn sm ghost', text: '导出该班 CSV',
              onclick: () => A.records.exportAll(c, a.schoolYear + '第' + (a.semester === 2 ? '二' : '一') + '学期')
            })
          ]));
        });
        row.appendChild(list);
      }
      box.appendChild(row);
    });
    return box;
  }
  V.archiveArea = archiveArea;

  /* ---------- 班级管理页 ---------- */
  let sorting = false;   // 排序模式（只是界面状态，不存盘）
  let dragFrom = -1;     // 正在拖的卡片位置

  /** 排序模式下卡片底部：上移 / 下移 */
  function sortActions(i, n) {
    return U.el('div', { class: 'class-actions sort' }, [
      U.el('button', {
        class: 'btn sm', text: '↑ 上移', title: '和上一个班换位置',
        disabled: i === 0 ? true : null,
        onclick: () => { S.moveClassTo(i, i - 1); render(); }
      }),
      U.el('button', {
        class: 'btn sm', text: '↓ 下移', title: '和下一个班换位置',
        disabled: i === n - 1 ? true : null,
        onclick: () => { S.moveClassTo(i, i + 1); render(); }
      })
    ]);
  }
  /** 普通模式下卡片底部：进入 / 编辑 / 花名册 / 删除 */
  function normalActions(c, db) {
    return U.el('div', { class: 'class-actions' }, [
      U.el('button', {
        class: 'btn sm primary', text: '进入',
        onclick: () => {
          db.currentClassId = c.id; S.save();
          renderAll();
          A.app.show('attendance');
          U.toast('已进入 ' + c.name, 'ok');
        }
      }),
      U.el('button', { class: 'btn sm', text: '编辑', onclick: () => editClass(c) }),
      U.el('button', { class: 'btn sm', text: '花名册', onclick: e => rosterMenu(e.currentTarget, c) }),
      U.el('button', {
        class: 'btn sm danger', text: '删除',
        onclick: () => U.confirm('删除班级“' + c.name + '”及其全部记录？', () => {
          const i = db.classes.indexOf(c);
          db.classes.splice(i, 1);
          if (!db.classes.length) db.classes.push(S.newClass(S.classNameOf('初一', 1), '初一', 1));
          if (db.currentClassId === c.id) db.currentClassId = db.classes[0].id;
          S.save(); renderAll();
        })
      })
    ]);
  }
  function clearDropMarks() {
    U.$$('#view-classes .drop-target').forEach(n => n.classList.remove('drop-target'));
  }
  /** 排序模式：卡片可以拖到别的位置（拖到目标卡上就插到那个位置） */
  function bindDrag(card, i) {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', e => {
      dragFrom = i;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) { }
      }
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); clearDropMarks(); dragFrom = -1; });
    card.addEventListener('dragover', e => {
      if (dragFrom < 0) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      card.classList.add('drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      clearDropMarks();
      const from = dragFrom;
      dragFrom = -1;
      if (from < 0 || from === i) return;
      S.moveClassTo(from, i);
      render();
    });
  }

  function render() {
    const db = S.load();
    const root = document.getElementById('view-classes');
    root.innerHTML = '';
    root.appendChild(termBar());

    const head = U.el('div', { class: 'card pad', style: { marginBottom: '12px' } }, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
        U.el('h4', { class: 'section-title', style: { margin: '0', flex: '1' }, text: '班级管理（共 ' + db.classes.length + ' 个班）' }),
        sorting ? U.el('button', {
          class: 'btn sm ghost', text: '恢复默认顺序',
          title: '按“年级 → 班级号”重新排列',
          onclick: () => { S.resetClassOrder(); render(); U.toast('已按“年级 → 班级号”重新排序', 'ok'); }
        }) : null,
        U.el('button', {
          class: 'btn sm' + (sorting ? ' on' : ''),
          text: sorting ? '完成' : '调整顺序',
          title: sorting ? '退出排序' : '手动调整班级显示顺序',
          onclick: () => {
            sorting = !sorting; dragFrom = -1; render();
            if (sorting) U.toast('拖动卡片，或点卡片上的“↑ 上移 / ↓ 下移”');
          }
        }),
        U.el('button', { class: 'btn sm ghost', text: '+ 新增班级', title: '不指定老师，放到「未分组」', onclick: () => editClass(null) }),
        U.el('button', { class: 'btn primary sm', text: '+ 添加任课老师', onclick: addTeacher })
      ]),
      U.el('div', {
        class: 'small muted', style: { marginTop: '6px' },
        text: sorting
          ? '排序中：拖动卡片到目标位置，或点卡片上的“↑ 上移 / ↓ 下移”。调好后会一直保持你排的顺序，以后新加的班放在最后；点“恢复默认顺序”回到按年级、班级号排列。'
          : '这里相当于一本册子的目录：每个班是册子里的一个区，点“进入该班”后，顶部会出现该班的“考勤 / 作业批改 / 课堂记录 / 期末总评”标签页。先点“+ 添加任课老师”建好老师，再点老师那一行的“+ 添加班级”，新班就归到这位老师名下。'
      })
    ]);
    root.appendChild(head);

    // 有任课老师就按老师分组（排序模式保持平铺，方便拖动）
    const grouped = !sorting && (db.teachers.length > 0 || db.classes.some(c => String(c.teacher || '').trim()));
    if (!grouped) {
      const grid = U.el('div', { class: 'class-grid' });
      db.classes.forEach((c, i) => grid.appendChild(classCard(c, i, db)));
      root.appendChild(grid);
    } else {
      const collapsed = db.groupCollapsed = db.groupCollapsed || {};
      // 组 = 老师名单里的每一位（没班也显示，方便往里加）+ 未分组的班
      const groups = db.teachers.map(t => ({ name: t, list: [], isTeacher: true }));
      const byName = {};
      groups.forEach(g => { byName[g.name] = g; });
      const loose = [];
      db.classes.forEach(c => {
        const t = String(c.teacher || '').trim();
        if (t && byName[t]) byName[t].list.push(c);
        else loose.push(c);
      });
      if (loose.length) groups.push({ name: '未分组', list: loose, isTeacher: false });
      groups.forEach(g => {
        const open = !collapsed[g.name];
        const head = U.el('div', { class: 'group-head' + (open ? '' : ' closed') }, [
          U.el('span', { class: 'group-arrow', text: open ? '▾' : '▸' }),
          U.el('b', { text: g.name }),
          U.el('span', { class: 'small muted', text: g.list.length + ' 个班' }),
          U.el('span', { class: 'group-sp' }),
          U.el('button', {
            class: 'btn sm ghost', text: '+ 添加班级',
            title: g.isTeacher ? '在这个老师下面加一个班' : '新增一个不归属任何老师的班',
            onclick: e => { e.stopPropagation(); editClass(null, { teacher: g.isTeacher ? g.name : '' }); }
          }),
          g.isTeacher ? U.el('button', {
            class: 'btn sm ghost', text: '⋯', title: '重命名 / 移入已有班级 / 删除老师',
            onclick: e => { e.stopPropagation(); teacherMenu(e.currentTarget, g.name); }
          }) : null
        ]);
        // 当前展开（open=true）→ 点一下收起（记 true）；当前收起 → 点一下展开（记 false）
        head.onclick = () => { collapsed[g.name] = open; S.save(); render(); };
        root.appendChild(head);
        if (open) {
          if (!g.list.length) {
            root.appendChild(U.el('div', { class: 'small muted empty-group', text: '还没有班级，点上面的「+ 添加班级」' }));
          } else {
            const grid = U.el('div', { class: 'class-grid' });
            g.list.forEach(c => grid.appendChild(classCard(c, db.classes.indexOf(c), db)));
            root.appendChild(grid);
          }
        }
      });
    }
    root.appendChild(archiveArea());
    // 顺序变了，顶部的班级下拉也要跟着排
    if (A.app.refreshClassSelect) A.app.refreshClassSelect();
  }
  V.classes = { render };
  V.renderClasses = render;

  /** 一张班级卡片（普通模式与排序模式共用） */
  function classCard(c, i, db) {
    const named = Object.keys(c.roster || {}).length;
    const card = U.el('div', {
      class: 'card class-card' + (c.id === db.currentClassId ? ' current' : '') + (sorting ? ' sorting' : '')
    }, [
      sorting ? U.el('div', { class: 'sort-badge', html: '☰ 第 <b>' + (i + 1) + '</b> 位' }) : null,
      U.el('h4', {}, [U.el('span', { text: c.name }), c.id === db.currentClassId ? U.el('span', { class: 'pill ok', style: { marginLeft: '8px' }, text: '当前' }) : null]),
      U.el('div', { class: 'class-meta', text: c.studentCount + ' 人 · ' + c.room + ' 号机房 · 已上 ' + (c.lessonCount || 0) + ' 节 · 记录 ' + c.records.length + ' 条' }),
      U.el('div', { class: 'class-meta', text: '花名册：' + (named ? '已录入 ' + named + ' 人' : '未上传') + ' · 作业要求 ' + c.homeworkReq.length + ' 项' }),
      specialRow(c),
      sorting ? sortActions(i, db.classes.length) : normalActions(c, db)
    ]);
    if (sorting) bindDrag(card, i);
    return card;
  }

  /* 长期请假 / 转学 名单（可恢复） */
  function specialRow(c) {
    const longList = (c.longLeave || []).slice().sort((a, b) => a - b);
    const goneList = (c.transferred || []).slice().sort((a, b) => a - b);
    if (!longList.length && !goneList.length) return U.el('span', { class: 'hidden' });
    const box = U.el('div', { class: 'special-row' });
    if (longList.length) {
      box.appendChild(U.el('div', { class: 'small muted', text: '长期请假（点标签取消）：' }));
      const wrap = U.el('div', { class: 'name-list' });
      longList.forEach(sid => wrap.appendChild(U.el('span', {
        class: 'name-tag blue', text: sid + ' ' + (SE.name(c, sid) || ''),
        onclick: () => {
          const i = c.longLeave.indexOf(sid);
          if (i >= 0) c.longLeave.splice(i, 1);
          S.save(); render(); U.toast('已取消 ' + sid + ' 号的长期请假', 'ok');
        }
      })));
      box.appendChild(wrap);
    }
    if (goneList.length) {
      box.appendChild(U.el('div', { class: 'small muted', style: { marginTop: '6px' }, text: '已转学（点标签恢复）：' }));
      const wrap = U.el('div', { class: 'name-list' });
      goneList.forEach(sid => wrap.appendChild(U.el('span', {
        class: 'name-tag', text: sid + ' ' + (SE.name(c, sid) || ''),
        onclick: () => {
          const i = c.transferred.indexOf(sid);
          if (i >= 0) c.transferred.splice(i, 1);
          delete c.seatFix[sid];
          // 统一结算一遍：他回到自己的座位，原来占着他座位的人（多半是电脑坏了被安排过来的）
          // 会自动按规则让位、另找一个本列最靠近讲台的长期空位
          SE.reseat(c);
          S.save(); render();
          U.toast('已恢复 ' + sid + ' 号，座位 ' + (SE.seatOfStudent(c, sid) || '（没有空座位了）'), 'ok');
        }
      })));
      box.appendChild(wrap);
    }
    return box;
  }

  /** 新增 / 编辑班级。preset 只在新增时用：{ teacher } 表示这个班归哪位老师 */
  function editClass(cls, preset) {
    const isNew = !cls;
    const data = cls || { name: '', grade: '初一', classNo: S.load().classes.length + 1, studentCount: 54, room: '1' };
    const presetTeacher = (preset && preset.teacher) || '';
    const gradeSel = U.el('select', { class: 'input' }, ['初一', '初二'].map(g =>
      U.el('option', { value: g, text: g, selected: (data.grade || '初一') === g ? 'selected' : null })));
    const classNoOpts = [];
    for (let i = 1; i <= 21; i++) classNoOpts.push(U.el('option', { value: String(i), text: i + ' 班', selected: String(data.classNo || 1) === String(i) ? 'selected' : null }));
    const classNoSel = U.el('select', { class: 'input' }, classNoOpts);
    const countInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '60', value: data.studentCount });
    const roomOpts = (S.load().rooms || []).map(r => U.el('option', {
      value: r.no, text: r.name + '（前缀 ' + r.no + '）', selected: String(data.room || '1') === r.no ? 'selected' : null
    }));
    const roomSel = U.el('select', { class: 'input' }, roomOpts.length ? roomOpts : [U.el('option', { value: '1', text: '1 号机房' })]);

    const body = U.el('div', {}, [
      presetTeacher ? U.el('div', { class: 'small', style: { marginBottom: '8px', color: '#2563eb' }, html: '新班级会归到 <b>' + presetTeacher + '</b> 名下；要换老师，到班级管理页用组头的「⋯」调整。' }) : null,
      U.el('div', { class: 'form-grid' }, [
        U.el('div', { class: 'field' }, [U.el('label', { text: '年级（作业命名：初一 c1 / 初二 c2）' }), gradeSel]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '班级（1-21）' }), classNoSel]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '人数（1-60）' }), countInput]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '机房（决定作业文件夹前缀）' }), roomSel])
      ]),
      U.el('div', { class: 'small muted', style: { marginTop: '10px' }, text: '座位规则：1-10 号坐 A1-A10，11-20 坐 B1-B10，…41-50 坐 E1-E10，51 起坐 A11、B11…' })
    ]);
    U.modal({
      title: isNew ? '新增班级' : '编辑班级',
      body: body,
      buttons: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: () => {
            let count = parseInt(countInput.value, 10);
            if (!(count >= 1 && count <= 60)) { U.toast('人数需在 1-60 之间', 'err'); return false; }
            const grade = gradeSel.value;
            const classNo = parseInt(classNoSel.value, 10);
            const room = roomSel.value || '1';
            const name = S.classNameOf(grade, classNo);
            if (isNew) {
              const nc = S.newClass(name);
              nc.studentCount = count;
              nc.grade = grade; nc.classNo = classNo; nc.room = room;
              nc.teacher = presetTeacher;
              SE.syncBroken(nc);
              nc.seats = SE.buildLessonSeats(nc).seats;
              const db = S.load();
              db.classes.push(nc);
              db.currentClassId = nc.id;
            } else {
              cls.name = name;
              cls.grade = grade;
              cls.classNo = classNo;
              const roomChanged = String(cls.room) !== String(room);
              cls.room = room;
              if (roomChanged) SE.syncBroken(cls);
              if (count !== cls.studentCount) {
                cls.studentCount = count;
                // 手动改人数：学号就按 1…人数 重来一遍（有花名册时用花名册的学号）
                cls.sidList = null; cls.maxSid = 0;
                cls.seats = SE.buildLessonSeats(cls).seats;
              }
            }
            S.save();
            // 没手动排过顺序的，按新的年级/班级号重新归位；手动排过的保持老师的位置，新班放最后
            S.autoSortClasses();
            renderAll();
            U.toast('已保存' + (isNew ? '，' + name + ' 已按年级班级插到对应位置' : ''), 'ok');
          }
        }
      ]
    });
  }

  /* ---------- 任课老师：独立名单，班级只是挂在他下面 ---------- */
  function addTeacher() {
    const input = U.el('input', { class: 'input', placeholder: '如 张老师 / 李老师', maxlength: '20' });
    U.modal({
      title: '添加任课老师',
      body: U.el('div', {}, [
        U.el('div', { class: 'field' }, [U.el('label', { text: '老师姓名' }), input]),
        U.el('div', { class: 'small muted', style: { marginTop: '8px' }, text: '添加后，这位老师下面会出现「+ 添加班级」，新建的班自动归到他名下。' })
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '添加', cls: 'primary', onClick: () => {
            const name = input.value.trim();
            if (!name) { U.toast('请填写老师姓名', 'err'); return false; }
            const db = S.load();
            if (db.teachers.indexOf(name) >= 0) { U.toast('已经有这位老师了', 'err'); return false; }
            db.teachers.push(name);
            S.save(); render(); U.toast('已添加 ' + name + '，点他那一行的「+ 添加班级」', 'ok');
          }
        }
      ]
    });
    if (input.focus) input.focus();
  }

  function teacherMenu(btn, name) {
    const db = S.load();
    const n = db.classes.filter(c => String(c.teacher || '').trim() === name).length;
    U.popover(btn, {
      title: name + '（' + n + ' 个班）',
      list: [
        { label: '重命名老师', on: () => renameTeacher(name) },
        { label: '把已有班级移入', cls: 'blue', on: () => moveInto(name) },
        { label: '删除老师（班级移到未分组）', cls: 'danger', on: () => delTeacher(name) }
      ]
    });
  }

  function renameTeacher(name) {
    const input = U.el('input', { class: 'input', value: name, maxlength: '20' });
    U.modal({
      title: '重命名任课老师',
      body: U.el('div', { class: 'field' }, [U.el('label', { text: '老师姓名' }), input]),
      buttons: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: () => {
            const nv = input.value.trim();
            if (!nv) { U.toast('请填写老师姓名', 'err'); return false; }
            const db = S.load();
            if (nv !== name && db.teachers.indexOf(nv) >= 0) { U.toast('已经有这位老师了', 'err'); return false; }
            const i = db.teachers.indexOf(name);
            if (i < 0) return false;
            db.teachers[i] = nv;
            db.classes.forEach(c => { if (String(c.teacher || '').trim() === name) c.teacher = nv; });
            if (db.groupCollapsed[name] !== undefined) { db.groupCollapsed[nv] = db.groupCollapsed[name]; delete db.groupCollapsed[name]; }
            S.save(); render(); U.toast('已改名为 ' + nv, 'ok');
          }
        }
      ]
    });
  }

  function delTeacher(name) {
    const db = S.load();
    const n = db.classes.filter(c => String(c.teacher || '').trim() === name).length;
    U.confirm('删除任课老师「' + name + '」？' +
      (n ? '他名下的 ' + n + ' 个班会移到「未分组」，班级和课堂记录都不会删。' : '这位老师下面还没有班级。'), () => {
        db.teachers = db.teachers.filter(t => t !== name);
        db.classes.forEach(c => { if (String(c.teacher || '').trim() === name) c.teacher = ''; });
        delete db.groupCollapsed[name];
        S.save(); render(); U.toast('已删除 ' + name, 'ok');
      });
  }

  /** 把其它班级挂到这位老师名下（多选） */
  function moveInto(name) {
    const db = S.load();
    const cands = db.classes.filter(c => String(c.teacher || '').trim() !== name);
    if (!cands.length) { U.toast('所有班级都在这位老师名下了', 'ok'); return; }
    const boxes = {};
    const list = U.el('div', {}, cands.map(c => {
      const cb = U.el('input', { type: 'checkbox' });
      boxes[c.id] = cb;
      const owner = String(c.teacher || '').trim();
      return U.el('label', { class: 'small', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' } }, [
        cb, U.el('span', { text: c.name + '（' + (owner || '未分组') + '）' })
      ]);
    }));
    U.modal({
      title: '把班级移入「' + name + '」',
      body: U.el('div', {}, [
        U.el('div', { class: 'small muted', style: { marginBottom: '6px' }, text: '勾选要归到这位老师名下的班级，可多选。' }),
        list
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '确认移入', cls: 'primary', onClick: () => {
            let n = 0;
            cands.forEach(c => { if (boxes[c.id].checked) { c.teacher = name; n++; } });
            if (!n) { U.toast('没有勾选班级', 'err'); return false; }
            S.save(); render(); U.toast('已把 ' + n + ' 个班移入 ' + name, 'ok');
          }
        }
      ]
    });
  }

  A.classAdmin = { newTerm, archiveAndStart, editClass, termBar, archiveArea, addTeacher };

  function renderAll() {
    A.views.renderAttendance();
    A.views.renderHomework();
    A.views.renderRecords();
    A.views.renderClasses();
    if (A.views.renderRooms) A.views.renderRooms();
    if (A.views.renderSummary) A.views.renderSummary();
    A.app.refreshClassSelect();
  }
  V.renderAll = renderAll;

})(window.App);
