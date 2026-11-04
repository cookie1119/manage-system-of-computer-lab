/* 应用入口：册子(班级管理) → 区(班级) → 标签页(考勤/批改/记录) */
(function (A) {
  'use strict';
  const U = A.util, S = A.store;

  const app = A.app = {};
  const VIEW_NAME = {
    attendance: '考勤', homework: '作业批改', records: '课堂记录', summary: '期末总评',
    classes: '班级管理', rooms: '机房管理'
  };
  const VIEWS = ['classes', 'rooms', 'attendance', 'homework', 'records', 'summary'];
  const HOME_VIEW = 'classes';        // 打开就用“班级管理”当主页（要先选班再进去上课）
  let currentView = HOME_VIEW;

  app.refreshClassSelect = function () {
    const db = S.load();
    const sel = document.getElementById('classSelect');
    sel.innerHTML = '';
    db.classes.forEach(c => {
      sel.appendChild(U.el('option', {
        value: c.id, text: c.name + '（' + c.studentCount + '人）',
        selected: c.id === db.currentClassId ? 'selected' : null
      }));
    });
    sel.value = db.currentClassId;
  };

  function updateCrumb(view) {
    const cls = S.current();
    const box = document.getElementById('crumb');
    box.innerHTML = '';
    box.appendChild(U.el('span', { class: 'crumb-term', text: A.term.title() }));
    box.appendChild(U.el('span', { text: '/' }));
    box.appendChild(U.el('a', { text: '班级管理', onclick: () => show('classes') }));
    if (view === 'classes') {
      box.appendChild(U.el('span', { text: '/ 共 ' + S.load().classes.length + ' 个班（点击班级进入该班的考勤）' }));
    } else if (view === 'rooms') {
      box.appendChild(U.el('span', { text: '/ 机房管理（文件夹别名 · 电脑不可用）' }));
    } else {
      box.appendChild(U.el('span', { text: '/' }));
      box.appendChild(U.el('b', { text: cls.name }));
      box.appendChild(U.el('span', { text: '/' }));
      box.appendChild(U.el('span', { text: VIEW_NAME[view] || '' }));
    }
  }

  function show(view) {
    currentView = view;
    VIEWS.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== view);
    });
    U.$$('#tabs .tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-view') === view));
    if (view === 'attendance') A.views.renderAttendance();
    if (view === 'homework') A.views.renderHomework();
    if (view === 'records') A.views.renderRecords();
    if (view === 'summary') A.views.renderSummary();
    if (view === 'classes') A.views.renderClasses();
    if (view === 'rooms') A.views.renderRooms();
    updateCrumb(view);
    U.closePopover();
  }
  app.show = show;

  function boot() {
    S.load();
    app.refreshClassSelect();

    document.getElementById('classSelect').addEventListener('change', e => {
      const db = S.load();
      db.currentClassId = e.target.value;
      S.save();
      if (currentView === 'classes') A.views.renderClasses();
      else show(currentView);
      U.toast('已切换到 ' + S.current().name, 'ok');
    });

    U.$$('#tabs .tab').forEach(t => {
      t.addEventListener('click', () => show(t.getAttribute('data-view')));
    });

    document.getElementById('btnHelp').addEventListener('click', () => {
      U.modal({
        title: '使用说明',
        body: U.el('div', { class: 'small', style: { lineHeight: '1.9' }, html:
          '<b>层级</b>：打开就是<b>班级管理</b>，这里和机房管理 = 一本册子的两层目录；进入某个班后有“考勤 / 作业批改 / 课堂记录 / 期末总评”四个标签页。管理页顶部显示当前<b>学年学期</b>（如 2025-2026学年 第一学期）。<br><br>' +
          '<b>1. 班级管理</b>：新增班级时只需选 <b>年级（初一 c1 / 初二 c2）、班级 1-21、人数 1-60、机房 1-3</b>（班级名按“年级（班号）班”自动生成，不用手写）；年级和班级会用在作业命名里，机房决定作业文件夹前缀（1 室 A01 → 1A01）。每个班的四个按钮：<b>进入 / 编辑 / 花名册 / 删除</b>；点<b>花名册</b>可“下载模板、上传、下载本班花名册”，下载的文件名按毕业届算（2025-2026 学年初二 14 班 → <b>27届14班花名册.xlsx</b>）。<br>' +
          '<b>2. 机房管理</b>：这里管三间机房。① <b>文件夹别名</b>：个别机器命名不规矩（不是 室号+座位号）的，登记一次，以后都按你的登记对应（作业批改页点未识别的文件夹名也能直接登记）。② <b>电脑不可用</b>：写清楚从哪天到哪天，这段时间用到该机房的班级都会自动避开，到期自动恢复。<b>页面底端保存的是各学期归档下来的机房情况</b>（当时登记的别名和不可用记录），可查看或导出；班级的归档在班级管理页底端。<br>' +
          '<b>3. 花名册</b>：点“上传花名册”会<b>直接打开文件选择框</b>，选中表格就自动识别，不用再多点一次窗口；要空白模板的话，在班级管理页点该班的<b>花名册 → 下载模板</b>。模板第一行是“<b>初 _ _ 班</b>”，在<b>“初”右边的空格填年级（1=初一、2=初二、3=初三），在“班”左边的空格填班号</b>（都是数字就行），第二行是学号 / 姓名，第三行起填名单；上传时第一行会被读出来，<b>自动把本班的年级、班别改过来</b>，人数按名单里实际有多少条算（学号和人数对得上不齐没关系，比如最大 54 号但只有 52 人，就按 52 人算，座位仍按学号排）。自己的表格只要“某一列是姓名、它左边紧邻一列是学号”也能识别。<br>' +
          '<b>4. 座位视角</b>：屏幕下方是讲台，最下面一行是 01 排（离你最近），越往上越远。左右方向按机房走：<b>1 室最左边是 A 列</b>，<b>2、3 室最右边是 A 列</b>，和你站在讲台上看到的一致。<br>' +
          '<b>5. 考勤</b>：<b>先点“开始上课”才能标记出勤</b>。格子里的按钮直接点 —— 第一行 <b>缺勤</b>、<b>迟到</b>、<b>早退</b>，第二行三个请假理由 <b>未回校</b>、<b>校医</b>、<b>其他</b>。除迟到外，再点一次同一个按钮撤销；迟到点第一次开始计时、第二次学生到达时停表、第三次取消；早退点第一次绿色（有故）、第二次红色（无故）、第三次取消。“全班恢复出勤”需要再确认一次。<br>' +
          '<b>6. 违纪与奖励</b>：姓名右边两个按钮 —— <b>“奖”</b>记录奖励：回答、助人、纪律、值日、其他；<b>“违”</b>记录违纪：讲话、换位、走动、脱控、无关、值日、其他。<b>每一项后面都有 − / +，同一项可以叠加次数</b>（比如一节课回答了 3 次，就在“回答”后面点两下 +，显示成 回答×3），记录编辑弹窗里同样能改。<b>“其他”在菜单底部直接填</b>（不必先选再写），填完立刻变成独立的一行，<b>和固定项一样能加减次数、减到 0 就消失</b>；这类临时项<b>不会带到下一节课</b>（固定项一直在），但会正常留在当时那节课的记录里。期末总评<b>奖励每记一次 +1 分，违纪每记一次 -1 分</b>。<br>' +
          '<b>7. 长期请假 / 转学</b>：点学生<b>姓名</b>可标记为“长期请假”（以后每节课自动标为“未回校”）或“转学”（移出座位和名单，可在班级管理里点标签恢复）。<br>' +
          '<b>8. 换座</b>：点工具条“换座”进入换座模式，此时可拖动名片到目标座位（空位也能放），或先后点两个座位；再点一次“换座中”退出。<br>' +
          '<b>9. 电脑不可用与座次规则（全系统只有这一套）</b>：非换座模式下点空座位 → “标记此电脑不可用”。排座永远按这三步算：' +
          '<b>① 归位优先</b> —— 只要这位同学<b>自己的原始座位没坏，他一定坐回自己的座位</b>，不管之前是因为电脑坏被挪走过、还是临时换过座；<b>电脑修好、登记到期自动恢复、新学年清空不可用标记之后，他会自己“回家”，不用你手动改</b>。' +
          '<b>② 原位还坏的</b> —— 才按换位原则安排：<b>本列最靠近讲台（1 排）的“长期空位”</b>（长期空位指<b>没有在位同学把它当原始座位</b>的位置，最典型的是转学同学腾出来的座位；临时没人坐的座位不算）；<b>本列没有就往旁边列找</b>，同样是那列最靠近讲台的长期空位。找到的位置会长期记住，每节课都按这个安排，直到原位修好为止。' +
          '<b>③ 兜底</b> —— 机房座位实在不够（坏电脑太多）时也不会有人凭空消失，会先坐回原位并在页面上提示你手动安排。' +
          '座次在<b>打开考勤页、开始上课、机房登记变更、导花名册、恢复转学、切换学期</b>时都会自动重算一遍；因电脑修好而回原位的，换座记录里会标一个“<b>归位</b>”。上课中点“取消不可用”，座上的本人也会立刻回到自己的座位。<br>' +
          '<b>10. 上下课</b>：点“开始上课”记录开始时间，按钮变成“结束上课”；下课前点它，本节课计时完成（<b>结束后不再弹窗打断</b>，你可以先安心改作业，改完再去“课堂记录”保存）。<br>' +
          '<b>11. 作业批改</b>：① 每条要求四格：<b>文件/文件夹 → 类型（文件夹则填文件夹名）→ 数量 → 命名</b>；数量填几，就竖着排几个命名格，一格管一份；② 命名可以拼 <b>年级、班级、学号、姓名、序号 + 自己输入的文字</b>，<b>班级固定两位（1 班写 01）</b>，<b>学号按学生本人学号算</b>（不是座位号，学生换座也照本人算），比对时忽略大小写和空格；③ 命名格式可“存为同年级模板”，同年级其他班同一次课自动套用；④ 判定：<b>什么都没交 = 缺交；某一类数量不够 = 数量错误（多出来的文件不算错）；数量正好才看命名 = 命名错误；都对 = 正确</b>；⑤ 结果表按学号列出，文件夹和状态中间显示“已提交内容”，可点状态按钮只看这一类；<b>学生把文件夹名字写乱了（认不出座位）时，系统会按里面的姓名或学号把他认出来</b>，实在认不出的才列在“认不出的文件夹”里；⑥ <b>保存本节课后，作业要求和上传结果会自动清空</b>，下节课重新设置；⑦ <b>忘了先设要求就上传了？改好要求后点“重新批改”</b>，系统会用刚才那份文件按新要求重算一遍，不用再传一次。' +
          '<b>⑧ “状态”那一格可以直接点开改</b> —— 手动改过的会在前面标 <b class="star">*</b>，和自动批改的结论区分开；' +
          '本节<b>请假</b>的同学，作业按<b>请假</b>计，<b>不算缺交、也不算作业异常</b>。<br>' +
          '<b>12. 保存记录</b>：结束上课后到“课堂记录”页，点“保存本节课数据”' +
          '（<b>要是还没上传作业，会先问一句“要不要先去上传”</b>，免得忘了改作业就存档；这节课本来不收作业就点“不上传，直接保存”），弹窗里可填 <b>本学期第几次课</b> 和 <b>本节课课题</b>（课题连同<i>日期 + 时间</i>一行），也能手动修改各类名单（含违纪、奖励、作业情况）。<b>同年级其他班上同一课次时，会自动沿用这个课题</b>（作业要求模板也是同理）；<b>换了新学期的课题会全部清空</b>，不会把上学期的课题带过来。记录页每人一块汇总：缺勤、迟到、早退（名字后标有故/无故）、请假一行看完；<b>作业只给汇总，点“查看详情”弹小窗口看名单和饼图</b>（里面“已提交内容”那一格<b>点一下就能自己补填</b>，比如系统没认出他交了什么时），奖励、违纪、换座都收起来点开看。“第几次课”自动按已有记录推算：删掉第 6 次的记录，下次开课仍算第 6 次。<br>' +
          '<b>13. 期末总评</b>：课堂表现、作业、考试各 100 分。课堂表现：缺勤 -5/次、迟到 n 分钟 -n（每节课最多 -5）、无故早退 -5/次、每项违纪 -1、<b>每项奖励 +1</b>（课堂表现加分后不超过 100）；作业：<b>缺交 -3、数量错误 -2、命名错误 -1</b>（都扣到 0 分为止）。考试用“下载成绩模板”填好后上传。填好三项占比和等级占比后自动算出总评与等级，可用 <b>导出 Excel</b> 或导出 CSV 存档（学号列按文本写，成绩列按数值写）。' +
          '<br><b>请假</b>：课堂表现不扣分，当次作业按“请假”计 —— 不算缺交、不算异常，总评也不扣分。' +
          '<br><b>长期请假</b>（本学期请假次数超过课次的 <b>70%</b>）：等级<b>直接给第 3 级</b>（不管上面设了几级），扣分明细里写“长期请假”；但他<b>回校期间的每一项加分、扣分仍逐条列出</b>。' +
          '<br>等级也能手动改，改过的在前面标 <b class="star">*</b>。' +
          '<br>' +
          '<b>14. 学期归档</b>：学期结束后在班级管理页点“学期结束并归档”，本学期数据折叠保存起来 —— <b>班级的那份在班级管理页底端</b>（展开某学期后，点每个班的“查看记录”可逐次课翻看那学期的全部记录，也能导出该班 CSV 或删除归档）；<b>机房的那份在机房管理页底端</b>，按学期列出当时各机房的<b>文件夹别名</b>和<b>电脑不可用记录</b>，点“查看机房情况”看明细，也能导出 CSV。新建<b>第一学期</b>会清空班级和机房标记并顺延学年；新建<b>第二学期</b>沿用上学期班级设置，记录从第 1 次课重新算。<br>' +
          '<b>15. 班级顺序</b>：班级管理页默认<b>按年级、再按班级号</b>排列（初一 1 班、初一 2 班…初二 1 班…），新加的班、改了年级班号的班都会自动落到该在的位置。想自己排，点页面上方的“<b>调整顺序</b>”，然后<b>拖动卡片</b>或点卡片上的“<b>↑ 上移 / ↓ 下移</b>”，排好点“完成”；之后会一直保持你排的顺序（新加的班放在最后），点“<b>恢复默认顺序</b>”就回到按年级班级排。<br>' +
          '<b>16. 备份</b>：数据只存在本机浏览器里，备份文件名带学年学期；换电脑或清理浏览器前请用“备份数据”导出 JSON，需要时用“恢复数据”导入。' }),
        buttons: [{ label: '知道了', cls: 'primary' }]
      });
    });

    document.getElementById('btnBackup').addEventListener('click', () => {
      U.download('机房课堂数据-' + A.term.short() + '-' + U.today() + '.json', S.exportJSON(), 'application/json');
      U.toast('已导出 ' + A.term.title() + ' 的备份文件', 'ok');
    });

    const restoreInput = document.getElementById('restoreInput');
    document.getElementById('btnRestore').addEventListener('click', () => restoreInput.click());
    restoreInput.addEventListener('change', async () => {
      const f = restoreInput.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj.classes) throw new Error('文件格式不对');
        S.setRaw(obj);
        app.refreshClassSelect();
        show(currentView);
        U.toast('数据已恢复', 'ok');
      } catch (e) {
        U.toast('恢复失败：' + e.message, 'err');
      }
      restoreInput.value = '';
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') U.closePopover();
    });

    if (!S.available) {
      U.toast('浏览器禁用了本地存储（可能是隐私模式），请及时使用“备份数据”', 'err');
    }

    show(HOME_VIEW);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.App);
