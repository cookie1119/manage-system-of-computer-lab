/* 机房管理页：文件夹命名别名（不规矩的命名在这里登记）、电脑不可用的起止日期 */
(function (A) {
  'use strict';
  const U = A.util, SE = A.seats, S = A.store;
  const V = A.views = A.views || {};

  function seatOptions(selected) {
    return SE.allIds().map(id => U.el('option', { value: id, text: id, selected: id === selected ? 'selected' : null }));
  }

  function render() {
    const db = S.load();
    const root = document.getElementById('view-rooms');
    root.innerHTML = '';
    root.appendChild(A.views.termBar());

    root.appendChild(U.el('div', { class: 'card pad', style: { marginBottom: '12px' } }, [
      U.el('h4', { class: 'section-title', style: { margin: '0 0 4px' }, text: '机房管理（共 ' + db.rooms.length + ' 个机房）' }),
      U.el('div', { class: 'small muted', html:
        '收作业系统自动生成的文件夹是 <b>机房号 + 座位号</b>，例如 1 号机房 A01 → <b>1A01</b>，2 号机房 A01 → <b>2A01</b>。<br>' +
        '个别机器命名不守这个规矩的，在下面“文件夹别名”里登记一次，以后上传作业都按你的登记来对应。<br>' +
        '某台电脑坏了，在“不可用记录”里写上从哪天到哪天，这段时间里用到这个机房的班级都会自动避开它（到期自动恢复）。' })
    ]));

    const grid = U.el('div', { class: 'room-grid' });
    db.rooms.forEach(r => grid.appendChild(roomCard(r)));
    root.appendChild(grid);

    root.appendChild(archiveArea());      // 这里归档的是机房情况，不是班级
  }
  V.rooms = { render };
  V.renderRooms = render;
  V.roomArchiveArea = archiveArea;

  /* ---------- 机房情况的归档（按学期） ---------- */
  function termName(a) {
    return a.schoolYear + '学年 第' + (a.semester === 2 ? '二' : '一') + '学期';
  }
  function countBroken(rooms) {
    return (rooms || []).reduce((n, r) => n + (r.broken || []).length, 0);
  }
  function countAlias(rooms) {
    return (rooms || []).reduce((n, r) => n + Object.keys(r.alias || {}).length, 0);
  }

  function archiveArea() {
    const db = S.load();
    const arch = db.archive || [];
    const box = U.el('div', { class: 'card pad', style: { marginTop: '14px' } });
    const allBroken = arch.reduce((n, a) => n + countBroken(a.rooms), 0);
    box.appendChild(U.el('h4', {
      class: 'section-title', style: { margin: '0 0 4px' },
      text: '已归档的学期 · 机房情况（' + arch.length + ' 个学期 · ' + allBroken + ' 条不可用记录）'
    }));
    box.appendChild(U.el('div', {
      class: 'small muted', style: { marginBottom: '6px' },
      text: '这里保存的是每个学期结束时各机房的“文件夹别名”和“电脑不可用记录”。班级的课堂记录在班级管理页底端查看；删除某个归档也请到班级管理页。'
    }));
    if (!arch.length) {
      box.appendChild(U.el('div', { class: 'small muted', text: '学期结束后在班级管理页点“学期结束并归档”，本学期的机房情况会保存在这里。' }));
      return box;
    }
    arch.slice().reverse().forEach(a => {
      const rooms = a.rooms || [];
      const row = U.el('div', { class: 'arch-item' }, [
        U.el('div', { class: 'arch-head' }, [
          U.el('span', { class: 'arch-title', text: termName(a) }),
          U.el('span', {
            class: 'small muted',
            text: rooms.length + ' 个机房 · 不可用 ' + countBroken(rooms) + ' 条 · 别名 ' + countAlias(rooms) + ' 条 · 归档于 ' + a.at
          }),
          U.el('button', { class: 'btn sm', text: '查看机房情况', onclick: () => viewArchivedRooms(a) }),
          U.el('button', {
            class: 'btn sm ghost', text: '导出',
            onclick: () => exportRooms(a)
          })
        ])
      ]);
      box.appendChild(row);
    });
    return box;
  }

  /** 某个学期机房情况的明细 */
  function viewArchivedRooms(a) {
    const rooms = a.rooms || [];
    const body = U.el('div', {});
    if (!rooms.length) {
      body.appendChild(U.el('div', { class: 'muted small', text: '这个归档里没有机房数据。' }));
    }
    rooms.forEach(r => {
      const card = U.el('div', { class: 'card pad', style: { marginBottom: '10px' } }, [
        U.el('h4', { class: 'section-title', style: { margin: '0 0 8px' } }, [
          U.el('span', { text: r.name || (r.no + ' 号机房') }),
          U.el('span', { class: 'pill grey', style: { marginLeft: '8px' }, text: '文件夹前缀 ' + r.no })
        ])
      ]);
      // 别名
      const aliasKeys = Object.keys(r.alias || {}).sort();
      card.appendChild(U.el('div', { class: 'sub-title', text: '文件夹别名（' + aliasKeys.length + ' 条）' }));
      card.appendChild(aliasKeys.length
        ? U.el('div', { class: 'table-wrap' }, [
          U.el('table', { class: 'grid' }, [
            U.el('thead', {}, [U.el('tr', {}, ['座位', '实际文件夹名'].map(t => U.el('th', { text: t })))]),
            U.el('tbody', {}, aliasKeys.map(s => U.el('tr', {}, [
              U.el('td', { class: 'nowrap', text: s }),
              U.el('td', { text: r.alias[s] })
            ])))
          ])
        ])
        : U.el('div', { class: 'small muted', text: '（这个学期没有登记别名）' }));
      // 不可用
      const list = (r.broken || []).slice().sort((x, y) => (x.from || '').localeCompare(y.from || '') || x.seat.localeCompare(y.seat));
      card.appendChild(U.el('div', { class: 'sub-title', style: { marginTop: '10px' }, text: '电脑不可用记录（' + list.length + ' 条）' }));
      card.appendChild(list.length
        ? U.el('div', { class: 'table-wrap' }, [
          U.el('table', { class: 'grid' }, [
            U.el('thead', {}, [U.el('tr', {}, ['座位', '不可用时间段'].map(t => U.el('th', { text: t })))]),
            U.el('tbody', {}, list.map(b => U.el('tr', {}, [
              U.el('td', { class: 'nowrap', text: b.seat }),
              U.el('td', { class: 'nowrap', text: (b.from || '不限') + ' → ' + (b.to || '学期末') })
            ])))
          ])
        ])
        : U.el('div', { class: 'small muted', text: '（这个学期这台机房的电脑一直是好的）' }));
      body.appendChild(card);
    });
    U.modal({ title: termName(a) + ' · 机房情况', body: body, wide: true, buttons: [{ label: '关闭' }] });
  }

  /** 导出某个学期的机房情况 CSV */
  function exportRooms(a) {
    const q = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['机房', '文件夹前缀', '类别', '座位', '内容'].map(q).join(',')];
    (a.rooms || []).forEach(r => {
      Object.keys(r.alias || {}).sort().forEach(s => {
        lines.push([r.name || (r.no + ' 号机房'), r.no, '别名', s, r.alias[s]].map(q).join(','));
      });
      (r.broken || []).slice().sort((x, y) => (x.from || '').localeCompare(y.from || '') || x.seat.localeCompare(y.seat))
        .forEach(b => {
          lines.push([r.name || (r.no + ' 号机房'), r.no, '不可用', b.seat, (b.from || '不限') + ' → ' + (b.to || '学期末')].map(q).join(','));
        });
    });
    U.download('机房情况-' + a.schoolYear + '第' + (a.semester === 2 ? '二' : '一') + '学期.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv');
    U.toast('已导出该学期的机房情况', 'ok');
  }

  function roomCard(room) {
    const db = S.load();
    const users = db.classes.filter(c => String(c.room) === String(room.no));
    const card = U.el('div', { class: 'card class-card' }, [
      U.el('h4', {}, [
        U.el('span', { text: room.name }),
        U.el('span', { class: 'pill grey', style: { marginLeft: '8px' }, text: '文件夹前缀 ' + room.no })
      ]),
      U.el('div', { class: 'class-meta', text: '使用这个机房的班级：' + (users.length ? users.map(c => c.name).join('、') : '（暂无）') })
    ]);

    /* 别名 */
    const aliasKeys = Object.keys(room.alias || {});
    card.appendChild(U.el('div', { class: 'sub-title', text: '文件夹别名（命名不规矩的登记在这里）' }));
    if (!aliasKeys.length) {
      card.appendChild(U.el('div', { class: 'small muted', text: '还没有登记。识别不出是谁的作业时，在作业批改页点那个文件夹名也能直接登记。' }));
    } else {
      const tb = U.el('tbody', {}, aliasKeys.sort().map(seat => U.el('tr', {}, [
        U.el('td', { class: 'nowrap', text: seat }),
        U.el('td', { text: room.alias[seat] }),
        U.el('td', { class: 'nowrap' }, [
          U.el('span', { class: 'muted', text: (S.current().seats && S.current().seats[seat]) ? S.current().seats[seat] + ' 号' : '—' }),
          U.el('button', {
            style: { marginLeft: '6px', padding: '1px 6px' },
            class: 'btn sm danger', text: '删除',
            onclick: () => { delete room.alias[seat]; S.save(); render(); U.toast('已删除别名', 'ok'); }
          })
        ])
      ])));
      card.appendChild(U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'grid room-table' }, [
          U.el('thead', {}, [U.el('tr', {}, ['座位', '实际文件夹名', '当前学生'].map(t => U.el('th', { text: t })))]),
          tb
        ])
      ]));
    }
    card.appendChild(U.el('div', { class: 'btn-row', style: { marginTop: '6px' } }, [
      U.el('button', { class: 'btn sm', text: '+ 登记别名', onclick: () => editAlias(room) })
    ]));

    /* 不可用 */
    card.appendChild(U.el('div', { class: 'sub-title', style: { marginTop: '12px' }, text: '电脑不可用记录（从哪天 到 哪天）' }));
    const list = (room.broken || []).slice().sort((a, b) => (a.from || '').localeCompare(b.from || '') || a.seat.localeCompare(b.seat));
    if (!list.length) {
      card.appendChild(U.el('div', { class: 'small muted', text: '没有记录。在考勤页点空座位也能标记“电脑不可用”（会自动记一条从今天开始的记录）。' }));
    } else {
      const today = U.today();
      const tb = U.el('tbody', {}, list.map(b => {
        const state = (b.from && b.from > today) ? '未开始'
          : (b.to && b.to < today) ? '已结束'
            : '进行中';
        return U.el('tr', {}, [
          U.el('td', { class: 'nowrap', text: b.seat }),
          U.el('td', { class: 'nowrap', text: (b.from || '不限') + ' → ' + (b.to || '至今') }),
          U.el('td', { class: 'nowrap' }, [
            U.el('span', { class: 'pill ' + (state === '进行中' ? 'danger' : 'grey'), text: state }),
            U.el('button', {
              style: { marginLeft: '6px', padding: '1px 6px' },
              class: 'btn sm danger', text: '删除',
              onclick: () => {
                room.broken = room.broken.filter(x => x !== b);
                syncAll(); render();
                U.toast('已删除记录' + (state === '进行中' ? '，该座位恢复可用' : ''), 'ok');
              }
            })
          ])
        ]);
      }));
      card.appendChild(U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'grid room-table' }, [
          U.el('thead', {}, [U.el('tr', {}, ['座位', '不可用时间段', '状态'].map(t => U.el('th', { text: t })))]),
          tb
        ])
      ]));
    }
    card.appendChild(U.el('div', { class: 'btn-row', style: { marginTop: '6px' } }, [
      U.el('button', { class: 'btn sm', text: '+ 添加不可用时间段', onclick: () => editBroken(room) })
    ]));

    return card;
  }

  function editAlias(room) {
    const seatSel = U.el('select', { class: 'input' }, seatOptions(null));
    const nameInput = U.el('input', { class: 'input', placeholder: '这个座位实际的文件夹名，如 1A01(张三)' });
    U.modal({
      title: '登记文件夹别名 · ' + room.name,
      body: U.el('div', { class: 'form-grid' }, [
        U.el('div', { class: 'field' }, [U.el('label', { text: '座位' }), seatSel]),
        U.el('div', { class: 'field' }, [U.el('label', { text: '实际文件夹名' }), nameInput])
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: () => {
            const v = nameInput.value.trim();
            if (!v) { U.toast('请填写文件夹名', 'err'); return false; }
            room.alias[seatSel.value] = v;
            S.save(); render(); U.toast('已登记，以后都按这个识别', 'ok');
          }
        }
      ]
    });
  }

  function editBroken(room) {
    const seatSel = U.el('select', { class: 'input' }, seatOptions(null));
    const fromInput = U.el('input', { class: 'input', type: 'date', value: U.today() });
    const toInput = U.el('input', { class: 'input', type: 'date', value: '' });
    U.modal({
      title: '电脑不可用 · ' + room.name,
      body: U.el('div', {}, [
        U.el('div', { class: 'form-grid' }, [
          U.el('div', { class: 'field' }, [U.el('label', { text: '座位' }), seatSel]),
          U.el('div', { class: 'field' }, [U.el('label', { text: '从哪天开始' }), fromInput]),
          U.el('div', { class: 'field' }, [U.el('label', { text: '到哪天（留空 = 一直到现在）' }), toInput])
        ]),
        U.el('div', { class: 'small muted', style: { marginTop: '8px' }, text: '填了结束日期的，到期后系统自动把这台电脑恢复为可用。' })
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '保存', cls: 'primary', onClick: () => {
            const seat = seatSel.value;
            const from = fromInput.value || '';
            const to = toInput.value || '';
            if (to && from && to < from) { U.toast('结束日期不能早于起始日期', 'err'); return false; }
            room.broken = (room.broken || []).filter(b => b.seat !== seat);
            room.broken.push({ seat: seat, from: from, to: to });
            syncAll(); render();
            U.toast(seat + ' 已登记为不可用（' + (from || '不限') + ' 至 ' + (to || '至今') + '）', 'ok');
          }
        }
      ]
    });
  }

  /** 机房记录变了：刷新所有用到它的班级的座位表 */
  function syncAll() {
    const db = S.load();
    let backN = 0, moveN = 0;
    db.classes.forEach(c => {
      // 统一结算：电脑修好的，本人自动回到自己的座位；电脑还坏的，按规则换到本列最靠近讲台的长期空位
      const r = SE.reseat(c);
      backN += (r.back || []).length;
      moveN += r.moved.length;
    });
    if (backN) U.toast('电脑修好了：' + backN + ' 位同学已回到自己的座位', 'ok');
    if (moveN) U.toast('有 ' + moveN + ' 人因“电脑不可用”已按规则换到新座位', 'err');
    S.save();
  }

  A.roomAdmin = { syncAll };

})(window.App);
